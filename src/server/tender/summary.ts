// AT-201 part 2b: what an order's payment attempts mean to the screens that
// show one order (loadOrder, GET /api/pos/order/[id], /pos/order/[id]).
// PRD §10.3.3: one row per attempt, so every read by order is ORDER BY attempt
// and "the" status is the LATEST attempt's, never whichever row came back first.

import { isAttemptOpen, isUnresolvedNeedingAttention } from "./tender";
import type { PaymentStatus, TenderPayment } from "./types";

type AttemptRow = Pick<TenderPayment, "status" | "sentAt" | "yocoPaymentId">;

/** Pass the order's attempts ORDER BY attempt ASC. */
export function summarisePayments(rows: AttemptRow[]): {
  paymentStatus: PaymentStatus | null;
  /** P4: paid, or an attempt is open — the order's total may not change. */
  totalFrozen: boolean;
  /**
   * REQ-008 / S4: an attempt was SENT and ended `unresolved` — the drink is
   * made while recovery asks Yoco. A closed-out never-sent attempt (also
   * `unresolved`, sent_at NULL) is NOT this: that order is still owed and
   * re-tenderable.
   */
  awaitingLookup: boolean;
} {
  const latest = rows[rows.length - 1];
  return {
    paymentStatus: latest?.status ?? null,
    totalFrozen: rows.some((p) => p.status === "successful" || isAttemptOpen(p)),
    awaitingLookup: rows.some(isUnresolvedNeedingAttention),
  };
}
