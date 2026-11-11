// REQ-121 · §7.1 — the dashboard's per-mode table: revenue, COGS, margin and
// the profit flag for weekday, Sunday and event separately; UNAVAILABLE named,
// provisional never green, a mode with nothing a genuine zero.

import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";

vi.mock("@/server/actions/cogs", () => ({
  getModeSplit: vi.fn().mockResolvedValue({ ok: false, code: "FORBIDDEN", message: "Admin only" }),
}));

import { ModeSplitTable } from "@/components/admin/ModeSplitPanel";
import { splitFiguresByMode } from "@/lib/mode-split";

const SESSIONS = new Map<string, string[]>([
  ["2026-08-10", ["weekday"]],
  ["2026-08-16", ["sunday"]],
]);

const cells = (mode: string) =>
  within(document.querySelector(`tr[data-mode="${mode}"]`) as HTMLElement)
    .getAllByRole("cell")
    .map((c) => (c.textContent ?? "").replace(/\s/g, " "));

describe("ModeSplitTable", () => {
  it("one row per mode, never blended; expenses once for the period", () => {
    const split = splitFiguresByMode(
      "2026-08-10",
      "2026-08-16",
      [
        { date: "2026-08-10", revenueZar: 0, expensesZar: 1000, cogs: { state: "provisional", cogsZar: 1352, absentItemNames: [], ordersWithoutCost: 0, orderCount: 3 } },
        { date: "2026-08-16", revenueZar: 35000, expensesZar: 0, cogs: { state: "final", cogsZar: 1588, absentItemNames: [], ordersWithoutCost: 0, orderCount: 9 } },
      ],
      SESSIONS
    );
    render(<ModeSplitTable split={split} />);
    expect(cells("sunday")).toEqual(["Sunday", "R 350,00", "R 15,88", "R 334,12", "profit"]);
    expect(cells("weekday")).toEqual(["Weekday", "R 0,00", "R 13,52 · provisional", "-R 13,52", "provisional"]);
    expect(cells("event")).toEqual(["Event", "R 0,00", "R 0,00", "R 0,00", "No sales"]);
    expect(document.querySelector('tr[data-mode="unassigned"]')).toBeNull();
    expect((screen.getByTestId("mode-split-expenses").textContent ?? "").replace(/\s/g, " ")).toBe("Expenses (all modes): R 10,00");
  });

  it("an absent input reads UNAVAILABLE with the item named, never R0,00", () => {
    const split = splitFiguresByMode(
      "2026-08-16",
      "2026-08-16",
      [{ date: "2026-08-16", revenueZar: 2000, expensesZar: 0, cogs: { state: "unavailable", cogsZar: null, absentItemNames: ["Oat Milk"], ordersWithoutCost: 0, orderCount: 1 } }],
      SESSIONS
    );
    render(<ModeSplitTable split={split} />);
    expect(cells("sunday")).toEqual(["Sunday", "R 20,00", "UNAVAILABLE — Oat Milk", "UNAVAILABLE — Oat Milk", "UNAVAILABLE"]);
  });
});
