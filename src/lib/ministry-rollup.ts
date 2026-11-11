// AT-205 — REQ-112, REQ-113, REQ-114, REQ-122, REQ-134, REQ-158 · PRD §7.0.2
// DAY + ROLLUP (L1772–1848), §6.9.4, §6.10.4, §7.2.
//
//   gross_zar       = card_gross_zar + fund_gross_zar
//   collected_zar   = gross_zar − written_off_zar
//   contribution    = collected_zar − ( cogs_zar − outreach_cogs ) − processing_fee
//   ministry_cost   = weekday_cogs + free_event_cogs + outreach_cogs + Σ expenses(period)
//   ministry_income = Σ contribution over paid sessions + Σ Admin-confirmed sweeps
//   ministry_net    = ministry_income − ministry_cost
//
// Pure and client-safe. Every input is an integer-cent figure already summed
// from order_cogs (rounded once, per order — REQ-106); nothing here rounds.
//
// How each input is read — never as a smaller number (§7.0.2 refusal rule):
//   • Orders carry no session link, so a day is classed from its sessions.
//     A "paid session" is `sunday`, or `event` with payment_posture standard
//     or override (L1840). A day whose sessions are all paid sums its orders
//     as one: contribution is additive over orders, so this IS Σ per-session
//     contribution (COL-10). A day mixing a paid with an unpaid session, or
//     weekday with a free event, or with no session, cannot be split:
//     UNAVAILABLE. An event session with no recorded posture: UNAVAILABLE.
//   • outreach_cogs (REQ-158) leaves a paid day's contribution and enters
//     ministry_cost. On an unpaid day it is carved out of weekday/free-event
//     COGS so the same cost is never counted twice. NULL (a voucher on a line
//     whose COGS is not recorded) is UNAVAILABLE.
//   • processing_fee NULL (an unimported fee_zar) is UNAVAILABLE (REQ-108),
//     and so is a day holding a charged card order with no FAVO payment —
//     sold on the Yoco machine outside FAVO (DEC-21), its fee is not in FAVO.
//   • A fully vouchered order whose order_cogs is absent makes outreach_cogs
//     (and so ministry_cost) UNAVAILABLE, never 0.
//   • Money on an unpaid day — revenue, or a card fee — belongs to no term of
//     the rollup; it is refused rather than dropped.
//   • REQ-114: until logExpense has written, ministry_cost is UNAVAILABLE.
//   • sweeps: every `sweep` ledger entry is Admin-confirmed by construction
//     (sweepDonorFund is Admin-only, never a job — §6.10.4, REQ-177).

import { combineCostStates, netLabel, netTone, type CostRollup, type CostState, type NetTone } from "@/lib/cost-state";
import type { PaymentPosture, SessionMode } from "@/lib/session-mode";

export type MinistrySession = {
  mode: SessionMode;
  /** event_windows.payment_posture for an event session; NULL when not recorded. Ignored otherwise. */
  paymentPosture: PaymentPosture | null;
};

export type MinistryDay = {
  /** Revenue day, YYYY-MM-DD (L07). */
  date: string;
  sessions: readonly MinistrySession[];
  /** Counted orders (in_progress | ready | collected) on the day. */
  orderCount: number;
  /** Σ order_net_charged, payment_mode yoco | yoco_deferred. Integer cents. */
  cardGrossZar: number;
  /** Σ order_net_charged, payment_mode donor_fund. Integer cents. */
  fundGrossZar: number;
  /** Σ order_net_charged WHERE written_off_at IS NOT NULL. Integer cents. */
  writtenOffZar: number;
  /** The day's Σ order_cogs, from the one period-cogs read. */
  cogs: CostRollup & { absentItemNames: string[] };
  /** The day's outreach_cogs. NULL = UNAVAILABLE (see the two counts below). */
  outreachCogsZar: number | null;
  /** Partly vouchered orders: their voucher lines' COGS is not recorded per line. */
  outreachUnrecordedOrders: number;
  /** Fully vouchered orders whose order_cogs is absent (NULL or no row). */
  outreachAbsentCostOrders: number;
  /** Σ fees, integer cents. NULL = some successful payment's fee is unrecorded. */
  processingFeeZar: number | null;
  /**
   * Card-mode orders (yoco | yoco_deferred) with a charge, not written off,
   * holding no successful FAVO payment — sold on the Yoco machine outside FAVO
   * (DEC-21). Their fee is not in FAVO, so the day's processing_fee is
   * UNAVAILABLE, never 0 (REQ-108).
   */
  cardOrdersWithoutFavoPayment: number;
  /**
   * REQ-133 / §10.3.3: the day's yoco_deferred orders — already inside
   * cardGrossZar — split by how they ENDED (payment_mode only says how they
   * were taken). Absent = no yoco_deferred order on the day.
   */
  deferred?: DeferredSplit;
};

/**
 * REQ-133 · §10.3.3 · §7.5 "Deferred: open · settled · written off". Σ
 * order_net_charged of yoco_deferred orders, integer cents:
 *   open        settled_at IS NULL AND written_off_at IS NULL
 *   settled     settled_at IS NOT NULL (and not written off)
 *   writtenOff  written_off_at IS NOT NULL
 * A split of card_gross_zar for display only: no §7.0.2 term reads it, so no
 * total moves (gross, written_off_zar, collected and contribution are as before).
 */
export type DeferredSplit = { openZar: number; settledZar: number; writtenOffZar: number };

const NO_DEFERRED: DeferredSplit = { openZar: 0, settledZar: 0, writtenOffZar: 0 };

export type MinistryUnavailable =
  | { kind: "no_expense_writer" }
  | { kind: "absent_cost"; date: string; itemNames: string[]; ordersWithoutCost: number }
  | { kind: "fee_unrecorded"; date: string }
  | { kind: "card_fee_outside_favo"; date: string; orders: number }
  | { kind: "outreach_cost_absent"; date: string; orders: number }
  | { kind: "event_posture_unrecorded"; date: string }
  | { kind: "mode_unresolved"; date: string }
  | { kind: "outreach_unrecorded"; date: string; orders: number }
  | { kind: "money_on_unpaid_day"; date: string };

export type DayClass = "weekday" | "paid" | "free_event" | "posture_unrecorded" | "unresolved";

export type MinistryDayRow = {
  date: string;
  dayClass: DayClass;
  modes: SessionMode[];
  grossZar: number;
  writtenOffZar: number;
  collectedZar: number;
  /** cogs_zar printed whole (REQ-158). NULL = UNAVAILABLE. */
  cogsZar: number | null;
  /** Beneath cogs_zar. NULL = UNAVAILABLE. */
  outreachCogsZar: number | null;
  processingFeeZar: number | null;
  /** Paid days only; NULL on an unpaid day or when UNAVAILABLE. */
  contributionZar: number | null;
  /** Unpaid days: the day's cost entering ministry_cost (cogs − outreach). NULL otherwise or when UNAVAILABLE. */
  ministryCogsZar: number | null;
  /** REQ-133: the day's yoco_deferred split. Zeroes on a day with none. */
  deferred: DeferredSplit;
  state: CostState;
};

export type MinistryRollup = {
  /** NULL = UNAVAILABLE. */
  weekdayCogsZar: number | null;
  freeEventCogsZar: number | null;
  outreachCogsZar: number | null;
  expensesZar: number;
  sweepsZar: number;
  /** REQ-133: Σ of the days' yoco_deferred split over the period. */
  deferred: DeferredSplit;
  ministryCostZar: number | null;
  ministryIncomeZar: number | null;
  ministryNetZar: number | null;
  days: MinistryDayRow[];
  state: CostState;
  tone: NetTone;
  label: string;
  unavailable: MinistryUnavailable[];
};

function sessionClass(s: MinistrySession): Exclude<DayClass, "unresolved"> {
  if (s.mode === "weekday") return "weekday";
  if (s.mode === "sunday") return "paid";
  if (s.paymentPosture === null) return "posture_unrecorded";
  return s.paymentPosture === "free" ? "free_event" : "paid";
}

export function classifyDay(sessions: readonly MinistrySession[]): DayClass {
  if (sessions.length === 0) return "unresolved";
  const classes = new Set(sessions.map(sessionClass));
  if (classes.has("posture_unrecorded")) return "posture_unrecorded";
  if (classes.size !== 1) return "unresolved";
  return [...classes][0];
}

export function ministryRollup(input: {
  days: readonly MinistryDay[];
  /** Σ expenses.amount_zar over the period, integer cents. */
  expensesZar: number;
  /** True once logExpense has recorded at least one expense (REQ-114). */
  expenseWriterExists: boolean;
  /** Σ Admin-confirmed sweeps in the period (positive integer cents). */
  sweepsZar: number;
}): MinistryRollup {
  const unavailable: MinistryUnavailable[] = [];
  let costRefused = false;
  let incomeRefused = false;
  let weekdayRefused = false;
  let freeEventRefused = false;
  let outreachRefused = false;
  let weekdayCogs = 0;
  let freeEventCogs = 0;
  let outreachCogs = 0;
  let income = 0;
  const costStates: CostState[] = [];
  const incomeStates: CostState[] = [];
  const rows: MinistryDayRow[] = [];
  const deferred: DeferredSplit = { ...NO_DEFERRED };

  for (const day of input.days) {
    const grossZar = day.cardGrossZar + day.fundGrossZar;
    const hasMoney =
      grossZar !== 0 || day.processingFeeZar !== 0 || day.writtenOffZar !== 0 || day.cardOrdersWithoutFavoPayment > 0;
    if (day.orderCount === 0 && !hasMoney) continue;

    const dayClass = classifyDay(day.sessions);
    const collectedZar = grossZar - day.writtenOffZar;
    const cogsZar = day.cogs.cogsZar;
    const outreach = day.outreachCogsZar;
    // A card sale taken outside FAVO (DEC-21) has a real Yoco fee FAVO does
    // not hold: the day's fee is UNAVAILABLE, never the smaller sum (REQ-108).
    const feeZar = day.cardOrdersWithoutFavoPayment > 0 ? null : day.processingFeeZar;
    const row: MinistryDayRow = {
      date: day.date,
      dayClass,
      modes: [...new Set(day.sessions.map((s) => s.mode))],
      grossZar,
      writtenOffZar: day.writtenOffZar,
      collectedZar,
      cogsZar,
      outreachCogsZar: outreach,
      processingFeeZar: feeZar,
      contributionZar: null,
      ministryCogsZar: null,
      deferred: { ...(day.deferred ?? NO_DEFERRED) },
      state: day.cogs.state,
    };
    rows.push(row);
    deferred.openZar += row.deferred.openZar;
    deferred.settledZar += row.deferred.settledZar;
    deferred.writtenOffZar += row.deferred.writtenOffZar;

    if (cogsZar === null) {
      unavailable.push({ kind: "absent_cost", date: day.date, itemNames: day.cogs.absentItemNames, ordersWithoutCost: day.cogs.ordersWithoutCost });
    }
    if (outreach === null) {
      if (day.outreachAbsentCostOrders > 0) {
        unavailable.push({ kind: "outreach_cost_absent", date: day.date, orders: day.outreachAbsentCostOrders });
      }
      if (day.outreachUnrecordedOrders > 0 || day.outreachAbsentCostOrders === 0) {
        unavailable.push({ kind: "outreach_unrecorded", date: day.date, orders: day.outreachUnrecordedOrders });
      }
    }
    if (day.cardOrdersWithoutFavoPayment > 0) {
      unavailable.push({ kind: "card_fee_outside_favo", date: day.date, orders: day.cardOrdersWithoutFavoPayment });
    }

    switch (dayClass) {
      case "unresolved":
      case "posture_unrecorded":
        unavailable.push(dayClass === "unresolved" ? { kind: "mode_unresolved", date: day.date } : { kind: "event_posture_unrecorded", date: day.date });
        costRefused = true;
        incomeRefused = true;
        if (day.sessions.some((s) => s.mode === "weekday")) weekdayRefused = true;
        if (day.sessions.some((s) => s.mode === "event")) freeEventRefused = true;
        outreachRefused = true;
        row.state = "unavailable";
        break;

      case "weekday":
      case "free_event": {
        const refuse = () => {
          costRefused = true;
          if (dayClass === "weekday") weekdayRefused = true;
          else freeEventRefused = true;
          row.state = "unavailable";
        };
        if (outreach === null) outreachRefused = true;
        // Revenue or a card fee on a day nobody pays belongs to no rollup term.
        // The day is refused whole: its row shows no cost figure either.
        if (hasMoney) {
          unavailable.push({ kind: "money_on_unpaid_day", date: day.date });
          incomeRefused = true;
          refuse();
          break;
        }
        if (cogsZar === null || outreach === null) {
          refuse();
          break;
        }
        const own = cogsZar - outreach;
        row.ministryCogsZar = own;
        if (dayClass === "weekday") weekdayCogs += own;
        else freeEventCogs += own;
        outreachCogs += outreach;
        costStates.push(day.cogs.state);
        break;
      }

      case "paid": {
        if (day.processingFeeZar === null) unavailable.push({ kind: "fee_unrecorded", date: day.date });
        if (outreach === null) {
          outreachRefused = true;
          costRefused = true;
        } else {
          outreachCogs += outreach;
        }
        const contribution =
          cogsZar === null || feeZar === null || outreach === null
            ? null
            : collectedZar - (cogsZar - outreach) - feeZar;
        row.contributionZar = contribution;
        if (contribution === null) {
          incomeRefused = true;
          row.state = "unavailable";
        } else {
          income += contribution;
          incomeStates.push(day.cogs.state);
        }
        // outreach_cogs is a ministry cost: its accuracy is the same lots' accuracy.
        if (outreach !== null && outreach > 0) costStates.push(day.cogs.state);
        break;
      }
    }
  }

  if (!input.expenseWriterExists) {
    unavailable.push({ kind: "no_expense_writer" });
    costRefused = true;
  }
  // Expenses and sweeps are recorded amounts, not estimates.
  if (input.expensesZar > 0) costStates.push("final");
  if (input.sweepsZar > 0) incomeStates.push("final");

  const outreachCogsZar = outreachRefused ? null : outreachCogs;
  const ministryCostZar =
    costRefused || outreachCogsZar === null ? null : weekdayCogs + freeEventCogs + outreachCogsZar + input.expensesZar;
  const ministryIncomeZar = incomeRefused ? null : income + input.sweepsZar;
  const ministryNetZar = ministryCostZar === null || ministryIncomeZar === null ? null : ministryIncomeZar - ministryCostZar;

  const state: CostState =
    ministryNetZar === null ? "unavailable" : combineCostStates([...costStates, ...incomeStates]);
  const tone = netTone(state, ministryNetZar);

  return {
    weekdayCogsZar: weekdayRefused ? null : weekdayCogs,
    freeEventCogsZar: freeEventRefused ? null : freeEventCogs,
    outreachCogsZar,
    expensesZar: input.expensesZar,
    sweepsZar: input.sweepsZar,
    deferred,
    ministryCostZar,
    ministryIncomeZar,
    ministryNetZar,
    days: rows,
    state,
    tone,
    label: netLabel(tone),
    unavailable,
  };
}
