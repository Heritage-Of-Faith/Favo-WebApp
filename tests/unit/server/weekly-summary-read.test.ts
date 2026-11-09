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
        // §7.3.1 / REQ-145: live voucher rows per barista (Louis averages R38 a slip, Thandeka R21).
        if (text.includes("FROM voucher_redemptions"))
          return [
            { staff_id: "staff_louis", staff_name: "Louis", cups: "4", zar: "15200" },
            { staff_id: "staff_thandeka", staff_name: "Thandeka", cups: "4", zar: "8400" },
          ];
        // readWriteDowns: one R20 comp by Louis.
        if (text.includes("UNION ALL"))
          return [{ kind: "comp", audit_id: "a1", revenue_day: "2026-08-16", at: "2026-08-16T07:00:00Z", staff_id: "staff_louis", staff_name: "Louis", on_behalf_of_name: null, order_id: "o1", value_zar: "2000", reason: "spillage" }];
        if (text.includes("written_off_at IS NOT NULL")) return [];
        if (text.includes("FROM staff WHERE active"))
          return [
            { id: "staff_louis", name: "Louis" },
            { id: "staff_thandeka", name: "Thandeka" },
            { id: "staff_nkuli", name: "Nkuli" },
          ];
        // readMarginByShot: the Sunday's single (R20 − R5,29) and double (R20 − R10,59).
        if (text.includes("coffee_shots"))
          return [
            { total_zar: 2000, cogs_zar: 529, absent_item_ids: [], estimated: false, missing: false, coffee_shots: [1], day_mode: "sunday" },
            { total_zar: 2000, cogs_zar: 1059, absent_item_ids: [], estimated: false, missing: false, coffee_shots: [2], day_mode: "sunday" },
          ];
        if (text.includes("FROM walk_ins")) return [{ revenue_day: "2026-08-10", cups: "3" }];
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

  it("REQ-123: the walk-in count is read from walk_ins (Σ quantity), beside the staff coffees — two counts", async () => {
    const { readWeeklySummary } = await import("@/server/reports/weekly-summary");
    const s = await readWeeklySummary("2026-08-10");
    expect(s.sections.weekday).toMatchObject({ staffCoffees: 2, walkInCups: 3 });
    expect(s.sections.sunday.walkInCups).toBe(0);
    const q = queries.find((x) => x.sql.includes("FROM walk_ins"))!;
    expect(q.sql).toContain("SUM(w.quantity)");
  });

  it("REQ-139: margin by shot count, per mode, for the same Mon..Sun", async () => {
    const { readWeeklySummary } = await import("@/server/reports/weekly-summary");
    const s = await readWeeklySummary("2026-08-10");
    expect(s.marginByShot.map((r) => [r.mode, r.bucket, r.revenueZar, r.cogsZar, r.grossMarginZar, r.tone])).toEqual([
      ["sunday", 1, 2000, 529, 1471, "positive"],
      ["sunday", 2, 2000, 1059, 941, "positive"],
    ]);
    const q = queries.find((x) => x.sql.includes("coffee_shots"))!;
    expect(q.params).toEqual(["2026-08-10", "2026-08-16"]);
  });

  it("REQ-124 / REQ-145: the write-down block names every barista, vouchers as a count AND a value, zero as 0", async () => {
    const { readWeeklySummary } = await import("@/server/reports/weekly-summary");
    const s = await readWeeklySummary("2026-08-10");
    const by = Object.fromEntries(s.writeDowns.map((b) => [b.name, b]));
    expect(Object.keys(by)).toEqual(["Louis", "Thandeka", "Nkuli"]);
    expect(by.Louis.comps).toEqual({ count: 1, zar: 2000 });
    expect(by.Louis.vouchers).toEqual({ count: 4, zar: 15200 });
    expect(by.Thandeka.vouchers).toEqual({ count: 4, zar: 8400 });
    expect(by.Nkuli).toMatchObject({ comps: { count: 0, zar: 0 }, abandoned: { count: 0 }, vouchers: { count: 0, zar: 0 } });
    expect(by.Nkuli.writeOffs).toMatchObject({ count: 0, zar: 0 });
    const q = queries.find((x) => x.sql.includes("FROM voucher_redemptions"))!;
    expect(q.params).toEqual(["2026-08-10", "2026-08-16"]);
  });

  it("a barista session never receives the per-barista write-down block; an Admin does", async () => {
    const { readWeeklySummary, summaryForRole } = await import("@/server/reports/weekly-summary");
    const s = await readWeeklySummary("2026-08-10");
    expect(summaryForRole(s, "barista").writeDowns).toBeNull();
    expect(JSON.stringify(summaryForRole(s, "barista"))).not.toContain("staff_louis");
    expect(summaryForRole(s, "admin").writeDowns).toHaveLength(3);
  });

  it("the count queries read revenue_day in the counted states, for Mon..Sun", async () => {
    for (const marker of ["FROM order_items oi JOIN", "FROM staff_entitlement_log", "FROM walk_ins", "FROM stock_movements"]) {
      const q = queries.find((x) => x.sql.includes(marker))!;
      expect(q.sql).toContain("o.revenue_day");
      expect(q.sql).toContain("'in_progress', 'ready', 'collected'");
      expect(q.sql).not.toContain("placed_at");
      expect(q.params).toEqual(["2026-08-10", "2026-08-16"]);
    }
  });
});
