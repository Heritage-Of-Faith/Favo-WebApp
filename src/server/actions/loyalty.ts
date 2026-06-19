"use server";

// Loyalty server actions — G8 (redeemLoyalty), G9 (topUpWallet, purchasePack)
// Docs: docs/API.md · BUSINESS_RULES.md L06, L16

import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { orders, customers, loyaltyTransactions, pendingCharges, coffeePacks, menuItems, payments, walletTransactions } from "@db/schema";
import { authorize } from "@/server/auth/guard";
import { writeAudit } from "@/server/audit";
import {
  canRedeem,
  MIN_REDEEM_POINTS,
} from "@/server/loyalty/calc";
import { createPaymentIntent } from "@/server/yoco/client";
import type { ActionResult } from "@/lib/types";
import type { DB } from "@/lib/db";

const PACK_EXPIRY_DAYS = 90;

// Structured error used to surface failures out of the redeemLoyalty transaction
// without leaking exception details across the client boundary.
class RedeemError extends Error {
  constructor(
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "RedeemError";
  }
}

// ─── redeemLoyalty ────────────────────────────────────────────────────────────

/**
 * Apply a loyalty redemption to an order before payment.
 * Sets order total_zar = 0, deducts 100 pts, marks payment as free.
 * Rule L06: min 100 pts, full redemption only (total → 0).
 *
 * TOCTOU fix: the customer row is locked with SELECT FOR UPDATE inside the
 * transaction. A concurrent redemption call blocks at the lock, then re-reads
 * the already-deducted balance and correctly fails the canRedeem check instead
 * of allowing two redemptions against the same balance.
 */
export async function redeemLoyalty(
  customerId: string,
  orderId: string
): Promise<ActionResult> {
  const auth = await authorize("barista", "admin");
  if (!auth.ok) return auth;
  const session = auth.session;

  // Pre-checks on the order — these read-only checks are safe outside the
  // transaction because order state is barista-controlled and won't race with
  // a loyalty redemption.
  const [order] = await db.select().from(orders).where(eq(orders.id, orderId));
  if (!order) {
    return { ok: false, code: "NOT_FOUND", message: "Order not found." };
  }
  if (order.state !== "ordered") {
    return {
      ok: false,
      code: "CONFLICT",
      message: "Loyalty can only be redeemed on an order in 'ordered' state (before payment).",
    };
  }
  if (order.customerId !== customerId) {
    return { ok: false, code: "VALIDATION_ERROR", message: "Customer does not match the order." };
  }
  if (order.isStaffDiscount) {
    return {
      ok: false,
      code: "CONFLICT",
      message: "Cannot combine loyalty redemption with a staff discount.",
    };
  }

  const prevTotal = order.totalZar;

  try {
    await db.transaction(async (tx) => {
      const txDb = tx as unknown as DB;

      // Lock the customer row for the duration of the transaction. Any
      // concurrent redeemLoyalty call for the same customer blocks here until
      // we commit, then re-reads the deducted balance and fails canRedeem.
      const [lockedCustomer] = await tx
        .select({ loyaltyPoints: customers.loyaltyPoints })
        .from(customers)
        .where(eq(customers.id, customerId))
        .for("update");

      if (!lockedCustomer) throw new RedeemError("NOT_FOUND", "Customer not found.");
      if (!canRedeem(lockedCustomer.loyaltyPoints)) {
        throw new RedeemError(
          "CONFLICT",
          `Insufficient loyalty points (${lockedCustomer.loyaltyPoints} pts — need ${MIN_REDEEM_POINTS}).`
        );
      }

      const newPoints = lockedCustomer.loyaltyPoints - MIN_REDEEM_POINTS;

      // Zero the order total and mark the payment row as free. The Yoco
      // checkout was already created with the original amount, but since the
      // order is now £0 no card transaction is needed. Marking the payment
      // successful with amountZar=0 keeps the daily close reconciliation
      // accurate (revenueZar and paymentsZar both reflect 0 for this order).
      await tx.update(orders).set({ totalZar: 0 }).where(eq(orders.id, orderId));
      await tx
        .update(payments)
        .set({ amountZar: 0, status: "successful" })
        .where(eq(payments.orderId, orderId));

      // Deduct points with the locked current value already confirmed.
      await tx
        .update(customers)
        .set({ loyaltyPoints: sql`${customers.loyaltyPoints} - ${MIN_REDEEM_POINTS}` })
        .where(eq(customers.id, customerId));

      await tx.insert(loyaltyTransactions).values({
        customerId,
        orderId,
        delta: -MIN_REDEEM_POINTS,
        kind: "redeem",
      });

      await writeAudit(
        {
          entityKind: "order",
          entityId: orderId,
          action: "redeem_loyalty",
          actorId: session.id,
          actorRole: session.role,
          before: { totalZar: prevTotal, loyaltyPoints: lockedCustomer.loyaltyPoints },
          after: { totalZar: 0, loyaltyPoints: newPoints },
        },
        txDb
      );
    });
  } catch (err) {
    if (err instanceof RedeemError) {
      return { ok: false, code: err.code, message: err.message };
    }
    throw err;
  }

  return { ok: true, data: undefined };
}

// ─── topUpWallet ──────────────────────────────────────────────────────────────

/**
 * Create a Yoco checkout for a wallet top-up. The webhook credits wallet_zar
 * on payment success (L16). Returns the clientSecret for the Yoco hosted-fields
 * form on the POS. Barista-initiated — counter-only (L16).
 */
export async function topUpWallet(
  customerId: string,
  amountZar: number
): Promise<ActionResult<{ yocoClientSecret: string }>> {
  const auth = await authorize("barista", "admin");
  if (!auth.ok) return auth;
  const session = auth.session;

  if (!customerId || typeof amountZar !== "number" || amountZar <= 0) {
    return { ok: false, code: "VALIDATION_ERROR", message: "customerId and a positive amountZar are required." };
  }

  const [customer] = await db
    .select({ id: customers.id })
    .from(customers)
    .where(eq(customers.id, customerId));

  if (!customer) {
    return { ok: false, code: "NOT_FOUND", message: "Customer not found." };
  }

  let checkoutId: string;
  try {
    const intent = await createPaymentIntent({
      amountZar,
      metadata: { chargeKind: "wallet_topup", customerId },
    });
    checkoutId = intent.id;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Yoco checkout creation failed.";
    return { ok: false, code: "PAYMENT_ERROR", message };
  }

  await db.insert(pendingCharges).values({
    yocoCheckoutId: checkoutId,
    kind: "wallet_topup",
    customerId,
    amountZar,
    status: "pending",
  });

  await writeAudit({
    entityKind: "customer",
    entityId: customerId,
    action: "wallet_topup_initiated",
    actorId: session.id,
    actorRole: session.role,
    after: { yocoCheckoutId: checkoutId, amountZar },
  });

  return { ok: true, data: { yocoClientSecret: checkoutId } };
}

// ─── purchasePack ─────────────────────────────────────────────────────────────

/**
 * Create a Yoco checkout for a coffee pack purchase. The webhook inserts a
 * coffee_packs row with 90-day expiry on payment success (L16). Barista-initiated.
 */
export async function purchasePack(
  customerId: string,
  menuItemId: string,
  qty: number
): Promise<ActionResult<{ yocoClientSecret: string }>> {
  const auth = await authorize("barista", "admin");
  if (!auth.ok) return auth;
  const session = auth.session;

  if (!customerId || !menuItemId || typeof qty !== "number" || qty < 1) {
    return { ok: false, code: "VALIDATION_ERROR", message: "customerId, menuItemId and qty >= 1 are required." };
  }

  const [customer] = await db
    .select({ id: customers.id })
    .from(customers)
    .where(eq(customers.id, customerId));

  if (!customer) {
    return { ok: false, code: "NOT_FOUND", message: "Customer not found." };
  }

  const [menuItem] = await db
    .select({ id: menuItems.id, currentPriceZar: menuItems.currentPriceZar })
    .from(menuItems)
    .where(eq(menuItems.id, menuItemId));

  if (!menuItem) {
    return { ok: false, code: "NOT_FOUND", message: "Menu item not found." };
  }

  const amountZar = menuItem.currentPriceZar * qty;

  let checkoutId: string;
  try {
    const intent = await createPaymentIntent({
      amountZar,
      metadata: { chargeKind: "coffee_pack", customerId, menuItemId, qty: String(qty) },
    });
    checkoutId = intent.id;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Yoco checkout creation failed.";
    return { ok: false, code: "PAYMENT_ERROR", message };
  }

  await db.insert(pendingCharges).values({
    yocoCheckoutId: checkoutId,
    kind: "coffee_pack",
    customerId,
    amountZar,
    status: "pending",
    metadata: { menuItemId, qty },
  });

  await writeAudit({
    entityKind: "customer",
    entityId: customerId,
    action: "coffee_pack_initiated",
    actorId: session.id,
    actorRole: session.role,
    after: { yocoCheckoutId: checkoutId, menuItemId, qty, amountZar },
  });

  return { ok: true, data: { yocoClientSecret: checkoutId } };
}

// ─── Internal: activate a pending charge after successful Yoco webhook ────────

/**
 * Called by the webhook handler when a wallet_topup or coffee_pack payment
 * succeeds. Runs inside a transaction that also marks the pendingCharge as
 * successful, so the whole operation is atomic and idempotent.
 */
export async function activatePendingCharge(
  chargeId: string,
  tx: DB
): Promise<void> {
  const [charge] = await tx
    .select()
    .from(pendingCharges)
    .where(eq(pendingCharges.id, chargeId));

  if (!charge || charge.status !== "pending") return;

  await tx
    .update(pendingCharges)
    .set({ status: "successful" })
    .where(eq(pendingCharges.id, chargeId));

  if (charge.kind === "wallet_topup") {
    await tx
      .update(customers)
      .set({ walletZar: sql`${customers.walletZar} + ${charge.amountZar}` })
      .where(eq(customers.id, charge.customerId));

    // Append-only wallet ledger row so customers and admins can see top-up
    // history and the balance can be reconstructed from the ledger alone.
    await tx.insert(walletTransactions).values({
      customerId: charge.customerId,
      deltaZar: charge.amountZar,
      kind: "topup",
      relatedPendingChargeId: chargeId,
      description: "Wallet top-up",
    });

    await writeAudit(
      {
        entityKind: "customer",
        entityId: charge.customerId,
        action: "wallet_credited",
        actorRole: "system",
        after: { creditedZar: charge.amountZar, pendingChargeId: chargeId },
      },
      tx
    );
  } else if (charge.kind === "coffee_pack") {
    const meta = charge.metadata as { menuItemId?: string; qty?: number } | null;
    const menuItemId = meta?.menuItemId;
    const qty = Number(meta?.qty ?? 1);

    if (!menuItemId) return;

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + PACK_EXPIRY_DAYS);

    await tx.insert(coffeePacks).values({
      customerId: charge.customerId,
      menuItemId,
      qtyOriginal: qty,
      qtyRemaining: qty,
      expiresAt,
      pendingChargeId: chargeId,
    });

    await writeAudit(
      {
        entityKind: "customer",
        entityId: charge.customerId,
        action: "coffee_pack_activated",
        actorRole: "system",
        after: { menuItemId, qty, expiresAt: expiresAt.toISOString(), pendingChargeId: chargeId },
      },
      tx
    );
  }
}
