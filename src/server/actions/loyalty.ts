"use server";

// Loyalty server actions — AT-109 (redeemLoyalty multi-unit), G9 (topUpWallet, purchasePack)
// Docs: docs/API.md · BUSINESS_RULES.md L06, L16

import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { orders, customers, loyaltyTransactions, pendingCharges, coffeePacks, menuItems, payments, walletTransactions } from "@db/schema";
import { authorize } from "@/server/auth/guard";
import { writeAudit } from "@/server/audit";
import {
  REDEEM_POINTS_UNIT,
  REDEEM_VALUE_ZAR,
} from "@/server/loyalty/calc";
import { createPaymentIntent } from "@/server/yoco/client";
import type { ActionResult } from "@/lib/types";
import type { DB } from "@/lib/db";

const PACK_EXPIRY_DAYS = 90;

// ─── redeemLoyalty ────────────────────────────────────────────────────────────

/**
 * Apply a multi-unit loyalty redemption to an order before payment (AT-109).
 * Server clamps units = min(floor(pts/100), floor(total/2000)).
 * Each unit = 100 pts = R20 off. Re-creates Yoco intent for newTotalZar.
 * Idempotency: partial unique index on loyalty_transactions(order_id) WHERE kind='redeem'.
 * Rules: L06, L17.
 */
export async function redeemLoyalty(
  customerId: string,
  orderId: string,
  units: number
): Promise<ActionResult<{ discountZar: number; pointsUsed: number; newTotalZar: number; clientSecret: string | null }>> {
  const auth = await authorize("barista", "admin");
  if (!auth.ok) return auth;
  const session = auth.session;

  if (!Number.isInteger(units) || units < 1) {
    return { ok: false, code: "VALIDATION_ERROR", message: "units must be a positive integer." };
  }

  const [order] = await db
    .select()
    .from(orders)
    .where(eq(orders.id, orderId));

  if (!order) return { ok: false, code: "NOT_FOUND", message: "Order not found." };
  if (order.state !== "ordered") {
    return { ok: false, code: "CONFLICT", message: "Loyalty can only be redeemed before payment (state='ordered')." };
  }
  if (order.customerId !== customerId) {
    return { ok: false, code: "VALIDATION_ERROR", message: "Customer does not match the order." };
  }
  if (order.isStaffDiscount) {
    return { ok: false, code: "CONFLICT", message: "Cannot combine loyalty redemption with a staff discount (L17)." };
  }

  const [customer] = await db
    .select({ loyaltyPoints: customers.loyaltyPoints })
    .from(customers)
    .where(eq(customers.id, customerId));

  if (!customer) return { ok: false, code: "NOT_FOUND", message: "Customer not found." };

  // Server-side clamp: min(floor(pts/100), floor(total/2000)) — L06
  const maxByPoints = Math.floor(customer.loyaltyPoints / REDEEM_POINTS_UNIT);
  const maxByTotal = Math.floor(order.totalZar / REDEEM_VALUE_ZAR);
  const clampedUnits = Math.min(units, maxByPoints, maxByTotal);

  if (clampedUnits < 1) {
    return {
      ok: false,
      code: "CONFLICT",
      message: `Insufficient points or order total too low to redeem. Points: ${customer.loyaltyPoints}, order total: ${order.totalZar} cents.`,
    };
  }

  const pointsUsed = clampedUnits * REDEEM_POINTS_UNIT;
  const discountZar = clampedUnits * REDEEM_VALUE_ZAR;
  const newTotalZar = order.totalZar - discountZar;

  // Create new Yoco checkout outside the DB transaction (external API call).
  // Old checkout is abandoned — it expires naturally on Yoco's side.
  let newClientSecret: string | null = null;
  if (newTotalZar > 0) {
    try {
      const intent = await createPaymentIntent({
        amountZar: newTotalZar,
        metadata: { orderId, customerId, kind: "loyalty_redeem" },
      });
      newClientSecret = intent.clientSecret;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Yoco checkout creation failed.";
      return { ok: false, code: "PAYMENT_ERROR", message };
    }
  }

  await db.transaction(async (tx) => {
    const txDb = tx as unknown as DB;

    await tx
      .update(orders)
      .set({ totalZar: newTotalZar })
      .where(eq(orders.id, orderId));

    // Atomic point deduction — DB CHECK (loyalty_points >= 0) is the safety net.
    await tx
      .update(customers)
      .set({ loyaltyPoints: sql`${customers.loyaltyPoints} - ${pointsUsed}` })
      .where(eq(customers.id, customerId));

    // Partial unique index (loyalty_txn_redeem_order_unique) makes this idempotent.
    await tx.insert(loyaltyTransactions).values({
      customerId,
      orderId,
      delta: -pointsUsed,
      kind: "redeem",
    });

    // Update payment record to reflect the new total and new checkout ID.
    await tx
      .update(payments)
      .set({
        amountZar: newTotalZar,
        ...(newClientSecret ? { yocoCheckoutId: newClientSecret } : {}),
        status: newTotalZar === 0 ? "successful" : "pending",
      })
      .where(eq(payments.orderId, orderId));

    await writeAudit(
      {
        entityKind: "order",
        entityId: orderId,
        action: "redeem_loyalty",
        actorId: session.id,
        actorRole: session.role,
        before: { totalZar: order.totalZar, loyaltyPoints: customer.loyaltyPoints },
        after: { totalZar: newTotalZar, discountZar, pointsUsed, clampedUnits },
      },
      txDb
    );
  });

  return { ok: true, data: { discountZar, pointsUsed, newTotalZar, clientSecret: newClientSecret } };
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

// ─── resolveStuckCharge (BUG-O2) ─────────────────────────────────────────────

/**
 * Admin-only: manually activate a pending charge whose webhook never arrived.
 * Idempotent — if the charge is already resolved, returns its current status.
 * Uses SELECT FOR UPDATE inside a transaction to prevent concurrent double-credit.
 */
export async function resolveStuckCharge(
  pendingChargeId: string
): Promise<ActionResult<{ status: "completed" | "already_resolved" }>> {
  const auth = await authorize("admin");
  if (!auth.ok) return auth;

  if (!pendingChargeId?.trim()) {
    return { ok: false, code: "VALIDATION", message: "pendingChargeId is required." };
  }

  // Fast pre-check (no lock) — avoid acquiring a lock on an already-resolved row
  const [existing] = await db
    .select({ id: pendingCharges.id, status: pendingCharges.status })
    .from(pendingCharges)
    .where(eq(pendingCharges.id, pendingChargeId));

  if (!existing) {
    return { ok: false, code: "NOT_FOUND", message: "Pending charge not found." };
  }

  if (existing.status !== "pending") {
    return { ok: true, data: { status: "already_resolved" } };
  }

  await db.transaction(async (tx) => {
    // Lock the row so concurrent admin calls don't double-credit
    const [locked] = await tx
      .select({ id: pendingCharges.id, status: pendingCharges.status })
      .from(pendingCharges)
      .where(eq(pendingCharges.id, pendingChargeId))
      .for("update");

    if (!locked || locked.status !== "pending") return;

    await activatePendingCharge(pendingChargeId, tx as unknown as DB);

    await writeAudit(
      {
        entityKind: "pending_charge",
        entityId: pendingChargeId,
        action: "admin.resolve_stuck_charge",
        actorId: auth.session.id,
        actorRole: "admin",
        after: { resolvedBy: auth.session.id },
      },
      tx as unknown as DB
    );
  });

  return { ok: true, data: { status: "completed" } };
}
