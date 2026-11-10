// The payment gate on `ordered → in_progress` (L01, S3, S4, DEC-21), in one
// pure function used by transitionOrder (the server's check) and the POS queue
// card (which button it draws). Pure, no DB: the POS client imports it too.
//
// Owner decision, Mia, 9 Nov 2026 (PRD DEC-26): the gate no longer depends on
// whether YOCO_SECRET_KEY is set. A missing key used to switch the gate off in
// every mode; a set key with the unlinked Web POS port meant no Sunday order
// owing money could ever start. Now:
//   - a free (R0) order, or one settled from a blessing fund (L47), is open;
//   - a deferred order (payment_mode 'yoco_deferred', online or replayed
//     offline) is open in every mode: T3 step 2 "Queue behaves normally" and
//     §6.7 "the drink is made normally" — it is settled or written off later;
//   - a successful payment, or a SENT attempt that ended unresolved (REQ-008 /
//     S4: the drink is made while recovery asks Yoco), is open;
//   - DEC-21: while Sunday card sales are taken on the Yoco machine
//     (SUNDAY_ORDERS_NEVER_SWEPT_UNTIL_WEBPOS_LIVE, src/server/close/write-offs.ts),
//     an order whose revenue day is a Sunday — the same date rule as the
//     close's sweep, defaultSessionMode(revenueDay) === "sunday" — may start
//     without a FAVO payment, unless its latest attempt was sent to the
//     terminal (that one went through FAVO and keeps the normal rule, as in
//     the sweep). The server audits it as `sunday_started_without_favo_payment`
//     (a card sale is expected on the Yoco machine; FAVO has seen no payment).
//   - everything else needs a payment: PAYMENT_REQUIRED.

import { defaultSessionMode } from "@/lib/session-mode";
import { revenueDay } from "@/lib/format";
import type { Order } from "@/lib/types";

export type PaymentGate = "open" | "sunday_machine" | "payment_required";

export type PaymentGateFacts = {
  totalZar: number;
  /** orders.payment_mode; 'donor_fund' is settled with no payments row (L47). */
  paymentMode: string | null;
  /** orders.revenue_day, YYYY-MM-DD (SAST). */
  revenueDay: string;
  /** Every payment attempt, ORDER BY attempt (§10.3.3). */
  attempts: { status: string; sentAt: Date | string | null }[];
};

/** The order's revenue day is a Sunday. An unreadable day is not a Sunday (fails closed: the gate stays on). */
function isSundayRevenueDay(revenueDay: string): boolean {
  try {
    return defaultSessionMode(revenueDay) === "sunday";
  } catch {
    return false;
  }
}

/**
 * @param sundayCardOnMachine DEC-21's switch as it stands now
 *   (SUNDAY_ORDERS_NEVER_SWEPT_UNTIL_WEBPOS_LIVE).
 */
export function decidePaymentGate(f: PaymentGateFacts, sundayCardOnMachine: boolean): PaymentGate {
  if (f.totalZar <= 0) return "open";
  if (f.paymentMode === "donor_fund") return "open";
  if (f.paymentMode === "yoco_deferred") return "open";
  // Same predicate as isUnresolvedNeedingAttention (src/server/tender/tender.ts),
  // inlined so this file stays importable by the client.
  if (f.attempts.some((p) => p.status === "successful" || (p.status === "unresolved" && p.sentAt != null))) {
    return "open";
  }
  const latest = f.attempts[f.attempts.length - 1];
  const latestSent = latest != null && latest.sentAt != null;
  if (sundayCardOnMachine && !latestSent && isSundayRevenueDay(f.revenueDay)) return "sunday_machine";
  return "payment_required";
}

/**
 * The same decision from the POS queue card's Order shape. The card holds the
 * latest status, not every attempt, so it rebuilds the facts the gate reads:
 * a successful latest status, a SENT unresolved attempt (paymentAwaitingLookup),
 * and whether the latest attempt was sent (latestAttemptSent). A missing
 * revenueDay falls back to the SAST day of placedAt — the rule createOrder
 * used to write orders.revenue_day.
 */
export function decideQueueCardGate(o: Order, sundayCardOnMachine: boolean): PaymentGate {
  const attempts: PaymentGateFacts["attempts"] = [];
  if (o.paymentAwaitingLookup) attempts.push({ status: "unresolved", sentAt: SENT });
  if (o.paymentStatus) attempts.push({ status: o.paymentStatus, sentAt: o.latestAttemptSent ? SENT : null });
  return decidePaymentGate(
    {
      totalZar: o.totalZar,
      paymentMode: o.fundSettled ? "donor_fund" : (o.paymentMode ?? null),
      revenueDay: o.revenueDay ?? revenueDay(new Date(o.placedAt)),
      attempts,
    },
    sundayCardOnMachine
  );
}

/** Any non-null value: the card knows THAT an attempt was sent, not when. */
const SENT = "sent";
