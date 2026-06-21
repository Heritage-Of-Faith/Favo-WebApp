"use server";

// Pack redemption server action — AT-111 (LOY-10a)
// Docs: docs/API.md · BUSINESS_RULES.md L16

import { and, asc, eq, gt, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { orders, orderItems, menuItems, coffeePacks, packRedemptions } from "@db/schema";
import { authorize } from "@/server/auth/guard";
import { writeAudit } from "@/server/audit";
import type { ActionResult } from "@/lib/types";
import type { DB } from "@/lib/db";

// ─── redeemPack ───────────────────────────────────────────────────────────────

/**
 * Redeem one drink from a customer's coffee pack against an order line (AT-111).
 * FIFO: picks the pack with the earliest expires_at that has qty_remaining > 0.
 * Atomically decrements qty_remaining (DB CHECK >= 0 is the safety net).
 * Deducts the line's unit_price_zar from orders.total_zar.
 * No loyalty points earned on pack-covered lines (L16).
 * Reversal on cancelOrder is handled automatically — see orders.ts cancelOrder.
 */
export async function redeemPack(
  customerId: string,
  orderId: string,
  orderLineRef: string
): Promise<ActionResult<{ packId: string; qtyRemaining: number }>> {
  const auth = await authorize("barista", "admin");
  if (!auth.ok) return auth;
  const session = auth.session;

  if (!customerId || !orderId || !orderLineRef) {
    return { ok: false, code: "VALIDATION_ERROR", message: "customerId, orderId and orderLineRef are required." };
  }

  // Verify order is in 'ordered' state (pre-payment).
  const [order] = await db
    .select({ id: orders.id, state: orders.state, customerId: orders.customerId, totalZar: orders.totalZar })
    .from(orders)
    .where(eq(orders.id, orderId));

  if (!order) return { ok: false, code: "NOT_FOUND", message: "Order not found." };
  if (order.state !== "ordered") {
    return { ok: false, code: "CONFLICT", message: "Pack can only be redeemed before payment (state='ordered')." };
  }
  if (order.customerId !== customerId) {
    return { ok: false, code: "VALIDATION_ERROR", message: "Customer does not match the order." };
  }

  // Verify the line item exists on this order.
  const [orderLine] = await db
    .select({ id: orderItems.id, orderId: orderItems.orderId, menuItemId: orderItems.menuItemId, unitPriceZar: orderItems.unitPriceZar })
    .from(orderItems)
    .where(and(eq(orderItems.id, orderLineRef), eq(orderItems.orderId, orderId)));

  if (!orderLine) {
    return { ok: false, code: "NOT_FOUND", message: "Order line not found on this order." };
  }

  // Packs only cover coffee items (L16).
  const [menuItem] = await db
    .select({ id: menuItems.id, category: menuItems.category, active: menuItems.active })
    .from(menuItems)
    .where(eq(menuItems.id, orderLine.menuItemId));

  if (!menuItem) return { ok: false, code: "NOT_FOUND", message: "Menu item not found." };
  if (menuItem.category !== "coffee") {
    return { ok: false, code: "VALIDATION_ERROR", message: "Packs only cover category='coffee' items (L16)." };
  }
  if (!menuItem.active) {
    return { ok: false, code: "VALIDATION_ERROR", message: "Menu item is no longer active." };
  }

  // FIFO: pick earliest-expiry pack with qty > 0 that hasn't expired.
  const [pack] = await db
    .select({ id: coffeePacks.id, qtyRemaining: coffeePacks.qtyRemaining, expiresAt: coffeePacks.expiresAt })
    .from(coffeePacks)
    .where(
      and(
        eq(coffeePacks.customerId, customerId),
        eq(coffeePacks.menuItemId, orderLine.menuItemId),
        gt(coffeePacks.qtyRemaining, 0),
        gt(coffeePacks.expiresAt, sql`now()`)
      )
    )
    .orderBy(asc(coffeePacks.expiresAt))
    .limit(1);

  if (!pack) {
    return { ok: false, code: "CONFLICT", message: "No active pack available for this item." };
  }

  // Check this line hasn't already been covered by a pack redemption.
  const [existing] = await db
    .select({ id: packRedemptions.id })
    .from(packRedemptions)
    .where(and(eq(packRedemptions.orderLineRef, orderLineRef), isNull(packRedemptions.reversedAt)));

  if (existing) {
    return { ok: false, code: "CONFLICT", message: "This order line is already covered by a pack redemption." };
  }

  let finalQty = 0;

  try {
    await db.transaction(async (tx) => {
      const txDb = tx as unknown as DB;

      // Atomic decrement — returning() lets us detect concurrent underflow.
      const [decremented] = await tx
        .update(coffeePacks)
        .set({ qtyRemaining: sql`${coffeePacks.qtyRemaining} - 1` })
        .where(and(eq(coffeePacks.id, pack.id), gt(coffeePacks.qtyRemaining, 0)))
        .returning({ id: coffeePacks.id, qtyRemaining: coffeePacks.qtyRemaining });

      if (!decremented) {
        throw new PackError("CONFLICT", "Pack is now empty — another redemption used the last drink.");
      }

      finalQty = decremented.qtyRemaining;

      // Append-only redemption record.
      await tx.insert(packRedemptions).values({
        packId: pack.id,
        customerId,
        orderId,
        orderLineRef,
      });

      // Deduct the covered line's price from the order total.
      await tx
        .update(orders)
        .set({ totalZar: sql`${orders.totalZar} - ${orderLine.unitPriceZar}` })
        .where(eq(orders.id, orderId));

      await writeAudit(
        {
          entityKind: "order",
          entityId: orderId,
          action: "redeem_pack",
          actorId: session.id,
          actorRole: session.role,
          before: { totalZar: order.totalZar, qtyRemaining: pack.qtyRemaining },
          after: { totalZar: order.totalZar - orderLine.unitPriceZar, packId: pack.id, orderLineRef },
        },
        txDb
      );
    });
  } catch (err) {
    if (err instanceof PackError) return { ok: false, code: err.code, message: err.message };
    throw err;
  }

  return { ok: true, data: { packId: pack.id, qtyRemaining: finalQty } };
}

class PackError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
  }
}

// ─── getCustomerActivePacks (AT-116) ──────────────────────────────────────────

/**
 * Returns the menu item IDs for which the customer has at least one active,
 * non-expired coffee pack with qty_remaining > 0. Used by the POS payment
 * panel to show per-line "Use pack" buttons (AT-116).
 */
export async function getCustomerActivePacks(
  customerId: string
): Promise<ActionResult<{ menuItemId: string; qtyRemaining: number }[]>> {
  const auth = await authorize("barista", "admin");
  if (!auth.ok) return auth;

  if (!customerId) {
    return { ok: false, code: "VALIDATION_ERROR", message: "customerId is required." };
  }

  const rows = await db
    .select({ menuItemId: coffeePacks.menuItemId, qtyRemaining: coffeePacks.qtyRemaining })
    .from(coffeePacks)
    .where(
      and(
        eq(coffeePacks.customerId, customerId),
        gt(coffeePacks.qtyRemaining, 0),
        gt(coffeePacks.expiresAt, sql`now()`)
      )
    )
    .orderBy(asc(coffeePacks.expiresAt));

  return { ok: true, data: rows };
}
