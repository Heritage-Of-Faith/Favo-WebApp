// Loyalty accrual on confirmed payment — rule L06.
//
// L06: loyalty points are earned when a payment is CONFIRMED (Yoco webhook or a
// later reconciliation), NOT on the order state change. This helper centralises
// that accrual so EVERY payment-confirmation site earns consistently and
// idempotently:
//   • the Yoco webhook  (src/app/api/payments/yoco/webhook/route.ts)
//   • the deferred-payment retry cron (src/server/crons/retry-deferred-payments.ts),
//     which resolves payments taken during a Yoco outage (PRD §10 R2)
//
// Idempotency: the partial unique index loyalty_txn_earn_order_unique on
// loyalty_transactions(order_id) WHERE kind='earn' guarantees at most one earn
// per order. onConflictDoNothing() makes a second confirmation (e.g. the webhook
// AND the retry cron both firing for the same order) a no-op — the cached
// balance is incremented ONLY when this call actually inserted the earn row.
//
// MUST be called inside the same transaction that marks the payment successful.

import { sql, eq } from "drizzle-orm";
import { orders, customers, loyaltyTransactions } from "@db/schema";
import { earnPoints } from "@/server/loyalty/calc";
import type { DB } from "@/lib/db";

export type EarnResult = {
  earnedPoints: number;
  newLoyaltyBalance: number;
  subscription: unknown;
} | null;

/**
 * Accrue loyalty for a confirmed-payment order. Returns the push details when
 * points were actually accrued (so the caller can fire the points-earned push
 * after the transaction commits), or null when nothing was earned (no customer,
 * zero-point total, or a duplicate confirmation).
 */
export async function accrueOrderLoyalty(orderId: string, tx: DB): Promise<EarnResult> {
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

  return {
    earnedPoints: points,
    newLoyaltyBalance: cust?.loyaltyPoints ?? 0,
    subscription: cust?.pushSubscription ?? null,
  };
}
