// Admin QA P1 (old dashboard): "Revenue R3 113 − COGS R320,52 shows NET R62,48;
// 15 Oct shows −R261,05 LOSS while the COGS CSV shows a R388,95 margin; the
// donut says COGS is 84% of revenue while the tile says 10%; LOSS on R0 days."
//
// Root cause, reproduced: net silently subtracted expenses that no tile showed
// (R3 113 − R320,52 − R2 730 = R62,48; R388,95 − R650 = −R261,05), the donut's
// % was COGS ÷ (COGS + net) instead of ÷ revenue (320,52 ÷ 383 = 84%), and a
// R0 day read "loss". Here the SAME orders go through the dashboard day, the
// CSV, the weekly and the monthly report, and every figure must agree, in
// integer cents. db is mocked; each query is answered by what it reads.

import { describe, it, expect, vi, beforeEach } from "vitest";

const inserted: Record<string, unknown>[] = [];

// One day of data: 15 Oct 2026. Revenue R500,00; COGS R111,05 (two orders,
// final); expenses R650,00. Gross margin R388,95; net −R261,05.
const DAY = "2026-10-15";
const REVENUE = [{ revenue_day: DAY, revenue_zar: "50000" }];
const COGS = [
  { revenue_day: DAY, cogs_zar: 5000, absent_item_ids: [], estimated: false, missing: false },
  { revenue_day: DAY, cogs_zar: 6105, absent_item_ids: [], estimated: false, missing: false },
];
const EXPENSES = [{ sast_date: DAY, expenses_zar: "65000" }];

vi.mock("@/server/auth/guard", () => ({
  authorize: vi.fn().mockResolvedValue({ ok: true, session: { id: "s1", role: "admin", name: "Admin" } }),
}));
vi.mock("@/server/audit", () => ({ writeAudit: vi.fn().mockResolvedValue(undefined) }));

vi.mock("@db/index", async () => {
  const { PgDialect } = await import("drizzle-orm/pg-core");
  const dialect = new PgDialect();
  const insert = vi.fn().mockImplementation(() => ({
    values: (v: Record<string, unknown>) => {
      inserted.push(v);
      // CHANGED (AT-206): the weekly insert now goes through onConflictDoNothing.
      const returning = () => Promise.resolve([{ id: "r1" }]);
      return { returning, onConflictDoNothing: () => ({ returning }) };
    },
  }));
  return {
    db: {
      execute: vi.fn().mockImplementation(async (q: Parameters<typeof dialect.sqlToQuery>[0]) => {
        const text = dialect.sqlToQuery(q).sql;
        if (text.includes("FROM orders o")) return COGS;
        if (text.includes("FROM expenses")) return EXPENSES;
        if (text.includes("SUM(total_zar)")) return REVENUE;
        if (text.includes("FROM inventory_items")) return [];
        throw new Error(`unexpected query: ${text}`);
      }),
      select: vi.fn().mockImplementation(() => {
        const c: Record<string, unknown> = {};
        c.from = () => c;
        c.where = () => Promise.resolve([]); // no existing report
        return c;
      }),
      insert,
      transaction: vi.fn().mockImplementation(async (fn: (tx: unknown) => Promise<void>) => fn({ insert })),
    },
  };
});

describe("one figure path — 15 Oct, same orders, every surface agrees (integer cents)", () => {
  beforeEach(() => {
    inserted.length = 0;
  });

  it("dashboard day, CSV row, weekly and monthly report give the same revenue, COGS, margin, expenses and net", async () => {
    const { getCogsLive } = await import("@/server/cogs/compute");
    const { buildReportRows } = await import("@/server/reports/export-csv");
    const { generateWeeklyPnL } = await import("@/server/crons/generate-weekly-pnl");
    const { generateMonthlyPnL } = await import("@/server/actions/monthly-pnl");

    const day = await getCogsLive(DAY);
    const [row] = await buildReportRows(DAY, DAY);
    await generateWeeklyPnL(new Date(`${DAY}T12:00:00+02:00`));
    await generateMonthlyPnL("2026-10-01");
    const [weekly, monthly] = inserted;

    const expected = { revenueZar: 50000, cogsZar: 11105, grossMarginZar: 38895, expensesZar: 65000, netZar: -26105 };
    expect(day).toMatchObject(expected);
    expect(row).toMatchObject(expected);
    expect(weekly).toMatchObject(expected);
    expect(monthly).toMatchObject(expected); // monthly no longer hard-codes expenses to 0
    expect(row.grossMarginPct).toBe(77.79); // 38895 / 50000
  });
});

describe("the dashboard's own arithmetic (aggregate, donut, tone) — the QA screenshots", () => {
  it("R3 113 revenue, R320,52 COGS, R2 730 expenses → net R62,48, and the expenses are SHOWN, not hidden", async () => {
    const { aggregate } = await import("@/components/admin/CogsDashboard");
    const kpi = aggregate(
      [
        {
          date: DAY, revenueZar: 311300, cogsZar: 32052, expensesZar: 273000,
          grossMarginZar: null, netZar: null, costState: "final", absentItems: [], ordersWithoutCost: 0,
        },
      ],
      DAY
    );
    expect(kpi.netZar).toBe(6248);
    expect(kpi.grossMarginZar).toBe(279248);
    expect(kpi.expensesZar).toBe(273000);
  });

  it("the donut's COGS % is its share of revenue — the tile's 10%, not 84%", async () => {
    const { allocationSlices } = await import("@/components/admin/CogsDashboard");
    const { periodFigures } = await import("@/lib/cost-state");
    const kpi = { revenueZar: 311300, cogsZar: 32052, expensesZar: 273000, netZar: 6248 };
    const a = allocationSlices(kpi)!;
    const total = a.slices.reduce((s, x) => s + x.value, 0);
    expect(total).toBe(311300); // COGS + expenses + net = revenue
    const donutPct = Math.round((a.slices[0].value / total) * 100);
    const tilePct = Math.round(periodFigures({ ...kpi, costState: "final" }).cogsPctOfRevenue!);
    expect(donutPct).toBe(10);
    expect(tilePct).toBe(10);
    expect(a.centerZar).toBe(311300);
  });

  it("a loss: the donut splits COGS and expenses of COSTS and says so", async () => {
    const { allocationSlices } = await import("@/components/admin/CogsDashboard");
    const a = allocationSlices({ revenueZar: 50000, cogsZar: 11105, expensesZar: 65000, netZar: -26105 })!;
    expect(a.slices.map((s) => s.label)).toEqual(["COGS", "Expenses"]);
    expect(a.centerZar).toBe(76105);
    expect(a.centerSub).toBe("costs");
  });
});

describe("R0 / empty days are neutral 'No sales', never 'loss'", () => {
  it("no orders, no expenses → neutral, 'No sales'", async () => {
    const { periodFigures } = await import("@/lib/cost-state");
    const f = periodFigures({ revenueZar: 0, cogsZar: 0, expensesZar: 0, costState: "empty" });
    expect(f).toMatchObject({ netZar: 0, tone: "neutral", label: "No sales" });
  });

  it("no orders but an expense logged → still neutral 'No sales', not 'loss'", async () => {
    const { periodFigures } = await import("@/lib/cost-state");
    const f = periodFigures({ revenueZar: 0, cogsZar: 0, expensesZar: 5000, costState: "empty" });
    expect(f.netZar).toBe(-5000);
    expect(f.tone).toBe("neutral");
    expect(f.label).toBe("No sales");
  });

  it("a real costed loss still says 'loss'", async () => {
    const { periodFigures } = await import("@/lib/cost-state");
    const f = periodFigures({ revenueZar: 50000, cogsZar: 11105, expensesZar: 65000, costState: "final" });
    expect(f).toMatchObject({ netZar: -26105, tone: "negative", label: "loss" });
  });
});
