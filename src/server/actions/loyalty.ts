"use server";

// Loyalty server actions — G8 (redeemLoyalty), G9 (topUpWallet, purchasePack)
// Docs: docs/API.md · BUSINESS_RULES.md L06, L16

import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { orders, customers, loyaltyTransactions } from "@db/schema";
import { authorize } from "@/server/auth/guard";
import { writeAudit } from "@/server/audit";
import {
  canRedeem,
  MIN_REDEEM_POINTS,
} from "@/server/loyalty/calc";
import type { ActionResult } from "@/lib/types";
import type { DB } from "@/lib/db";

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

    // Deduct points
    await tx
      .update(customers)
      .set({ loyaltyPoints: customer.loyaltyPoints - MIN_REDEEM_POINTS })
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

// TODO (G9): Yoco intent; webhook credits wallet_zar on customer. Needs migration.
export async function topUpWallet(
  customerId: string,
  amountZar: number
): Promise<ActionResult<{ yocoClientSecret: string }>> {
  void customerId;
  void amountZar;
  throw new Error("Not implemented — G9");
}

// ─── purchasePack ─────────────────────────────────────────────────────────────

// TODO (G9): Yoco intent; on success insert coffee_packs row (90d expiry, L16). Needs migration.
export async function purchasePack(
  customerId: string,
  menuItemId: string,
  qty: number
): Promise<ActionResult<{ yocoClientSecret: string }>> {
  void customerId;
  void menuItemId;
  void qty;
  throw new Error("Not implemented — G9");
}
