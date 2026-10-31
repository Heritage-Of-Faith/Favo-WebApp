// AT-206 — PRD §7.3 weekly ops summary, "split by mode, because the week runs
// under different economic rules". REQ-123 (split by mode), REQ-110/REQ-129/
// REQ-131 (three render states, never green on an estimate), REQ-106.
//
// Pure and client-safe. The inputs are per-day figures from the one figure
// path (readDailyFigures: Σ order_cogs, already rounded once per order); a
// section is a SUM of its days' integers — nothing here rounds — and its
// profit flag comes from periodFigures, the same function every surface uses.
//
// A day's mode is its opening session's mode (§10.3: "the day's mode,
// defaulted from the date"). A day with no session takes the date's default;
// a day with two different modes, or a Saturday with no session, is never
// guessed into a mode — it is "unassigned" and shown as such.

import { defaultSessionMode } from "@/lib/session-mode";
import { combineCostStates, periodFigures, type CostState, type NetTone } from "@/lib/cost-state";

/**
 * REQ-123 / §7.3 ask for a walk-in count beside staff coffees. No walk_ins
 * table exists yet (§6.5), so the count is not recorded anywhere — the screen
 * says so instead of printing a 0 that would read as "no walk-ins".
 */
export const WALK_IN_NOT_RECORDED = "not recorded yet";

export type ModeKey ="weekday" | "sunday" | "event" | "unassigned";

export type Consumption = { kind: string; unit: string; quantity: number };

export type SummaryDay = {
  date: string;
  revenueZar: number;
  cogs: {
    state: CostState;
    /** NULL = UNAVAILABLE. */
    cogsZar: number | null;
    absentItemNames: readonly string[];
    ordersWithoutCost: number;
    orderCount: number;
  };
  /** Σ order_items.quantity on the day's counted orders. */
  drinks: number;
  /** staff_entitlement_log rows (the free weekday cup, L03) on the day's counted orders. */
  staffCoffees: number;
  /** Bean and milk deducted for the day's counted orders, per (kind, unit). */
  consumption: readonly Consumption[];
};

export type ModeSection = {
  mode: ModeKey;
  days: string[];
  orderCount: number;
  revenueZar: number;
  /** NULL = UNAVAILABLE (any day's cost input absent). */
  cogsZar: number | null;
  /** revenue − cogs. NULL when cogs is. */
  grossMarginZar: number | null;
  costState: CostState;
  tone: NetTone;
  label: string;
  absentItemNames: string[];
  ordersWithoutCost: number;
  drinks: number;
  staffCoffees: number;
  consumption: Consumption[];
};

/** The mode a day's orders are reported under. */
export function dayMode(date: string, sessionModes: readonly string[]): ModeKey {
  const distinct = [...new Set(sessionModes)];
  if (distinct.length === 1) {
    const m = distinct[0];
    return m === "weekday" || m === "sunday" || m === "event" ? m : "unassigned";
  }
  if (distinct.length > 1) return "unassigned";
  return defaultSessionMode(date) ?? "unassigned";
}

function section(mode: ModeKey, days: readonly SummaryDay[]): ModeSection {
  let revenueZar = 0;
  let cogsSum = 0;
  let refused = false;
  let ordersWithoutCost = 0;
  let orderCount = 0;
  let drinks = 0;
  let staffCoffees = 0;
  const absent = new Set<string>();
  const use = new Map<string, Consumption>();

  for (const d of days) {
    revenueZar += d.revenueZar;
    orderCount += d.cogs.orderCount;
    ordersWithoutCost += d.cogs.ordersWithoutCost;
    drinks += d.drinks;
    staffCoffees += d.staffCoffees;
    if (d.cogs.cogsZar === null) refused = true;
    else cogsSum += d.cogs.cogsZar;
    for (const n of d.cogs.absentItemNames) absent.add(n);
    for (const c of d.consumption) {
      const key = `${c.kind}|${c.unit}`;
      const prev = use.get(key);
      use.set(key, { kind: c.kind, unit: c.unit, quantity: (prev?.quantity ?? 0) + c.quantity });
    }
  }

  const costState = combineCostStates(days.map((d) => d.cogs.state));
  const cogsZar = refused || costState === "unavailable" ? null : cogsSum;
  // Sections carry no expenses: §7.3's Sunday row is revenue, COGS and the
  // profit-or-loss flag; expenses are a week-level figure, not a mode's.
  const f = periodFigures({ revenueZar, cogsZar, expensesZar: 0, costState });

  return {
    mode,
    days: days.map((d) => d.date),
    orderCount,
    revenueZar,
    cogsZar: f.cogsZar,
    grossMarginZar: f.grossMarginZar,
    costState,
    tone: f.tone,
    label: f.label,
    absentItemNames: [...absent].sort(),
    ordersWithoutCost,
    drinks,
    staffCoffees,
    consumption: [...use.values()].sort((a, b) => (a.kind + a.unit).localeCompare(b.kind + b.unit)),
  };
}

/** The week's days, split into the three modes (plus any day no mode can be given to). */
export function splitByMode(
  days: readonly SummaryDay[],
  sessionModes: ReadonlyMap<string, readonly string[]>
): Record<ModeKey, ModeSection> {
  const by: Record<ModeKey, SummaryDay[]> = { weekday: [], sunday: [], event: [], unassigned: [] };
  for (const d of days) by[dayMode(d.date, sessionModes.get(d.date) ?? [])].push(d);
  return {
    weekday: section("weekday", by.weekday),
    sunday: section("sunday", by.sunday),
    event: section("event", by.event),
    unassigned: section("unassigned", by.unassigned),
  };
}
