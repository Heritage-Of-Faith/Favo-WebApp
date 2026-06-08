"use server";

// Loyalty server actions — G8 (redeemLoyalty), G9 (topUpWallet, purchasePack)
// Docs: docs/API.md · BUSINESS_RULES.md L06, L16

import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { orders, customers, loyaltyTransactions, pendingCharges, coffeePacks, menuItems } from "@db/schema";
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

// ─── redeemLoyalty ────────────────────────────────────────────────────────────

/**
 * Apply a loyalty redemption to an order before payment.
 * Sets order total_zar = 0, deducts 100 pts, inserts loyalty_transaction.
 * Rule L06: min 100 pts, full redemption only (total → 0).
 */
export async function redeemLoyalty(
  customerId: string,
  orderId: string
): Promise<ActionResult> {
  const auth = await authorize("barista", "admin", "owner");
  if (!auth.ok) return auth;
  const session = auth.session;

  // Fetch order
  const [order] = await db
    .select()
    .from(orders)
    .where(eq(orders.id, orderId));

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
    return {
      ok: false,
      code: "VALIDATION_ERROR",
      message: "Customer does not match the order.",
    };
  }
  if (order.isStaffDiscount) {
    return {
      ok: false,
      code: "CONFLICT",
      message: "Cannot combine loyalty redemption with a staff discount.",
    };
  }

  // Fetch customer points
  const [customer] = await db
    .select({ loyaltyPoints: customers.loyaltyPoints })
    .from(customers)
    .where(eq(customers.id, customerId));

  if (!customer) {
    return { ok: false, code: "NOT_FOUND", message: "Customer not found." };
  }
  if (!canRedeem(customer.loyaltyPoints)) {
    return {
      ok: false,
      code: "CONFLICT",
      message: `Insufficient loyalty points (${customer.loyaltyPoints} pts — need ${MIN_REDEEM_POINTS}).`,
    };
  }

  const prevTotal = order.totalZar;

  await db.transaction(async (tx) => {
    const txDb = tx as unknown as DB;

    // Zero the order total
    await tx
      .update(orders)
      .set({ totalZar: 0 })
      .where(eq(orders.id, orderId));

    // Deduct points atomically — avoids stale-read race on concurrent redemptions.
    await tx
      .update(customers)
      .set({ loyaltyPoints: sql`${customers.loyaltyPoints} - ${MIN_REDEEM_POINTS}` })
      .where(eq(customers.id, customerId));

    // Append loyalty transaction
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
        before: { totalZar: prevTotal, loyaltyPoints: customer.loyaltyPoints },
        after: {
          totalZar: 0,
          loyaltyPoints: customer.loyaltyPoints - MIN_REDEEM_POINTS,
        },
      },
      txDb
    );
  });

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
  const auth = await authorize("barista", "admin", "owner");
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
  const auth = await authorize("barista", "admin", "owner");
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
