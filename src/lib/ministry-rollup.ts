// AT-205 — REQ-112, REQ-113, REQ-114 · PRD §7.0.2 ROLLUP (L1825–1845), §7.2.
//
//   ministry_cost   = weekday_cogs + free_event_cogs + outreach_cogs + Σ expenses(period)
//   ministry_income = Σ contribution over paid sessions + Σ Admin-confirmed sweeps
//   ministry_net    = ministry_income − ministry_cost
//   contribution    = collected_zar − (cogs_zar − outreach_cogs) − processing_fee
//
// Pure and client-safe. Every input is an integer-cent figure already summed
// from order_cogs (rounded once, per order — REQ-106); nothing here rounds.
//
// What the substrate does not yet hold, and how it is read — never as a
// smaller number (§7.0.2 refusal rule):
//   • Orders carry no session link, so the mode is read per DAY from its
//     opening_sessions (same rule as cup-lid.ts / free-coffee.ts). A day with
//     orders and no session, or mixing weekday with sunday, is UNAVAILABLE.
//   • payment_posture (event_profiles) does not exist, so an event day with
//     orders cannot be split into free_event_cogs vs a paid contribution
//     (REQ-113): UNAVAILABLE.
//   • payments.fee_zar does not exist: a paid day with any settled card order
//     has an unrecorded fee, so its contribution is UNAVAILABLE.
//   • voucher_redemptions, written_off_at and fund sweeps do not exist, so
//     outreach_cogs, written_off_zar and sweeps are genuinely zero.
//   • REQ-114: until logExpense has written, ministry_cost is UNAVAILABLE.

import { combineCostStates, netLabel, netTone, type CostRollup, type CostState, type NetTone } from "@/lib/cost-state";
import type { SessionMode } from "@/lib/session-mode";

export type MinistryDay = {
  /** Revenue day, YYYY-MM-DD (L07). */
  date: string;
  /** That day's opening_sessions.mode values. */
  modes: readonly SessionMode[];
  /** Counted orders (in_progress | ready | collected) on the day. */
  orderCount: number;
  /** Σ orders.total_zar — gross charged, integer cents. */
  revenueZar: number;
  /** The day's Σ order_cogs, from the one period-cogs read. */
  cogs: CostRollup & { absentItemNames: string[] };
  /** Σ fees, integer cents. NULL = some settled order's fee is unrecorded. */
  processingFeeZar: number | null;
};

export type MinistryUnavailable =
  | { kind: "no_expense_writer" }
  | { kind: "absent_cost"; date: string; itemNames: string[]; ordersWithoutCost: number }
  | { kind: "fee_unrecorded"; date: string }
  | { kind: "event_posture_unrecorded"; date: string }
  | { kind: "mode_unresolved"; date: string };

export type PaidDay = {
  date: string;
  grossZar: number;
  cogsZar: number | null;
  processingFeeZar: number | null;
  /** NULL = UNAVAILABLE. */
  contributionZar: number | null;
};

export type MinistryRollup = {
  /** NULL = UNAVAILABLE. */
  weekdayCogsZar: number | null;
  freeEventCogsZar: number | null;
  outreachCogsZar: number;
  expensesZar: number;
  ministryCostZar: number | null;
  ministryIncomeZar: number | null;
  ministryNetZar: number | null;
  paidDays: PaidDay[];
  state: CostState;
  tone: NetTone;
  label: string;
  unavailable: MinistryUnavailable[];
};

type DayClass = "weekday" | "paid" | "event" | "unresolved";

function classify(modes: readonly SessionMode[]): DayClass {
  if (modes.length === 0) return "unresolved";
  if (modes.includes("event")) return "event";
  if (modes.every((m) => m === "weekday")) return "weekday";
  if (modes.every((m) => m === "sunday")) return "paid";
  return "unresolved";
}

export function ministryRollup(input: {
  days: readonly MinistryDay[];
  /** Σ expenses.amount_zar over the period, integer cents. */
  expensesZar: number;
  /** True once logExpense has recorded at least one expense (REQ-114). */
  expenseWriterExists: boolean;
}): MinistryRollup {
  const unavailable: MinistryUnavailable[] = [];
  let costRefused = false;
  let incomeRefused = false;
  let eventRefused = false;
  let weekdayRefused = false;
  let weekdayCogs = 0;
  let income = 0;
  const costStates: CostState[] = [];
  const incomeStates: CostState[] = [];
  const paidDays: PaidDay[] = [];

  const absent = (day: MinistryDay) => {
    unavailable.push({ kind: "absent_cost", date: day.date, itemNames: day.cogs.absentItemNames, ordersWithoutCost: day.cogs.ordersWithoutCost });
  };

  for (const day of input.days) {
    if (day.orderCount === 0) continue;
    switch (classify(day.modes)) {
      case "unresolved":
        unavailable.push({ kind: "mode_unresolved", date: day.date });
        costRefused = true;
        incomeRefused = true;
        break;
      case "event":
        unavailable.push({ kind: "event_posture_unrecorded", date: day.date });
        eventRefused = true;
        costRefused = true;
        incomeRefused = true;
        break;
      case "weekday":
        if (day.cogs.cogsZar === null) {
          absent(day);
          weekdayRefused = true;
          costRefused = true;
        } else {
          weekdayCogs += day.cogs.cogsZar;
          costStates.push(day.cogs.state);
        }
        break;
      case "paid": {
        // collected = gross − written_off (no write-off exists yet: 0);
        // outreach_cogs is 0 (no voucher exists yet).
        if (day.cogs.cogsZar === null) absent(day);
        if (day.processingFeeZar === null) unavailable.push({ kind: "fee_unrecorded", date: day.date });
        const contribution =
          day.cogs.cogsZar === null || day.processingFeeZar === null
            ? null
            : day.revenueZar - day.cogs.cogsZar - day.processingFeeZar;
        paidDays.push({
          date: day.date,
          grossZar: day.revenueZar,
          cogsZar: day.cogs.cogsZar,
          processingFeeZar: day.processingFeeZar,
          contributionZar: contribution,
        });
        if (contribution === null) incomeRefused = true;
        else {
          income += contribution;
          incomeStates.push(day.cogs.state);
        }
        break;
      }
    }
  }

  if (!input.expenseWriterExists) {
    unavailable.push({ kind: "no_expense_writer" });
    costRefused = true;
  }
  // Expenses are recorded amounts, not estimates.
  if (input.expensesZar > 0) costStates.push("final");

  // No event day with orders can be classed yet, so a non-refused period has
  // no free event COGS; voucher_redemptions does not exist, so no outreach COGS.
  const freeEventCogs = 0;
  const outreachCogsZar = 0;
  const freeEventCogsZar = eventRefused ? null : freeEventCogs;
  const ministryCostZar = costRefused ? null : weekdayCogs + freeEventCogs + outreachCogsZar + input.expensesZar;
  const ministryIncomeZar = incomeRefused ? null : income;
  const ministryNetZar = ministryCostZar === null || ministryIncomeZar === null ? null : ministryIncomeZar - ministryCostZar;

  const state: CostState =
    ministryNetZar === null ? "unavailable" : combineCostStates([...costStates, ...incomeStates]);
  const tone = netTone(state, ministryNetZar);

  return {
    weekdayCogsZar: weekdayRefused ? null : weekdayCogs,
    freeEventCogsZar,
    outreachCogsZar,
    expensesZar: input.expensesZar,
    ministryCostZar,
    ministryIncomeZar,
    ministryNetZar,
    paidDays,
    state,
    tone,
    label: netLabel(tone),
    unavailable,
  };
}
