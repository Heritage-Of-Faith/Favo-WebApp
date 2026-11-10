// AT-205 — REQ-111, REQ-112, REQ-113, REQ-114, REQ-122, REQ-158 · PRD §7.0.2
// DAY + ROLLUP (L1772–1848), §6.9.4, §6.10.4, §7.2.
// Literal values: FIXTURE-A's Sunday (§7.0.3) is R350.00 gross, R196.36 cogs,
// R9.27 fees, R144.37 contribution. The voucher, fund, write-off and sweep
// cases are synthetic (the PRD prints no figures for them); what they assert
// is the PRD's rule — e.g. §6.9.4: ministry_net is IDENTICAL with and without
// the outreach reclassification.

import { describe, it, expect } from "vitest";
import { classifyDay, ministryRollup, type MinistryDay, type MinistrySession } from "@/lib/ministry-rollup";
import type { CostRollup } from "@/lib/cost-state";

function cogs(state: CostRollup["state"], cogsZar: number | null, absentItemIds: string[] = []): CostRollup & { absentItemNames: string[] } {
  return { state, cogsZar, absentItemIds, ordersWithoutCost: 0, orderCount: 1, absentItemNames: absentItemIds.map((id) => `name:${id}`) };
}

const SUNDAY: MinistrySession[] = [{ mode: "sunday", paymentPosture: null }];
const WEEKDAY_S: MinistrySession[] = [{ mode: "weekday", paymentPosture: null }];
const event = (p: MinistrySession["paymentPosture"]): MinistrySession => ({ mode: "event", paymentPosture: p });

const FIXTURE_A_SUNDAY: MinistryDay = {
  date: "2026-08-16",
  sessions: SUNDAY,
  orderCount: 13,
  cardGrossZar: 35000,
  fundGrossZar: 0,
  writtenOffZar: 0,
  cogs: cogs("provisional", 19636),
  outreachCogsZar: 0,
  outreachUnrecordedOrders: 0,
  outreachAbsentCostOrders: 0,
  cardOrdersWithoutFavoPayment: 0,
  processingFeeZar: 927,
};

const WEEKDAY: MinistryDay = {
  date: "2026-08-17",
  sessions: WEEKDAY_S,
  orderCount: 20,
  cardGrossZar: 0,
  fundGrossZar: 0,
  writtenOffZar: 0,
  cogs: cogs("provisional", 12000),
  outreachCogsZar: 0,
  outreachUnrecordedOrders: 0,
  outreachAbsentCostOrders: 0,
  cardOrdersWithoutFavoPayment: 0,
  processingFeeZar: 0,
};

const run = (days: MinistryDay[], o: { expensesZar?: number; writer?: boolean; sweepsZar?: number } = {}) =>
  ministryRollup({ days, expensesZar: o.expensesZar ?? 0, expenseWriterExists: o.writer ?? true, sweepsZar: o.sweepsZar ?? 0 });

describe("ministryRollup — §7.0.2 ROLLUP terms", () => {
  it("FIXTURE-A Sunday: contribution R144.37 enters ministry_income", () => {
    const r = run([FIXTURE_A_SUNDAY]);
    expect(r.ministryIncomeZar).toBe(14437);
    expect(r.days).toHaveLength(1);
    expect(r.days[0]).toMatchObject({ date: "2026-08-16", dayClass: "paid", grossZar: 35000, writtenOffZar: 0, collectedZar: 35000, cogsZar: 19636, outreachCogsZar: 0, processingFeeZar: 927, contributionZar: 14437 });
  });

  it("ministry_cost = weekday_cogs + free_event_cogs + outreach_cogs + Σ expenses; net = income − cost", () => {
    const r = run([FIXTURE_A_SUNDAY, WEEKDAY], { expensesZar: 50000 });
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
    expect(run([FIXTURE_A_SUNDAY]).ministryCostZar).toBe(0);
  });

  it("REQ-112: the processing fee is netted in contribution and never added to ministry_cost", () => {
    const r = run([FIXTURE_A_SUNDAY], { expensesZar: 50000 });
    expect(r.ministryCostZar).toBe(50000);
    expect(r.ministryIncomeZar).toBe(14437);
    expect(r.ministryNetZar).toBe(-35563);
  });

  it("REQ-114: with no logExpense writer, ministry_cost reads UNAVAILABLE, not COGS-only", () => {
    const r = run([WEEKDAY], { writer: false });
    expect(r.ministryCostZar).toBeNull();
    expect(r.ministryNetZar).toBeNull();
    expect(r.state).toBe("unavailable");
    expect(r.tone).toBe("unavailable");
    expect(r.unavailable).toContainEqual({ kind: "no_expense_writer" });
  });

  it("an unrecorded processing fee on a paid day makes ministry_income UNAVAILABLE, never a gross figure (REQ-108)", () => {
    const r = run([{ ...FIXTURE_A_SUNDAY, processingFeeZar: null }]);
    expect(r.ministryIncomeZar).toBeNull();
    expect(r.ministryCostZar).toBe(0);
    expect(r.ministryNetZar).toBeNull();
    expect(r.unavailable).toContainEqual({ kind: "fee_unrecorded", date: "2026-08-16" });
  });

  it("an absent ingredient cost names the item and refuses the figure it feeds (REQ-109)", () => {
    const r = run([{ ...WEEKDAY, cogs: cogs("unavailable", null, ["inv_oat"]) }]);
    expect(r.weekdayCogsZar).toBeNull();
    expect(r.ministryCostZar).toBeNull();
    expect(r.unavailable).toContainEqual({ kind: "absent_cost", date: "2026-08-17", itemNames: ["name:inv_oat"], ordersWithoutCost: 0 });
  });

  it("a day with no order and no money is skipped, whatever its sessions", () => {
    const r = run([{ ...WEEKDAY, date: "2026-08-22", sessions: [event(null)], orderCount: 0, cogs: cogs("empty", 0) }]);
    expect(r.ministryCostZar).toBe(0);
    expect(r.ministryIncomeZar).toBe(0);
    expect(r.ministryNetZar).toBe(0);
    expect(r.days).toEqual([]);
    expect(r.state).toBe("empty");
    expect(r.tone).toBe("neutral");
  });

  it("all-final inputs may render green; provisional never does (REQ-110)", () => {
    const green = run([{ ...FIXTURE_A_SUNDAY, cogs: cogs("final", 19636) }], { expensesZar: 10000 });
    expect(green.ministryNetZar).toBe(4437);
    expect(green.state).toBe("final");
    expect(green.tone).toBe("positive");
    const warn = run([FIXTURE_A_SUNDAY], { expensesZar: 10000 });
    expect(warn.ministryNetZar).toBe(4437);
    expect(warn.tone).toBe("warn");
    expect(warn.tone).not.toBe("positive");
  });
});

describe("event days by payment_posture (REQ-113, L1840)", () => {
  it("a paid event (standard or override) is a paid session: its contribution enters income, its COGS stays out of ministry_cost", () => {
    for (const posture of ["standard", "override"] as const) {
      const r = run([{ ...FIXTURE_A_SUNDAY, date: "2026-08-22", sessions: [event(posture)] }]);
      expect(r.days[0].dayClass).toBe("paid");
      expect(r.ministryIncomeZar).toBe(14437);
      expect(r.freeEventCogsZar).toBe(0);
      expect(r.ministryCostZar).toBe(0);
    }
  });

  it("a free event's COGS is free_event_cogs and enters ministry_cost", () => {
    const r = run([{ ...WEEKDAY, date: "2026-08-22", sessions: [event("free")], cogs: cogs("final", 4000) }]);
    expect(r.days[0].dayClass).toBe("free_event");
    expect(r.freeEventCogsZar).toBe(4000);
    expect(r.weekdayCogsZar).toBe(0);
    expect(r.ministryCostZar).toBe(4000);
  });

  it("an event session with no recorded posture is neither added nor dropped — UNAVAILABLE", () => {
    const r = run([{ ...WEEKDAY, date: "2026-08-22", sessions: [event(null)], cogs: cogs("final", 4000) }]);
    expect(r.freeEventCogsZar).toBeNull();
    expect(r.ministryCostZar).toBeNull();
    expect(r.ministryIncomeZar).toBeNull();
    expect(r.unavailable).toContainEqual({ kind: "event_posture_unrecorded", date: "2026-08-22" });
  });

  it("a Sunday morning and a paid Untracked evening are both paid sessions: contribution is Σ over them (COL-10)", () => {
    const r = run([{ ...FIXTURE_A_SUNDAY, sessions: [...SUNDAY, event("standard")] }]);
    expect(r.days[0].dayClass).toBe("paid");
    expect(r.ministryIncomeZar).toBe(14437);
  });

  it("a day with no session, or paid and unpaid sessions together, cannot be split — UNAVAILABLE", () => {
    const r = run([
      { ...WEEKDAY, sessions: [] },
      { ...WEEKDAY, date: "2026-08-18", sessions: [...WEEKDAY_S, ...SUNDAY] },
      { ...WEEKDAY, date: "2026-08-19", sessions: [...SUNDAY, event("free")] },
    ]);
    expect(r.ministryCostZar).toBeNull();
    expect(r.ministryIncomeZar).toBeNull();
    for (const date of ["2026-08-17", "2026-08-18", "2026-08-19"]) {
      expect(r.unavailable).toContainEqual({ kind: "mode_unresolved", date });
    }
  });

  it("classifyDay reads sessions, never the calendar", () => {
    expect(classifyDay(SUNDAY)).toBe("paid");
    expect(classifyDay(WEEKDAY_S)).toBe("weekday");
    expect(classifyDay([event("free"), event("free")])).toBe("free_event");
    expect(classifyDay([])).toBe("unresolved");
    expect(classifyDay([...SUNDAY, event(null)])).toBe("posture_unrecorded");
  });
});

describe("REQ-158 · §6.9.4 — outreach_cogs leaves contribution and enters ministry_cost", () => {
  // Synthetic: FIXTURE-A's Sunday with R20.00 of its R196.36 COGS on voucher lines.
  const withVouchers: MinistryDay = { ...FIXTURE_A_SUNDAY, outreachCogsZar: 2000 };

  it("contribution excludes outreach_cogs; ministry_cost includes it", () => {
    const r = run([withVouchers]);
    expect(r.days[0].contributionZar).toBe(16437); // 35000 − (19636 − 2000) − 927
    expect(r.ministryIncomeZar).toBe(16437);
    expect(r.outreachCogsZar).toBe(2000);
    expect(r.ministryCostZar).toBe(2000);
  });

  it("ministry_net is identical with and without the reclassification", () => {
    expect(run([withVouchers]).ministryNetZar).toBe(14437);
    expect(run([FIXTURE_A_SUNDAY]).ministryNetZar).toBe(14437);
  });

  it("the day still prints cogs_zar whole, with outreach_cogs beneath it", () => {
    const d = run([withVouchers]).days[0];
    expect(d.cogsZar).toBe(19636);
    expect(d.outreachCogsZar).toBe(2000);
  });

  it("on a free event, outreach is carved out of free_event_cogs so it is never counted twice", () => {
    const r = run([{ ...WEEKDAY, date: "2026-08-22", sessions: [event("free")], cogs: cogs("final", 4000), outreachCogsZar: 1000 }]);
    expect(r.freeEventCogsZar).toBe(3000);
    expect(r.outreachCogsZar).toBe(1000);
    expect(r.ministryCostZar).toBe(4000);
  });

  it("a voucher line whose COGS is not recorded makes outreach_cogs, contribution and ministry_cost UNAVAILABLE, never 0", () => {
    const r = run([{ ...FIXTURE_A_SUNDAY, outreachCogsZar: null, outreachUnrecordedOrders: 1 }]);
    expect(r.outreachCogsZar).toBeNull();
    expect(r.days[0].contributionZar).toBeNull();
    expect(r.ministryIncomeZar).toBeNull();
    expect(r.ministryCostZar).toBeNull();
    expect(r.unavailable).toContainEqual({ kind: "outreach_unrecorded", date: "2026-08-16", orders: 1 });
  });
});

describe("write-offs, fund draws and sweeps (REQ-111, L47, §6.10.4)", () => {
  it("REQ-111: a written-off order is gross but not collected, and not profit", () => {
    const r = run([{ ...FIXTURE_A_SUNDAY, writtenOffZar: 2000 }]);
    expect(r.days[0]).toMatchObject({ grossZar: 35000, writtenOffZar: 2000, collectedZar: 33000, contributionZar: 12437 });
  });

  it("a fund draw is gross at full price: fund_gross_zar adds to card_gross_zar", () => {
    const r = run([{ ...FIXTURE_A_SUNDAY, cardGrossZar: 33000, fundGrossZar: 2000 }]);
    expect(r.days[0].grossZar).toBe(35000);
    expect(r.ministryIncomeZar).toBe(14437);
  });

  it("Admin-confirmed sweeps are ministry income", () => {
    const r = run([FIXTURE_A_SUNDAY], { sweepsZar: 5000 });
    expect(r.sweepsZar).toBe(5000);
    expect(r.ministryIncomeZar).toBe(19437);
  });

  it("money on a day with no paid session belongs to no term — refused, never dropped", () => {
    const r = run([{ ...WEEKDAY, processingFeeZar: 53 }]);
    expect(r.unavailable).toContainEqual({ kind: "money_on_unpaid_day", date: "2026-08-17" });
    expect(r.ministryIncomeZar).toBeNull();
    expect(r.ministryCostZar).toBeNull();
  });
});

describe("review fixes — refusals that must never read as 0", () => {
  it("DEC-21: card sales taken on the Yoco machine outside FAVO make the day's fee UNAVAILABLE, never R0.00 (REQ-108)", () => {
    const r = run([{ ...FIXTURE_A_SUNDAY, processingFeeZar: 0, cardOrdersWithoutFavoPayment: 13 }]);
    expect(r.days[0].processingFeeZar).toBeNull();
    expect(r.days[0].contributionZar).toBeNull();
    expect(r.ministryIncomeZar).toBeNull();
    expect(r.unavailable).toContainEqual({ kind: "card_fee_outside_favo", date: "2026-08-16", orders: 13 });
  });

  it("a fully vouchered order with no order_cogs makes outreach_cogs and ministry_cost UNAVAILABLE, never 0", () => {
    const r = run([{ ...FIXTURE_A_SUNDAY, outreachCogsZar: null, outreachAbsentCostOrders: 1 }]);
    expect(r.outreachCogsZar).toBeNull();
    expect(r.ministryCostZar).toBeNull();
    expect(r.unavailable).toContainEqual({ kind: "outreach_cost_absent", date: "2026-08-16", orders: 1 });
    expect(r.unavailable.some((u) => u.kind === "outreach_unrecorded")).toBe(false);
  });

  it("a day refused as money_on_unpaid_day shows no cost figure in its row", () => {
    const r = run([{ ...WEEKDAY, cardGrossZar: 2000 }]);
    expect(r.days[0].ministryCogsZar).toBeNull();
    expect(r.days[0].state).toBe("unavailable");
    expect(r.weekdayCogsZar).toBeNull();
  });
});
