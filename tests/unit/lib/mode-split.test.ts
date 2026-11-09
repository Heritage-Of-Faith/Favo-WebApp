// REQ-121 · PRD §7.1 — the dashboard's figures split per mode, never one
// blended figure. Each mode is a SUM of its days' integers (REQ-106); an
// absent input → UNAVAILABLE with the item named (REQ-109); an estimate →
// provisional, never green (REQ-110); expenses carry no mode.

import { describe, it, expect } from "vitest";
import { splitFiguresByMode, type ModeDay } from "@/lib/mode-split";

const cost = (state: "empty" | "final" | "provisional" | "unavailable", cogsZar: number | null, orderCount: number, absent: string[] = []) => ({
  state,
  cogsZar,
  absentItemNames: absent,
  ordersWithoutCost: 0,
  orderCount,
});

// Week Mon 10 .. Sun 16 Aug 2026.
const DAYS: ModeDay[] = [
  { date: "2026-08-10", revenueZar: 0, expensesZar: 0, cogs: cost("provisional", 1352, 3) },
  { date: "2026-08-12", revenueZar: 0, expensesZar: 1000, cogs: cost("empty", 0, 0) },
  { date: "2026-08-16", revenueZar: 35000, expensesZar: 0, cogs: cost("final", 1588, 9) },
];
const SESSIONS = new Map<string, string[]>([
  ["2026-08-10", ["weekday"]],
  ["2026-08-16", ["sunday"]],
]);

describe("splitFiguresByMode", () => {
  const s = splitFiguresByMode("2026-08-10", "2026-08-16", DAYS, SESSIONS);

  it("Sunday reads revenue R350,00, COGS R15,88, margin R334,12 and its own profit flag", () => {
    expect(s.modes.sunday).toMatchObject({ revenueZar: 35000, cogsZar: 1588, grossMarginZar: 33412, costState: "final", tone: "positive", label: "profit" });
  });

  it("weekday is not blended with Sunday: R0 revenue, its own COGS, provisional and never green", () => {
    expect(s.modes.weekday).toMatchObject({ revenueZar: 0, cogsZar: 1352, grossMarginZar: -1352, costState: "provisional", tone: "warn", label: "provisional" });
  });

  it("an event-free period is a genuine zero, not UNAVAILABLE", () => {
    expect(s.modes.event).toMatchObject({ revenueZar: 0, cogsZar: 0, costState: "empty", tone: "neutral", orderCount: 0 });
  });

  it("expenses are the period's sum, reported once, not apportioned to a mode", () => {
    expect(s.expensesZar).toBe(1000);
    expect(s.modes.weekday).not.toHaveProperty("expensesZar");
  });

  it("an absent input makes that mode UNAVAILABLE with the item named — never a smaller number", () => {
    const u = splitFiguresByMode("2026-08-16", "2026-08-16", [{ date: "2026-08-16", revenueZar: 2000, expensesZar: 0, cogs: cost("unavailable", null, 1, ["Oat Milk"]) }], SESSIONS);
    expect(u.modes.sunday).toMatchObject({ cogsZar: null, grossMarginZar: null, tone: "unavailable", absentItemNames: ["Oat Milk"] });
  });
});
