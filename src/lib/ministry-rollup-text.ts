// REQ-109 · REQ-114 · REQ-129 · REQ-134 — the plain-words line for each
// reason the ministry rollup refuses a figure. UNAVAILABLE always names what
// is missing (§7.0.2: "with the offending ingredient named"). Pure.

import { UNAVAILABLE } from "@/lib/cost-state";
import type { DayClass, MinistryUnavailable } from "@/lib/ministry-rollup";

export function unavailableReason(u: MinistryUnavailable): string {
  switch (u.kind) {
    case "no_expense_writer":
      return `${UNAVAILABLE} — no expense has been recorded yet, so the ministry's cost would be COGS only. Record rent, utilities and wages under Expenses.`;
    case "absent_cost": {
      const parts = [...u.itemNames];
      if (u.ordersWithoutCost > 0) parts.push(`${u.ordersWithoutCost} order${u.ordersWithoutCost === 1 ? "" : "s"} with no recorded cost`);
      return `${u.date}: ${UNAVAILABLE} — ${parts.join(", ") || "a cost input is missing"}`;
    }
    case "fee_unrecorded":
      return `${u.date}: ${UNAVAILABLE} — card fees not imported yet (settles overnight)`;
    case "event_posture_unrecorded":
      return `${u.date}: ${UNAVAILABLE} — an event session has no payment posture recorded, so it is neither a paid nor a free event`;
    case "mode_unresolved":
      return `${u.date}: ${UNAVAILABLE} — the day's sessions cannot be split (no session, or paid and unpaid sessions on one day)`;
    case "outreach_unrecorded":
      return `${u.date}: ${UNAVAILABLE} — voucher drink cost can't be split out on ${u.orders} partly vouchered order${u.orders === 1 ? "" : "s"} (drink cost is recorded per order, not per line)`;
    case "outreach_cost_absent":
      return `${u.date}: ${UNAVAILABLE} — no drink cost recorded on ${u.orders} voucher order${u.orders === 1 ? "" : "s"}`;
    case "card_fee_outside_favo":
      return `${u.date}: ${UNAVAILABLE} — ${u.orders} card sale${u.orders === 1 ? "" : "s"} taken on the Yoco machine outside FAVO, so the card fees are not in FAVO`;
    case "money_on_unpaid_day":
      return `${u.date}: ${UNAVAILABLE} — revenue or a card fee on a day with no paid session`;
  }
}

export const DAY_CLASS_LABEL: Record<DayClass, string> = {
  weekday: "Weekday",
  paid: "Paid",
  free_event: "Event — free",
  posture_unrecorded: "Event — posture not recorded",
  unresolved: "Mixed / no session",
};
