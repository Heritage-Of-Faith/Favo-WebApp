"use server";

// Docs: docs/API.md → requestRefund, approveRefund
// Business rule L02: full refunds only in v1.
// NOTE: Yoco is currently simulated — approveRefund will return PAYMENT_ERROR
// until YOCO_SECRET_KEY is set and payments are live. requestRefund works
// independently of Yoco and can be used today.

import { eq, and } from "drizzle-orm";
import { db } from "@/lib/db";
import { refunds, payments, orders } from "@db/schema";
import { authorize } from "@/server/auth/guard";
import { writeAudit } from "@/server/audit";
import { createRefund } from "@/server/yoco/client";
import type { ActionResult } from "@/lib/types";
import type { DB } from "@/lib/db";

/**
 * Any staff member can raise a refund request. Creates a pending refund row.
 * Admin must approve before the Yoco API is called (approveRefund).
 * Requires a successful payment on the order.
 */
export async function requestRefund(
  orderId: string,
  reason: string
): Promise<ActionResult<{ refundId: string }>> {
  const auth = await authorize("barista", "admin");
  if (!auth.ok) return auth;
  const session = auth.session;

  const trimmedReason = reason?.trim() ?? "";
  if (!orderId) {
    return { ok: false, code: "VALIDATION_ERROR", message: "orderId is required." };
  }
  if (!trimmedReason) {
    return { ok: false, code: "VALIDATION_ERROR", message: "A reason is required." };
  }
  if (trimmedReason.length > 500) {
    return { ok: false, code: "VALIDATION_ERROR", message: "Reason must be 500 characters or less." };
  }

  const [order] = await db.select().from(orders).where(eq(orders.id, orderId));
  if (!order) {
    return { ok: false, code: "NOT_FOUND", message: "Order not found." };
  }

  // Require a successful payment — can't refund what was never charged.
  const [payment] = await db
    .select({ id: payments.id, amountZar: payments.amountZar })
    .from(payments)
    .where(and(eq(payments.orderId, orderId), eq(payments.status, "successful")));

  if (!payment) {
    return {
      ok: false,
      code: "CONFLICT",
      message: "No confirmed payment found for this order. Only paid orders can be refunded.",
    };
  }

  // One pending/approved refund per order max.
  const [existing] = await db
    .select({ id: refunds.id, status: refunds.status })
    .from(refunds)
    .where(eq(refunds.orderId, orderId));

  if (existing) {
    return {
      ok: false,
      code: "CONFLICT",
      message: `A refund for this order already exists (status: ${existing.status}).`,
    };
  }

  const [inserted] = await db
    .insert(refunds)
    .values({
      orderId,
      amountZar: payment.amountZar, // full amount — rule L02
      reason: trimmedReason,
      requestedBy: session.id,
      status: "pending",
    })
    .returning({ id: refunds.id });

  if (!inserted) {
    return { ok: false, code: "DB_ERROR", message: "Failed to create refund request." };
  }

  await writeAudit({
    entityKind: "refund",
    entityId: inserted.id,
    action: "refund_requested",
    actorId: session.id,
    actorRole: session.role,
    after: { orderId, amountZar: payment.amountZar, reason: trimmedReason },
  });

  return { ok: true, data: { refundId: inserted.id } };
}

/**
 * Admin approves a pending refund — calls the Yoco refund API (full amount,
 * rule L02) then atomically marks refund approved + payment refunded.
 * Requires admin role.
 */
export async function approveRefund(refundId: string): Promise<ActionResult> {
  const auth = await authorize("admin");
  if (!auth.ok) return auth;
  const session = auth.session;

  if (!refundId) {
    return { ok: false, code: "VALIDATION_ERROR", message: "refundId is required." };
  }

  const [refund] = await db.select().from(refunds).where(eq(refunds.id, refundId));
  if (!refund) {
    return { ok: false, code: "NOT_FOUND", message: "Refund not found." };
  }
  if (refund.status !== "pending") {
    return {
      ok: false,
      code: "CONFLICT",
      message: `Refund is already '${refund.status}' — cannot approve again.`,
    };
  }

  // Fetch the confirmed Yoco payment for this order.
  const [payment] = await db
    .select({ id: payments.id, yocoPaymentId: payments.yocoPaymentId })
    .from(payments)
    .where(and(eq(payments.orderId, refund.orderId), eq(payments.status, "successful")));

  if (!payment) {
    return {
      ok: false,
      code: "CONFLICT",
      message: "No confirmed payment found — cannot refund.",
    };
  }
  if (!payment.yocoPaymentId) {
    return {
      ok: false,
      code: "CONFLICT",
      message: "Yoco payment ID not yet received. Wait for the payment webhook before approving.",
    };
  }

  // Call Yoco refund API — must succeed before we update our DB.
  // Full amount only (rule L02). Will throw if YOCO_SECRET_KEY is not set.
  let yocoRefundId: string;
  try {
    const result = await createRefund(payment.yocoPaymentId, refund.amountZar);
    yocoRefundId = result.id;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Yoco refund API call failed.";
    return { ok: false, code: "PAYMENT_ERROR", message };
  }

  // Atomically mark refund approved + payment refunded + write audit.
  await db.transaction(async (tx) => {
    const txDb = tx as unknown as DB;

    await tx
      .update(refunds)
      .set({ status: "approved", approvedBy: session.id })
      .where(eq(refunds.id, refundId));

    await tx
      .update(payments)
      .set({ status: "refunded" })
      .where(eq(payments.id, payment.id));

    await writeAudit(
      {
        entityKind: "refund",
        entityId: refundId,
        action: "refund_approved",
        actorId: session.id,
        actorRole: session.role,
        after: { yocoRefundId, amountZar: refund.amountZar, orderId: refund.orderId },
      },
      txDb
    );
  });

  return { ok: true, data: undefined };
}
