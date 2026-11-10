// REQ-121 · PRD §7.1 — the live COGS dashboard's figures, split per mode.
// "Because weekday revenue is intentionally zero, the dashboard reports by
// mode rather than as one blended figure."
//
// Pure and client-safe. Built on the weekly summary's own mode split
// (splitByMode, src/lib/weekly-summary.ts): a day's mode is its opening
// session's mode, defaulted from the date (§10.3); a day no mode can be given
// to is "unassigned", never guessed. Each mode's revenue, COGS, gross margin
// and profit flag are SUMS of the days' integers passed through periodFigures
// — nothing here rounds (REQ-106). An absent input makes that mode's COGS
// UNAVAILABLE with the item named; an estimate makes it provisional, never
// green (REQ-109, REQ-110).
//
// Expenses carry no mode (an expense is dated, not sessioned), so they are
// reported once for the period, never apportioned to a mode.

import { splitByMode, type ModeKey, type ModeSection, type SummaryDay } from "@/lib/weekly-summary";

export type ModeFigures = Pick<
  ModeSection,
  | "mode"
  | "days"
  | "orderCount"
  | "revenueZar"
  | "cogsZar"
  | "grossMarginZar"
  | "costState"
  | "tone"
  | "label"
  | "absentItemNames"
  | "ordersWithoutCost"
>;

export type ModeSplit = {
  from: string;
  to: string;
  /** The period's expenses, integer cents — not split by mode. */
  expensesZar: number;
  modes: Record<ModeKey, ModeFigures>;
};

/** One day's money figures, as readDailyFigures returns them. */
export type ModeDay = Pick<SummaryDay, "date" | "revenueZar" | "cogs"> & { expensesZar: number };

export const MODE_KEYS: readonly ModeKey[] = ["weekday", "sunday", "event", "unassigned"];

function pick(s: ModeSection): ModeFigures {
  return {
    mode: s.mode,
    days: s.days,
    orderCount: s.orderCount,
    revenueZar: s.revenueZar,
    cogsZar: s.cogsZar,
    grossMarginZar: s.grossMarginZar,
    costState: s.costState,
    tone: s.tone,
    label: s.label,
    absentItemNames: s.absentItemNames,
    ordersWithoutCost: s.ordersWithoutCost,
  };
}

export function splitFiguresByMode(
  from: string,
  to: string,
  days: readonly ModeDay[],
  sessionModes: ReadonlyMap<string, readonly string[]>
): ModeSplit {
  const sections = splitByMode(
    days.map((d) => ({ date: d.date, revenueZar: d.revenueZar, cogs: d.cogs, drinks: 0, staffCoffees: 0, walkInCups: 0, consumption: [] })),
    sessionModes
  );
  return {
    from,
    to,
    expensesZar: days.reduce((s, d) => s + d.expensesZar, 0),
    modes: {
      weekday: pick(sections.weekday),
      sunday: pick(sections.sunday),
      event: pick(sections.event),
      unassigned: pick(sections.unassigned),
    },
  };
}
