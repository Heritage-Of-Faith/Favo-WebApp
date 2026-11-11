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

export type ModeKey ="weekday" | "sunday" | "event" | "unassigned";

export type Consumption = { kind: string; unit: string; quantity: number };

export type SummaryDay = {
  date: string;
  /**
   * DEC-28 (d): "event" = only the day's orders stamped with an
   * orders.event_window_id; they are always reported as Event. Absent = the
   * day's other (unstamped) orders.
   */
  part?: "event";
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
  /**
   * REQ-123 / §7.3: walk-in coffees, the second weekday count. §7.0.2
   * walk_in_cups = Σ walk_ins.quantity (one row per order line, REQ-116), on
   * the day's counted orders.
   */
  walkInCups: number;
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
  walkInCups: number;
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

/**
 * DEC-28 (d): the mode of a day's UNSTAMPED orders when the same day also has
 * orders stamped with an event window (those are Event by their own stamp).
 * Since 0054 every event order is stamped, so the rest belong to the day's
 * non-event sessions. With no non-event session the day reads as dayMode.
 * Used only when the day has a stamped event part: a mixed day with none (all
 * orders from before the column) is still never guessed into a mode.
 */
export function restOfDayMode(date: string, sessionModes: readonly string[]): ModeKey {
  const nonEvent = sessionModes.filter((m) => m !== "event");
  return nonEvent.length > 0 ? dayMode(date, nonEvent) : dayMode(date, sessionModes);
}

function section(mode: ModeKey, days: readonly SummaryDay[]): ModeSection {
  let revenueZar = 0;
  let cogsSum = 0;
  let refused = false;
  let ordersWithoutCost = 0;
  let orderCount = 0;
  let drinks = 0;
  let staffCoffees = 0;
  let walkInCups = 0;
  const absent = new Set<string>();
  const use = new Map<string, Consumption>();

  for (const d of days) {
    revenueZar += d.revenueZar;
    orderCount += d.cogs.orderCount;
    ordersWithoutCost += d.cogs.ordersWithoutCost;
    drinks += d.drinks;
    staffCoffees += d.staffCoffees;
    walkInCups += d.walkInCups;
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
    days: [...new Set(days.map((d) => d.date))].sort(), // DEC-28 (d): a day may hold two parts
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
    walkInCups,
    consumption: [...use.values()].sort((a, b) => (a.kind + a.unit).localeCompare(b.kind + b.unit)),
  };
}

/** The week's days, split into the three modes (plus any day no mode can be given to). */
export function splitByMode(
  days: readonly SummaryDay[],
  sessionModes: ReadonlyMap<string, readonly string[]>
): Record<ModeKey, ModeSection> {
  const by: Record<ModeKey, SummaryDay[]> = { weekday: [], sunday: [], event: [], unassigned: [] };
  // DEC-28 (d): stamped event orders are Event; the rest of such a day reads
  // its non-event sessions' mode.
  const hasEventPart = new Set(days.filter((d) => d.part === "event").map((d) => d.date));
  for (const d of days) {
    const modes = sessionModes.get(d.date) ?? [];
    const key = d.part === "event" ? "event" : hasEventPart.has(d.date) ? restOfDayMode(d.date, modes) : dayMode(d.date, modes);
    by[key].push(d);
  }
  return {
    weekday: section("weekday", by.weekday),
    sunday: section("sunday", by.sunday),
    event: section("event", by.event),
    unassigned: section("unassigned", by.unassigned),
  };
}
