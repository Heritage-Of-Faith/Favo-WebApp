// AT-206 — the weekly ops summary screen's read (PRD §7.3, REQ-123). The
// headline and the mode sections come from the same per-day figures, so the
// sections always add up to the week. db is mocked; each query is answered
// by what it reads.

import { describe, it, expect, vi } from "vitest";

const queries: { sql: string; params: unknown[] }[] = [];

vi.mock("@db/index", async () => {
  const { PgDialect } = await import("drizzle-orm/pg-core");
  const dialect = new PgDialect();
  return {
    db: {
      execute: vi.fn().mockImplementation(async (q: Parameters<typeof dialect.sqlToQuery>[0]) => {
        const { sql: text, params } = dialect.sqlToQuery(q);
        queries.push({ sql: text, params });
        if (text.includes("FROM opening_sessions"))
          return [
            { session_date: "2026-08-10", mode: "weekday" },
            { session_date: "2026-08-16", mode: "sunday" },
          ];
        if (text.includes("FROM order_items")) return [{ revenue_day: "2026-08-10", drinks: "3" }, { revenue_day: "2026-08-16", drinks: "2" }];
        if (text.includes("FROM staff_entitlement_log")) return [{ revenue_day: "2026-08-10", cups: "2" }];
        if (text.includes("FROM stock_movements")) return [{ revenue_day: "2026-08-10", kind: "milk", unit: "cup", quantity: "3" }];
        if (text.includes("FROM orders o"))
          return [
            { revenue_day: "2026-08-10", cogs_zar: 1352, absent_item_ids: [], estimated: true, missing: false },
            { revenue_day: "2026-08-16", cogs_zar: 529, absent_item_ids: [], estimated: false, missing: false },
            { revenue_day: "2026-08-16", cogs_zar: 1059, absent_item_ids: [], estimated: false, missing: false },
          ];
        if (text.includes("FROM inventory_items")) return [];
        if (text.includes("FROM expenses")) return [{ sast_date: "2026-08-12", expenses_zar: "1000" }];
        if (text.includes("SUM(total_zar)")) return [{ revenue_day: "2026-08-16", revenue_zar: "8000" }];
        throw new Error(`unexpected query: ${text}`);
      }),
    },
  };
});

describe("readWeeklySummary — week of Mon 10 Aug 2026", () => {
  it("headline is the week's one-figure-path figure; Sunday and weekday read separately and sum to it", async () => {
    const { readWeeklySummary } = await import("@/server/reports/weekly-summary");
    const s = await readWeeklySummary("2026-08-10");

    expect(s.weekEnding).toBe("2026-08-16");
    expect(s.headline).toMatchObject({ revenueZar: 8000, cogsZar: 2940, expensesZar: 1000, netZar: 4060, costState: "provisional", tone: "warn" });
    // Sunday: every lot invoice-backed → may read profit. R80,00 − R15,88.
    expect(s.sections.sunday).toMatchObject({ revenueZar: 8000, cogsZar: 1588, grossMarginZar: 6412, costState: "final", tone: "positive", drinks: 2 });
    // Weekday: cost and consumption — an estimated lot, so provisional.
    expect(s.sections.weekday).toMatchObject({ revenueZar: 0, cogsZar: 1352, costState: "provisional", drinks: 3, staffCoffees: 2 });
    expect(s.sections.weekday.consumption).toEqual([{ kind: "milk", unit: "cup", quantity: 3 }]);
    expect((s.sections.weekday.cogsZar ?? 0) + (s.sections.sunday.cogsZar ?? 0)).toBe(s.headline.cogsZar);
  });

  it("a barista session never receives the week-level revenue/COGS/expenses/net block; an Admin does", async () => {
    const { readWeeklySummary, summaryForRole } = await import("@/server/reports/weekly-summary");
    const s = await readWeeklySummary("2026-08-10");
    const barista = summaryForRole(s, "barista");
    expect(barista.headline).toBeNull();
    expect(JSON.stringify(barista)).not.toContain("expensesZar");
    expect(JSON.stringify(barista)).not.toContain("netZar");
    // The mode sections stay: §7.3's Sunday revenue/COGS/profit flag.
    expect(barista.sections.sunday).toMatchObject({ revenueZar: 8000, cogsZar: 1588 });
    expect(summaryForRole(s, "admin").headline).toMatchObject({ expensesZar: 1000, netZar: 4060 });
  });

  it("the walk-in count is not recorded anywhere yet, and says so — never 0", async () => {
    const { WALK_IN_NOT_RECORDED } = await import("@/lib/weekly-summary");
    expect(WALK_IN_NOT_RECORDED).toBe("not recorded yet");
  });

  it("the count queries read revenue_day in the counted states, for Mon..Sun", async () => {
    for (const marker of ["FROM order_items", "FROM staff_entitlement_log", "FROM stock_movements"]) {
      const q = queries.find((x) => x.sql.includes(marker))!;
      expect(q.sql).toContain("o.revenue_day");
      expect(q.sql).toContain("'in_progress', 'ready', 'collected'");
      expect(q.sql).not.toContain("placed_at");
      expect(q.params).toEqual(["2026-08-10", "2026-08-16"]);
    }
  });
});
