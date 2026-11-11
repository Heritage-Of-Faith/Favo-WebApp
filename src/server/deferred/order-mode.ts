// The payment_mode a NEW order is written with (PRD v7.0 S7a, §6.0.4 T3 step
// 2, §6.7 "While deferred", L42/REQ-153). Pure.
//
//   'free'          weekday mode, or nothing owed. "'free' wins": deferred mode
//                   is inert where nobody pays (S7a).
//   'yoco_deferred' the open session is deferred — the order is taken unpaid,
//                   and createOrder begins no tender (the tender step is
//                   "replaced, not skipped").
//   'yoco'          otherwise, the card.

export type NewOrderMode = "free" | "yoco_deferred" | "yoco";

export function newOrderPaymentMode(i: { weekdayFree: boolean; totalZar: number; tillDeferred: boolean }): NewOrderMode {
  if (i.weekdayFree || i.totalZar === 0) return "free";
  return i.tillDeferred ? "yoco_deferred" : "yoco";
}
