"use server";

// Wallet server actions — AT-114 (W1+W2)
// Docs: docs/API.md · BUSINESS_RULES.md L16

import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { orders, customers, loyaltyTransactions, walletTransactions, payments } from "@db/schema";
import { authorize } from "@/server/auth/guard";
import { writeAudit } from "@/server/audit";
import { earnPoints } from "@/server/loyalty/calc";
import { createPaymentIntent } from "@/server/yoco/client";
import type { ActionResult } from "@/lib/types";
import type { DB } from "@/lib/db";

// Business-rule limits (L16)
const MAX_TOPUP_ZAR = 100_000;   // R1,000
const MAX_BALANCE_ZAR = 250_000; // R2,500

// ─── walletSpend ──────────────────────────────────────────────────────────────

/**
 * Debit a customer's wallet against an order (AT-114).
 * Atomically decrements wallet_zar (DB CHECK >= 0 is the safety net),
 * appends a wallet_transactions(kind='spend') row, reduces the order total,
 * recreates the Yoco intent for the remainder, and earns loyalty points
 * on the spent amount (L16: earn on wallet spend, not on top-up).
 */
export async function walletSpend(
  customerId: string,
  orderId: string,
  amountZar: number
): Promise<ActionResult<{ newTotalZar: number; clientSecret: string | null }>> {
  const auth = await authorize("barista", "admin");
  if (!auth.ok) return auth;
  const session = auth.session;

  if (!Number.isInteger(amountZar) || amountZar <= 0) {
    return { ok: false, code: "VALIDATION_ERROR", message: "amountZar must be a positive integer (cents)." };
  }

  const [order] = await db
    .select({ id: orders.id, state: orders.state, customerId: orders.customerId, totalZar: orders.totalZar })
    .from(orders)
    .where(eq(orders.id, orderId));

  if (!order) return { ok: false, code: "NOT_FOUND", message: "Order not found." };
  if (order.state !== "ordered") {
    return { ok: false, code: "CONFLICT", message: "Wallet can only be applied before payment (state='ordered')." };
  }
  if (order.customerId !== customerId) {
    return { ok: false, code: "VALIDATION_ERROR", message: "Customer does not match the order." };
  }
  if (amountZar > order.totalZar) {
    return { ok: false, code: "VALIDATION_ERROR", message: "Wallet spend cannot exceed the order total." };
  }

  const [customer] = await db
    .select({ walletZar: customers.walletZar })
    .from(customers)
    .where(eq(customers.id, customerId));

  if (!customer) return { ok: false, code: "NOT_FOUND", message: "Customer not found." };
  if (customer.walletZar < amountZar) {
    return {
      ok: false,
      code: "CONFLICT",
      message: `Insufficient wallet balance (${customer.walletZar} cents available, ${amountZar} cents requested).`,
    };
  }

  const newTotalZar = order.totalZar - amountZar;
  const pointsEarned = earnPoints(amountZar);

  // Create new Yoco checkout for the remaining order total (before DB transaction).
  let newClientSecret: string | null = null;
  if (newTotalZar > 0) {
    try {
      const intent = await createPaymentIntent({
        amountZar: newTotalZar,
        metadata: { orderId, customerId, kind: "wallet_partial" },
      });
      newClientSecret = intent.clientSecret;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Yoco checkout creation failed.";
      return { ok: false, code: "PAYMENT_ERROR", message };
    }
  }

  await db.transaction(async (tx) => {
    const txDb = tx as unknown as DB;

    // Atomic debit — DB CHECK (wallet_zar >= 0) is the safety net for concurrent calls.
    await tx
      .update(customers)
      .set({ walletZar: sql`${customers.walletZar} - ${amountZar}` })
      .where(eq(customers.id, customerId));

    // Wallet ledger entry (append-only).
    await tx.insert(walletTransactions).values({
      customerId,
      deltaZar: -amountZar,
      kind: "spend",
      relatedOrderId: orderId,
    });

    // Earn loyalty points on wallet spend (L16 — no earn on top-up).
    if (pointsEarned > 0) {
      await tx
        .update(customers)
        .set({ loyaltyPoints: sql`${customers.loyaltyPoints} + ${pointsEarned}` })
        .where(eq(customers.id, customerId));

      await tx.insert(loyaltyTransactions).values({
        customerId,
        orderId,
        delta: pointsEarned,
        kind: "earn",
      });
    }

    // Reduce order total so the Yoco charge covers only the remainder.
    await tx
      .update(orders)
      .set({ totalZar: newTotalZar })
      .where(eq(orders.id, orderId));

    // Update payment record to the new amount and checkout ID.
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
        action: "wallet_spend",
        actorId: session.id,
        actorRole: session.role,
        before: { totalZar: order.totalZar, walletZar: customer.walletZar },
        after: { totalZar: newTotalZar, walletZar: customer.walletZar - amountZar, pointsEarned },
      },
      txDb
    );
  });

  return { ok: true, data: { newTotalZar, clientSecret: newClientSecret } };
}

// ─── topUpWallet (limit enforcement) ─────────────────────────────────────────

/**
 * Validate top-up limits before creating a Yoco checkout (L16).
 * Max single top-up R1,000 (100,000 cents); max balance R2,500 (250,000 cents).
 * Returns an error if either limit would be breached.
 */
export async function validateTopUpLimits(
  customerId: string,
  amountZar: number
): Promise<ActionResult> {
  if (!Number.isInteger(amountZar) || amountZar <= 0) {
    return { ok: false, code: "VALIDATION_ERROR", message: "amountZar must be a positive integer (cents)." };
  }
  if (amountZar > MAX_TOPUP_ZAR) {
    return {
      ok: false,
      code: "VALIDATION_ERROR",
      message: `Single top-up cannot exceed R${MAX_TOPUP_ZAR / 100} (${MAX_TOPUP_ZAR} cents). Requested: ${amountZar} cents.`,
    };
  }

  const [customer] = await db
    .select({ walletZar: customers.walletZar })
    .from(customers)
    .where(eq(customers.id, customerId));

  if (!customer) return { ok: false, code: "NOT_FOUND", message: "Customer not found." };

  if (customer.walletZar + amountZar > MAX_BALANCE_ZAR) {
    return {
      ok: false,
      code: "CONFLICT",
      message: `Top-up would exceed max wallet balance of R${MAX_BALANCE_ZAR / 100}. Current: ${customer.walletZar} cents.`,
    };
  }

  return { ok: true, data: undefined };
}
