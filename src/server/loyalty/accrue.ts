// Loyalty accrual + reversal on confirmed payment — rule L06.
//
// L06: loyalty points are earned when a payment is CONFIRMED — NOT on the order
// state change. Confirmation happens on one of three paths, all of which call
// accrueOrderLoyalty so earn is consistent and idempotent:
//   • the Yoco webhook  (src/app/api/payments/yoco/webhook/route.ts)
//   • the deferred-payment retry cron (src/server/crons/retry-deferred-payments.ts),
//     which resolves payments taken during a Yoco outage (PRD §10 R2)
//   • the manual-payment confirmation action confirmManualPayment (POS "paid in
//     person" — cash / card machine / EFT), which is how the café actually
//     tenders most orders (the Yoco online path is the exception, not the rule).
//
// Idempotency: the partial unique index loyalty_txn_earn_order_unique on
// loyalty_transactions(order_id) WHERE kind='earn' guarantees at most one earn
// per order. onConflictDoNothing() makes a second confirmation (e.g. the webhook
// AND the retry cron both firing for the same order) a no-op — the cached
// balance is incremented ONLY when this call actually inserted the earn row.
//
// Both helpers MUST be called inside the same transaction that changes the
// payment / order, so the ledger write, the cached-balance mutation and the
// audit row are one atomic unit (audit non-negotiable L08/L12).

import { sql, eq, and } from "drizzle-orm";
import { orders, customers, loyaltyTransactions } from "@db/schema";
import { earnPoints } from "@/server/loyalty/calc";
import { writeAudit } from "@/server/audit";
import type { DB } from "@/lib/db";

/** Who triggered the accrual/reversal — for the audit trail. Defaults to system. */
export type LoyaltyActor = { id?: string; role?: string };

export type EarnResult = {
  earnedPoints: number;
  newLoyaltyBalance: number;
  subscription: unknown;
} | null;

const REVERSAL_REASON_PREFIX = "earn_reversal";

/**
 * Accrue loyalty for a confirmed-payment order. Returns the push details when
 * points were actually accrued (so the caller can fire the points-earned push
 * after the transaction commits), or null when nothing was earned (no customer,
 * zero-point total, or a duplicate confirmation).
 */
export async function accrueOrderLoyalty(
  orderId: string,
  tx: DB,
  actor: LoyaltyActor = {}
): Promise<EarnResult> {
  const [order] = await tx
    .select({ customerId: orders.customerId, totalZar: orders.totalZar })
    .from(orders)
    .where(eq(orders.id, orderId));

  if (!order?.customerId) return null;

  const points = earnPoints(order.totalZar);
  if (points <= 0) return null;

  const inserted = await tx
    .insert(loyaltyTransactions)
    .values({ customerId: order.customerId, orderId, delta: points, kind: "earn" })
    .onConflictDoNothing()
    .returning({ id: loyaltyTransactions.id });

  // Duplicate confirmation for this order — already earned. No double-credit.
  if (inserted.length === 0) return null;

  await tx
    .update(customers)
    .set({ loyaltyPoints: sql`${customers.loyaltyPoints} + ${points}` })
    .where(eq(customers.id, order.customerId));

  const [cust] = await tx
    .select({
      pushSubscription: customers.pushSubscription,
      loyaltyPoints: customers.loyaltyPoints,
    })
    .from(customers)
    .where(eq(customers.id, order.customerId));

  // Audit the balance mutation (L08/L12 — every mutation is audited). The earn
  // is reachable from the webhook, the retry cron and manual confirmation, so
  // this is the single choke point that records who credited the points.
  await writeAudit(
    {
      entityKind: "customer",
      entityId: order.customerId,
      action: "loyalty_earn",
      actorId: actor.id,
      actorRole: actor.role ?? "system",
      after: { orderId, earnedPoints: points, newLoyaltyBalance: cust?.loyaltyPoints ?? points },
    },
    tx
  );

  return {
    earnedPoints: points,
    newLoyaltyBalance: cust?.loyaltyPoints ?? 0,
    subscription: cust?.pushSubscription ?? null,
  };
}

export type ReverseResult = { reversedPoints: number; newLoyaltyBalance: number } | null;

/**
 * Reverse the loyalty earned on an order — used when a paid order is cancelled
 * or refunded, so "pay → earn → cancel" cannot leave the customer holding points
 * for an order that never completed.
 *
 * Rules that keep this safe:
 *   • No earn on this order → no-op (returns null).
 *   • Idempotent: a second call finds the existing reversal row and no-ops, so
 *     it is safe on the (already idempotent) cancel path and the webhook.
 *   • Clamps the claw-back to the customer's CURRENT balance. Points already
 *     spent elsewhere cannot be un-spent, and the DB CHECK (loyalty_points >= 0)
 *     is never violated. The reversal ledger delta equals the actual decrement,
 *     so cached balance and ledger sum stay in agreement (reconcileLoyalty).
 *
 * Recorded as a kind='adjustment' row (the existing enum has no dedicated
 * "reversal" value) tagged with a reason so it is auditable and idempotency-checkable.
 */
export async function reverseOrderLoyalty(
  orderId: string,
  tx: DB,
  actor: LoyaltyActor & { reason?: string } = {}
): Promise<ReverseResult> {
  const [earn] = await tx
    .select({ customerId: loyaltyTransactions.customerId, delta: loyaltyTransactions.delta })
    .from(loyaltyTransactions)
    .where(and(eq(loyaltyTransactions.orderId, orderId), eq(loyaltyTransactions.kind, "earn")));

  if (!earn || earn.delta <= 0) return null;

  // Idempotency: bail if we already recorded a reversal for this order's earn.
  const [alreadyReversed] = await tx
    .select({ id: loyaltyTransactions.id })
    .from(loyaltyTransactions)
    .where(
      and(
        eq(loyaltyTransactions.orderId, orderId),
        eq(loyaltyTransactions.kind, "adjustment"),
        sql`${loyaltyTransactions.reason} LIKE ${REVERSAL_REASON_PREFIX + "%"}`
      )
    );
  if (alreadyReversed) return null;

  const [cust] = await tx
    .select({ loyaltyPoints: customers.loyaltyPoints })
    .from(customers)
    .where(eq(customers.id, earn.customerId));
  if (!cust) return null;

  // Claw back at most what the customer still holds — never below zero.
  const clawBack = Math.min(earn.delta, cust.loyaltyPoints);
  if (clawBack <= 0) {
    // Nothing left to reverse, but still record the intent so we don't retry.
    await tx.insert(loyaltyTransactions).values({
      customerId: earn.customerId,
      orderId,
      delta: 0,
      kind: "adjustment",
      reason: `${REVERSAL_REASON_PREFIX}:${actor.reason ?? "order_reversed"}`,
    });
    return { reversedPoints: 0, newLoyaltyBalance: cust.loyaltyPoints };
  }

  await tx.insert(loyaltyTransactions).values({
    customerId: earn.customerId,
    orderId,
    delta: -clawBack,
    kind: "adjustment",
    reason: `${REVERSAL_REASON_PREFIX}:${actor.reason ?? "order_reversed"}`,
  });

  const [updated] = await tx
    .update(customers)
    .set({ loyaltyPoints: sql`${customers.loyaltyPoints} - ${clawBack}` })
    .where(eq(customers.id, earn.customerId))
    .returning({ loyaltyPoints: customers.loyaltyPoints });

  await writeAudit(
    {
      entityKind: "customer",
      entityId: earn.customerId,
      action: "loyalty_earn_reversed",
      actorId: actor.id,
      actorRole: actor.role ?? "system",
      before: { loyaltyPoints: cust.loyaltyPoints },
      after: {
        orderId,
        reversedPoints: clawBack,
        newLoyaltyBalance: updated?.loyaltyPoints ?? cust.loyaltyPoints - clawBack,
        reason: actor.reason ?? "order_reversed",
      },
    },
    tx
  );

  return { reversedPoints: clawBack, newLoyaltyBalance: updated?.loyaltyPoints ?? cust.loyaltyPoints - clawBack };
}
