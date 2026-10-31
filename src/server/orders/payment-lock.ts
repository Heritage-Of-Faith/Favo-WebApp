// Whether an order's total may still change — moved verbatim from
// src/server/actions/orders.ts (AT-204) so the voucher actions reuse it. Not a
// "use server" module: nothing here may become a client-callable action.
//
// AT-201 part 2b: the rule is the tender chain's (PRD P4, REQ-028). Used by
// applyFreeCoffee, declineFreeCoffee, redeemVoucher and removeVoucher.

import { eq } from "drizzle-orm";
import { payments } from "@db/schema";
import type { DB } from "@/lib/db";
import { isAttemptOpen } from "@/server/tender/tender";

export const ORDER_MOVED_ON = {
  ok: false as const,
  code: "ALREADY_RESOLVED",
  message: "Already paid or under way — the free cup can't change now.",
};

// Owner rule (Mia, 12 Oct 2026): a free-cup change is allowed ONLY while no
// tender attempt is open for the order. Once one is, the total is frozen
// (PRD P4, REQ-028) — the remedy is to cancel and re-ring. Owner-approved copy.
export const CHECKOUT_EXISTS = {
  ok: false as const,
  code: "TENDER_IN_PROGRESS",
  message: "Cancel and re-ring the order to change the free cup.",
};

/**
 * Read every payment attempt on the order (ORDER BY attempt, FOR UPDATE) and
 * say whether the order's total may still change. Called with the order row
 * already locked, which is the lock beginTender takes too. Never writes a
 * payments row — an attempt's amount is frozen once begun (P4), and a later
 * attempt is begun at the order's new total.
 *  - any `successful` attempt: already paid → refused.
 *  - any open attempt (`pending`, or sent and `unresolved`) → TENDER_IN_PROGRESS.
 *  - none, or only declined / closed-out never-sent attempts: allowed. "No
 *    row" is a normal state: no tender has begun yet.
 */
export async function lockPaymentForTotalChange(
  tx: Pick<DB, "select">,
  order: { id: string }
): Promise<{
  hasPayments: boolean;
  refusal: typeof ORDER_MOVED_ON | typeof CHECKOUT_EXISTS | null;
}> {
  const attempts = await tx
    .select({ status: payments.status, sentAt: payments.sentAt, yocoPaymentId: payments.yocoPaymentId })
    .from(payments)
    .where(eq(payments.orderId, order.id))
    .orderBy(payments.attempt)
    .for("update");
  const hasPayments = attempts.length > 0;
  if (attempts.some((p) => p.status === "successful")) return { hasPayments, refusal: ORDER_MOVED_ON };
  if (attempts.some(isAttemptOpen)) return { hasPayments, refusal: CHECKOUT_EXISTS };
  return { hasPayments, refusal: null };
}
