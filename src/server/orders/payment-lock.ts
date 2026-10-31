// Whether an order's total may still change — moved verbatim from
// src/server/actions/orders.ts (AT-204) so the voucher actions reuse it. Not a
// "use server" module: nothing here may become a client-callable action.

import { eq } from "drizzle-orm";
import { payments } from "@db/schema";
import type { DB } from "@/lib/db";

export const ORDER_MOVED_ON = {
  ok: false as const,
  code: "ALREADY_RESOLVED",
  message: "Already paid or under way — the free cup can't change now.",
};

// Owner rule (Mia, 12 Oct 2026): a free-cup change is allowed ONLY while no
// card checkout has been set up for the order. Once one exists the total is
// frozen (PRD P4) — the remedy is to cancel and re-ring. Owner-approved copy.
export const CHECKOUT_EXISTS = {
  ok: false as const,
  code: "TENDER_IN_PROGRESS",
  message: "Cancel and re-ring the order to change the free cup.",
};

// PRD S1 STALE_STATE: createOrder has committed the order but not yet written
// its payments row. Refusing here means createOrder's later insert can never
// meet a row written by a concurrent decline.
export const ROW_NOT_WRITTEN_YET = {
  ok: false as const,
  code: "STALE_STATE",
  message: "This order just changed — reloading",
};

type LockedPayment = { id: string } | null;

/**
 * Lock the order's payments row (SELECT … FOR UPDATE, as the webhook does) and
 * say whether the order's total may still change. Never deletes anything.
 *  - no row: allowed only for a `free` order (REQ-153 — it never gets one
 *    from createOrder); a chargeable order with no row yet is mid-createOrder.
 *  - a row carrying a Yoco checkout or payment id: a checkout exists → refused.
 *  - a `successful` row: already paid. Any other non-pending row: refused.
 *  - a `pending` row with no checkout (Yoco was unavailable at ring-up): allowed.
 */
export async function lockPaymentForTotalChange(
  tx: Pick<DB, "select">,
  order: { id: string; totalZar: number; paymentMode: string | null }
): Promise<{
  payment: LockedPayment;
  refusal: typeof ORDER_MOVED_ON | typeof CHECKOUT_EXISTS | typeof ROW_NOT_WRITTEN_YET | null;
}> {
  const [payment] = await tx
    .select({
      id: payments.id,
      status: payments.status,
      yocoCheckoutId: payments.yocoCheckoutId,
      yocoPaymentId: payments.yocoPaymentId,
    })
    .from(payments)
    .where(eq(payments.orderId, order.id))
    .for("update");
  if (!payment) {
    const free = order.paymentMode === "free" || order.totalZar === 0;
    return { payment: null, refusal: free ? null : ROW_NOT_WRITTEN_YET };
  }
  if (payment.status === "successful") return { payment, refusal: ORDER_MOVED_ON };
  if (payment.yocoCheckoutId || payment.yocoPaymentId || payment.status !== "pending") {
    return { payment, refusal: CHECKOUT_EXISTS };
  }
  return { payment: { id: payment.id }, refusal: null };
}
