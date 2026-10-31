// AT-189 · AT-190 · AT-192 — REQ-106, REQ-109, REQ-129, REQ-131.
// The weekly summary stores Σ order_cogs over its seven revenue days, and its
// cost state: UNAVAILABLE (cogs NULL, items named) or provisional — never a
// silently smaller number, never green on estimates. db is mocked; each
// query is answered by what it reads.
// CHANGED (QA P1): revenue and expenses now come through readPeriodFigures
// (db.execute), not drizzle selects — the mock routes by SQL text.

import { describe, it, expect, vi, beforeEach } from "vitest";

const inserted: Record<string, unknown>[] = [];
const queries: { sql: string; params: unknown[] }[] = [];
const data: { cogs: unknown[]; names: unknown[]; revenue: unknown[]; expenses: unknown[] } = {
  cogs: [],
  names: [],
  revenue: [],
  expenses: [],
};

vi.mock("@db/index", async () => {
  const { PgDialect } = await import("drizzle-orm/pg-core");
  const dialect = new PgDialect();
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
      insert: vi.fn().mockImplementation(() => ({
        values: (v: Record<string, unknown>) => {
          inserted.push(v);
          // CHANGED (AT-206): the insert now goes through onConflictDoNothing.
          const returning = () => Promise.resolve([{ id: "wr_1" }]);
          return { returning, onConflictDoNothing: () => ({ returning }) };
        },
      })),
    },
  };
});

const row = (over: Record<string, unknown>) => ({
  revenue_day: "2026-08-16",
  cogs_zar: 1352,
  absent_item_ids: [],
  estimated: true,
  missing: false,
  ...over,
});

describe("generateWeeklyPnL — cost state (AT-192)", () => {
  beforeEach(() => {
    inserted.length = 0;
    queries.length = 0;
    data.cogs = [];
    data.names = [];
    data.revenue = [{ revenue_day: "2026-08-16", revenue_zar: "35000" }];
    data.expenses = [];
  });

  // Sunday 2026-08-16 belongs to the week starting Monday 2026-08-10.
  const SUNDAY = new Date("2026-08-16T10:00:00+02:00");

  it("an absent input stores the week UNAVAILABLE: cogs, margin and net NULL, the item named", async () => {
    data.cogs = [
      row({}),
      row({ cogs_zar: null, absent_item_ids: ["inv_item_oat_milk"] }),
      row({ cogs_zar: null, estimated: null, missing: true }),
    ];
    data.names = [{ id: "inv_item_oat_milk", name: "Oat Milk" }];
    const { generateWeeklyPnL } = await import("@/server/crons/generate-weekly-pnl");
    await generateWeeklyPnL(SUNDAY);
    expect(inserted[0]).toMatchObject({
      weekStarting: "2026-08-10",
      revenueZar: 35000,
      cogsZar: null,
      grossMarginZar: null,
      netZar: null,
      costState: "unavailable",
      cogsAbsentItems: ["Oat Milk"],
      ordersWithoutCost: 1, // S3: stored with the period
    });
  });

  it("N2: revenue, COGS and expenses are all read for revenue days Mon..Sun (revenue_day, not placed_at)", async () => {
    const { generateWeeklyPnL } = await import("@/server/crons/generate-weekly-pnl");
    await generateWeeklyPnL(SUNDAY);
    const rev = queries.find((q) => q.sql.includes("SUM(total_zar)"))!;
    expect(rev.sql).toContain("revenue_day");
    expect(rev.sql).not.toContain("placed_at");
    for (const q of queries) expect(q.params).toEqual(["2026-08-10", "2026-08-16"]);
  });

  it("estimated lots store the week provisional; net subtracts the week's expenses", async () => {
    data.cogs = [row({ cogs_zar: 529 }), row({ cogs_zar: 1059, estimated: false })];
    data.expenses = [{ sast_date: "2026-08-12", expenses_zar: "1000" }];
    const { generateWeeklyPnL } = await import("@/server/crons/generate-weekly-pnl");
    await generateWeeklyPnL(SUNDAY);
    expect(inserted[0]).toMatchObject({
      cogsZar: 1588,
      grossMarginZar: 33412,
      expensesZar: 1000,
      netZar: 32412,
      costState: "provisional",
    });
  });
});
