// AT-189 · AT-190 · AT-192 — REQ-106, REQ-109, REQ-129. generateMonthlyPnL
// stores Σ order_cogs over the month's revenue days with its cost state and
// the count of orders without a cost row (S3), and reads revenue and expenses
// for exactly the same revenue days (N2, QA P1). db is mocked; each query is
// answered by what it reads.

import { describe, it, expect, vi, beforeEach } from "vitest";

const inserted: Record<string, unknown>[] = [];
const queries: { sql: string; params: unknown[] }[] = [];
const data: { cogs: unknown[]; names: unknown[]; revenue: unknown[]; expenses: unknown[] } = {
  cogs: [],
  names: [],
  revenue: [],
  expenses: [],
};

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
      return { returning: () => Promise.resolve([{ id: "mr_1" }]) };
    },
  }));
  return {
    db: {
      execute: vi.fn().mockImplementation(async (q: Parameters<typeof dialect.sqlToQuery>[0]) => {
        const { sql: text, params } = dialect.sqlToQuery(q);
        queries.push({ sql: text, params });
        if (text.includes("FROM orders o")) return data.cogs;
        if (text.includes("FROM inventory_items")) return data.names;
        if (text.includes("FROM expenses")) return data.expenses;
        if (text.includes("SUM(total_zar)")) return data.revenue;
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

describe("generateMonthlyPnL — cost state and revenue bucket", () => {
  beforeEach(() => {
    inserted.length = 0;
    queries.length = 0;
    data.cogs = [];
    data.names = [];
    data.revenue = [{ revenue_day: "2026-08-16", revenue_zar: "35000" }];
    data.expenses = [];
  });

  it("stores UNAVAILABLE with the item named and the orders-without-cost count (S3)", async () => {
    data.cogs = [
      { revenue_day: "2026-08-16", cogs_zar: 1352, absent_item_ids: [], estimated: true, missing: false },
      { revenue_day: "2026-08-16", cogs_zar: null, absent_item_ids: ["inv_item_oat_milk"], estimated: true, missing: false },
      { revenue_day: "2026-08-02", cogs_zar: null, absent_item_ids: [], estimated: null, missing: true },
    ];
    data.names = [{ id: "inv_item_oat_milk", name: "Oat Milk" }];
    const { generateMonthlyPnL } = await import("@/server/actions/monthly-pnl");
    const r = await generateMonthlyPnL("2026-08-01");
    expect(r.ok).toBe(true);
    expect(inserted[0]).toMatchObject({
      month: "2026-08-01",
      revenueZar: 35000,
      cogsZar: null,
      grossMarginZar: null,
      netZar: null,
      costState: "unavailable",
      cogsAbsentItems: ["Oat Milk"],
      ordersWithoutCost: 1,
    });
  });

  it("N2: revenue, COGS and expenses all read revenue days 2026-08-01..2026-08-31 (not placed_at)", async () => {
    data.revenue = [];
    const { generateMonthlyPnL } = await import("@/server/actions/monthly-pnl");
    await generateMonthlyPnL("2026-08-01");
    const rev = queries.find((q) => q.sql.includes("SUM(total_zar)"))!;
    expect(rev.sql).toContain("revenue_day");
    expect(rev.sql).not.toContain("placed_at");
    for (const q of queries) expect(q.params).toEqual(["2026-08-01", "2026-08-31"]);
    expect(inserted[0]).toMatchObject({ costState: "empty", cogsZar: 0, ordersWithoutCost: 0 });
  });

  it("QA P1: net subtracts the month's expenses, as the weekly report and the dashboard do", async () => {
    data.cogs = [{ revenue_day: "2026-08-16", cogs_zar: 11105, absent_item_ids: [], estimated: false, missing: false }];
    data.expenses = [{ sast_date: "2026-08-20", expenses_zar: "65000" }];
    data.revenue = [{ revenue_day: "2026-08-16", revenue_zar: "50000" }];
    const { generateMonthlyPnL } = await import("@/server/actions/monthly-pnl");
    await generateMonthlyPnL("2026-08-01");
    expect(inserted[0]).toMatchObject({ grossMarginZar: 38895, expensesZar: 65000, netZar: -26105 });
  });
});
