// AT-206 — PRD §7.3 (weekly ops summary, "split by mode"), REQ-123,
// REQ-110/REQ-129/REQ-131 (three render states; never green on an estimate),
// REQ-106 (every figure a sum of per-order integers — nothing re-rounded).
// Pure: the day figures come from the one figure path (readDailyFigures).

import { describe, it, expect } from "vitest";
import { dayMode, splitByMode, type SummaryDay } from "@/lib/weekly-summary";

const empty = { state: "empty" as const, cogsZar: 0, absentItemNames: [], ordersWithoutCost: 0, orderCount: 0 };

function day(date: string, over: Partial<SummaryDay> = {}): SummaryDay {
  return { date, revenueZar: 0, cogs: empty, drinks: 0, staffCoffees: 0, walkInCups: 0, consumption: [], ...over };
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

  it("REQ-123 / §7.3: staff coffees and walk-in coffees are two separate weekday counts; zero is 0", () => {
    const w = splitByMode(
      [
        day("2026-08-10", { staffCoffees: 2, walkInCups: 3 }),
        day("2026-08-12", { staffCoffees: 1, walkInCups: 2 }),
      ],
      SESSIONS
    );
    expect(w.weekday).toMatchObject({ staffCoffees: 3, walkInCups: 5 });
    expect(w.sunday.walkInCups).toBe(0);
  });

  it("a Sunday whose every lot is invoice-backed may read profit", () => {
    const final = splitByMode(
      [day("2026-08-16", { revenueZar: 35000, cogs: { state: "final", cogsZar: 1588, absentItemNames: [], ordersWithoutCost: 0, orderCount: 9 } })],
      SESSIONS
    );
    expect(final.sunday).toMatchObject({ costState: "final", tone: "positive", label: "profit", grossMarginZar: 33412 });
  });
});

// DEC-28 (d) (owner, Mia, 11 Nov 2026): orders carry event_window_id, so an
// event's orders are reported in the Event column by their own stamp, and a
// day that also held a weekday or Sunday session reads that session's mode for
// the rest of its orders — instead of folding the whole day into unassigned.
describe("DEC-28 (d): event-stamped orders read as Event", () => {
  const WED = "2026-08-12";
  const cogs = (cogsZar: number, orderCount: number) =>
    ({ state: "final" as const, cogsZar, absentItemNames: [], ordersWithoutCost: 0, orderCount });

  it("a Wednesday with a weekday session and Discipleship 101: weekday orders → Weekday, event orders → Event", () => {
    const s = splitByMode(
      [
        day(WED, { cogs: cogs(1352, 3), drinks: 3, staffCoffees: 2 }),
        day(WED, { part: "event", cogs: cogs(1059, 2), drinks: 2 }),
      ],
      new Map([[WED, ["weekday", "event"]]])
    );
    expect(s.weekday).toMatchObject({ days: [WED], cogsZar: 1352, orderCount: 3, drinks: 3, staffCoffees: 2 });
    expect(s.event).toMatchObject({ days: [WED], revenueZar: 0, cogsZar: 1059, orderCount: 2, drinks: 2 });
    expect(s.unassigned).toMatchObject({ days: [], orderCount: 0 });
  });

  it("a Thursday paid event: its R76.00 is Event revenue, never weekday", () => {
    const THU = "2026-08-13";
    const s = splitByMode(
      [day(THU), day(THU, { part: "event", revenueZar: 7600, cogs: cogs(2118, 2) })],
      new Map([[THU, ["event"]]])
    );
    expect(s.event).toMatchObject({ days: [THU], revenueZar: 7600, cogsZar: 2118, grossMarginZar: 5482, orderCount: 2 });
    expect(s.weekday.revenueZar).toBe(0);
  });

  it("a Sunday morning and Untracked Church: Sunday orders stay Sunday, the evening's are Event", () => {
    const SUN = "2026-08-16";
    const s = splitByMode(
      [day(SUN, { revenueZar: 35000, cogs: cogs(1588, 9) }), day(SUN, { part: "event", revenueZar: 7600, cogs: cogs(1059, 2) })],
      new Map([[SUN, ["sunday", "event"]]])
    );
    expect(s.sunday).toMatchObject({ revenueZar: 35000, orderCount: 9 });
    expect(s.event).toMatchObject({ revenueZar: 7600, orderCount: 2 });
    expect(s.unassigned.orderCount).toBe(0);
  });

  it("a mixed day with NO stamped event order is still never guessed (orders from before the column)", () => {
    const s = splitByMode([day("2026-08-16", { revenueZar: 35000, cogs: cogs(1588, 9) })], new Map([["2026-08-16", ["sunday", "event"]]]));
    expect(s.unassigned).toMatchObject({ revenueZar: 35000, orderCount: 9 });
  });

  it("the sections still partition the week: Σ sections = Σ days", () => {
    const days = [
      day(WED, { revenueZar: 0, cogs: cogs(1352, 3) }),
      day(WED, { part: "event", revenueZar: 0, cogs: cogs(1059, 2) }),
      day("2026-08-16", { revenueZar: 35000, cogs: cogs(1588, 9) }),
      day("2026-08-16", { part: "event", revenueZar: 7600, cogs: cogs(1059, 2) }),
    ];
    const s = splitByMode(days, new Map([[WED, ["weekday", "event"]], ["2026-08-16", ["sunday", "event"]]]));
    const all = [s.weekday, s.sunday, s.event, s.unassigned];
    expect(all.reduce((t, x) => t + x.revenueZar, 0)).toBe(42600);
    expect(all.reduce((t, x) => t + (x.cogsZar ?? 0), 0)).toBe(1352 + 1059 + 1588 + 1059);
    expect(all.reduce((t, x) => t + x.orderCount, 0)).toBe(16);
  });
});
