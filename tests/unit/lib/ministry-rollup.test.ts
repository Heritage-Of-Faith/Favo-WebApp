// AT-205 — REQ-112, REQ-113, REQ-114 · PRD §7.0.2 ROLLUP (L1825–1845), §7.2.
// Literal values only: FIXTURE-A's Sunday (§7.0.3) is R350.00 gross, R196.36
// cogs, R9.27 fees, R144.37 contribution.

import { describe, it, expect } from "vitest";
import { ministryRollup, type MinistryDay } from "@/lib/ministry-rollup";
import type { CostRollup } from "@/lib/cost-state";

function cogs(state: CostRollup["state"], cogsZar: number | null, absentItemIds: string[] = []): CostRollup & { absentItemNames: string[] } {
  return { state, cogsZar, absentItemIds, ordersWithoutCost: 0, orderCount: 1, absentItemNames: absentItemIds.map((id) => `name:${id}`) };
}

const FIXTURE_A_SUNDAY: MinistryDay = {
  date: "2026-08-16",
  modes: ["sunday"],
  orderCount: 13,
  revenueZar: 35000,
  cogs: cogs("provisional", 19636),
  processingFeeZar: 927,
};

const WEEKDAY: MinistryDay = {
  date: "2026-08-17",
  modes: ["weekday"],
  orderCount: 20,
  revenueZar: 0,
  cogs: cogs("provisional", 12000),
  processingFeeZar: 0,
};

describe("ministryRollup — §7.0.2 ROLLUP terms", () => {
  it("FIXTURE-A Sunday: contribution R144.37 enters ministry_income", () => {
    const r = ministryRollup({ days: [FIXTURE_A_SUNDAY], expensesZar: 0, expenseWriterExists: true });
    expect(r.ministryIncomeZar).toBe(14437);
    expect(r.paidDays).toEqual([
      { date: "2026-08-16", grossZar: 35000, cogsZar: 19636, processingFeeZar: 927, contributionZar: 14437 },
    ]);
  });

  it("ministry_cost = weekday_cogs + free_event_cogs + outreach_cogs + Σ expenses; net = income − cost", () => {
    const r = ministryRollup({ days: [FIXTURE_A_SUNDAY, WEEKDAY], expensesZar: 50000, expenseWriterExists: true });
    expect(r.weekdayCogsZar).toBe(12000);
    expect(r.freeEventCogsZar).toBe(0);
    expect(r.outreachCogsZar).toBe(0);
    expect(r.expensesZar).toBe(50000);
    expect(r.ministryCostZar).toBe(62000);
    expect(r.ministryNetZar).toBe(14437 - 62000);
    expect(r.state).toBe("provisional");
    expect(r.tone).toBe("warn");
  });

  it("sunday_cogs is absent from ministry_cost (it is inside contribution)", () => {
    const r = ministryRollup({ days: [FIXTURE_A_SUNDAY], expensesZar: 0, expenseWriterExists: true });
    expect(r.ministryCostZar).toBe(0);
  });

  it("REQ-112: the processing fee is netted in contribution and never added to ministry_cost", () => {
    const r = ministryRollup({ days: [FIXTURE_A_SUNDAY], expensesZar: 50000, expenseWriterExists: true });
    expect(r.ministryCostZar).toBe(50000);
    expect(r.ministryIncomeZar).toBe(14437);
    expect(r.ministryNetZar).toBe(-35563);
  });

  it("REQ-114: with no logExpense writer, ministry_cost reads UNAVAILABLE, not COGS-only", () => {
    const r = ministryRollup({ days: [WEEKDAY], expensesZar: 0, expenseWriterExists: false });
    expect(r.ministryCostZar).toBeNull();
    expect(r.ministryNetZar).toBeNull();
    expect(r.state).toBe("unavailable");
    expect(r.tone).toBe("unavailable");
    expect(r.unavailable).toContainEqual({ kind: "no_expense_writer" });
  });

  it("REQ-113: an event day's payment posture is not recorded, so its COGS is neither added nor dropped — UNAVAILABLE", () => {
    const event: MinistryDay = { ...WEEKDAY, date: "2026-08-22", modes: ["event"], cogs: cogs("final", 4000) };
    const r = ministryRollup({ days: [event], expensesZar: 0, expenseWriterExists: true });
    expect(r.freeEventCogsZar).toBeNull();
    expect(r.ministryCostZar).toBeNull();
    expect(r.ministryIncomeZar).toBeNull();
    expect(r.unavailable).toContainEqual({ kind: "event_posture_unrecorded", date: "2026-08-22" });
  });

  it("an unrecorded processing fee on a paid day makes ministry_income UNAVAILABLE, never a gross figure", () => {
    const r = ministryRollup({ days: [{ ...FIXTURE_A_SUNDAY, processingFeeZar: null }], expensesZar: 0, expenseWriterExists: true });
    expect(r.ministryIncomeZar).toBeNull();
    expect(r.ministryCostZar).toBe(0);
    expect(r.ministryNetZar).toBeNull();
    expect(r.unavailable).toContainEqual({ kind: "fee_unrecorded", date: "2026-08-16" });
  });

  it("an absent ingredient cost names the item and refuses the figure it feeds", () => {
    const r = ministryRollup({
      days: [{ ...WEEKDAY, cogs: cogs("unavailable", null, ["inv_oat"]) }],
      expensesZar: 0,
      expenseWriterExists: true,
    });
    expect(r.weekdayCogsZar).toBeNull();
    expect(r.ministryCostZar).toBeNull();
    expect(r.unavailable).toContainEqual({ kind: "absent_cost", date: "2026-08-17", itemNames: ["name:inv_oat"], ordersWithoutCost: 0 });
  });

  it("a day with orders but no opening session, or mixing weekday and sunday, cannot be classed — UNAVAILABLE", () => {
    const r = ministryRollup({
      days: [{ ...WEEKDAY, modes: [] }, { ...WEEKDAY, date: "2026-08-18", modes: ["weekday", "sunday"] }],
      expensesZar: 0,
      expenseWriterExists: true,
    });
    expect(r.ministryCostZar).toBeNull();
    expect(r.unavailable).toContainEqual({ kind: "mode_unresolved", date: "2026-08-17" });
    expect(r.unavailable).toContainEqual({ kind: "mode_unresolved", date: "2026-08-18" });
  });

  it("a day with no order is skipped, whatever its sessions", () => {
    const r = ministryRollup({
      days: [{ date: "2026-08-22", modes: ["event"], orderCount: 0, revenueZar: 0, cogs: cogs("empty", 0), processingFeeZar: 0 }],
      expensesZar: 0,
      expenseWriterExists: true,
    });
    expect(r.ministryCostZar).toBe(0);
    expect(r.ministryIncomeZar).toBe(0);
    expect(r.ministryNetZar).toBe(0);
    expect(r.state).toBe("empty");
    expect(r.tone).toBe("neutral");
  });

  it("all-final inputs may render green; provisional never does", () => {
    const sunday = { ...FIXTURE_A_SUNDAY, cogs: cogs("final", 19636) };
    const green = ministryRollup({ days: [sunday], expensesZar: 10000, expenseWriterExists: true });
    expect(green.ministryNetZar).toBe(4437);
    expect(green.state).toBe("final");
    expect(green.tone).toBe("positive");
    const warn = ministryRollup({ days: [FIXTURE_A_SUNDAY], expensesZar: 10000, expenseWriterExists: true });
    expect(warn.tone).toBe("warn");
  });
});
