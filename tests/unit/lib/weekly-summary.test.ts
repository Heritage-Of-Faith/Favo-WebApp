// AT-206 — PRD §7.3 (weekly ops summary, "split by mode"), REQ-123,
// REQ-110/REQ-129/REQ-131 (three render states; never green on an estimate),
// REQ-106 (every figure a sum of per-order integers — nothing re-rounded).
// Pure: the day figures come from the one figure path (readDailyFigures).

import { describe, it, expect } from "vitest";
import { dayMode, splitByMode, type SummaryDay } from "@/lib/weekly-summary";

const empty = { state: "empty" as const, cogsZar: 0, absentItemNames: [], ordersWithoutCost: 0, orderCount: 0 };

function day(date: string, over: Partial<SummaryDay> = {}): SummaryDay {
  return { date, revenueZar: 0, cogs: empty, drinks: 0, staffCoffees: 0, consumption: [], ...over };
}

// Week Mon 10 .. Sun 16 Aug 2026.
const WEEK: SummaryDay[] = [
  day("2026-08-10", {
    cogs: { state: "provisional", cogsZar: 1352, absentItemNames: [], ordersWithoutCost: 0, orderCount: 3 },
    drinks: 3,
    staffCoffees: 2,
    consumption: [
      { kind: "milk", unit: "cup", quantity: 3 },
      { kind: "bean", unit: "cup", quantity: 4 },
    ],
  }),
  day("2026-08-11"),
  day("2026-08-12", {
    cogs: { state: "unavailable", cogsZar: null, absentItemNames: ["Oat Milk"], ordersWithoutCost: 1, orderCount: 2 },
    drinks: 2,
    staffCoffees: 1,
    consumption: [{ kind: "milk", unit: "cup", quantity: 2 }],
  }),
  day("2026-08-13"),
  day("2026-08-14"),
  day("2026-08-15"),
  day("2026-08-16", {
    revenueZar: 35000,
    cogs: { state: "provisional", cogsZar: 1588, absentItemNames: [], ordersWithoutCost: 0, orderCount: 9 },
    drinks: 10,
    consumption: [{ kind: "bean", unit: "cup", quantity: 15 }],
  }),
];

// Sessions: Monday and Sunday were opened; Wednesday's orders have no session row.
const SESSIONS = new Map<string, string[]>([
  ["2026-08-10", ["weekday"]],
  ["2026-08-16", ["sunday", "sunday"]],
]);

describe("dayMode — the day's mode is its session mode, defaulted from the date (§10.3)", () => {
  it("one distinct session mode wins", () => {
    expect(dayMode("2026-08-16", ["sunday", "sunday"])).toBe("sunday");
    expect(dayMode("2026-08-12", ["event"])).toBe("event");
  });
  it("no session → the date's default; a Saturday has none → unassigned", () => {
    expect(dayMode("2026-08-12", [])).toBe("weekday");
    expect(dayMode("2026-08-16", [])).toBe("sunday");
    expect(dayMode("2026-08-15", [])).toBe("unassigned");
  });
  it("two different modes on one day are never guessed between", () => {
    expect(dayMode("2026-08-16", ["sunday", "event"])).toBe("unassigned");
  });
});

describe("splitByMode — weekday, Sunday and events read separately", () => {
  const s = splitByMode(WEEK, SESSIONS);

  it("Sunday: revenue R350,00, COGS R15,88, margin R334,12 — provisional, never green", () => {
    expect(s.sunday).toMatchObject({
      days: ["2026-08-16"],
      revenueZar: 35000,
      cogsZar: 1588,
      grossMarginZar: 33412,
      costState: "provisional",
      tone: "warn",
      label: "provisional",
      drinks: 10,
    });
  });

  it("Weekday: an absent input makes the week's weekday cost UNAVAILABLE with the item named — never a smaller number", () => {
    expect(s.weekday).toMatchObject({
      days: ["2026-08-10", "2026-08-11", "2026-08-12", "2026-08-13", "2026-08-14"],
      revenueZar: 0,
      cogsZar: null,
      grossMarginZar: null,
      costState: "unavailable",
      tone: "unavailable",
      absentItemNames: ["Oat Milk"],
      ordersWithoutCost: 1,
      drinks: 5,
      staffCoffees: 3,
    });
    expect(s.weekday.consumption).toEqual([
      { kind: "bean", unit: "cup", quantity: 4 },
      { kind: "milk", unit: "cup", quantity: 5 },
    ]);
  });

  it("Events: no event day → a genuine zero (empty), not UNAVAILABLE", () => {
    expect(s.event).toMatchObject({ days: [], revenueZar: 0, cogsZar: 0, costState: "empty", tone: "neutral", orderCount: 0 });
  });

  it("an empty Saturday lands in unassigned with no orders", () => {
    expect(s.unassigned).toMatchObject({ days: ["2026-08-15"], orderCount: 0 });
  });

  it("the sections partition the week: their revenue and order counts add up to the week's", () => {
    const sections = [s.weekday, s.sunday, s.event, s.unassigned];
    expect(sections.reduce((t, x) => t + x.revenueZar, 0)).toBe(35000);
    expect(sections.reduce((t, x) => t + x.orderCount, 0)).toBe(14);
  });

  it("a Sunday whose every lot is invoice-backed may read profit", () => {
    const final = splitByMode(
      [day("2026-08-16", { revenueZar: 35000, cogs: { state: "final", cogsZar: 1588, absentItemNames: [], ordersWithoutCost: 0, orderCount: 9 } })],
      SESSIONS
    );
    expect(final.sunday).toMatchObject({ costState: "final", tone: "positive", label: "profit", grossMarginZar: 33412 });
  });
});
