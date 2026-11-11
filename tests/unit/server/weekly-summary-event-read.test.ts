// DEC-28 (d) (owner, Mia, 11 Nov 2026): orders.event_window_id puts an event's
// orders in the Event section of the weekly summary (PRD §7.3 "split by
// mode", §6.11.3 "Reported as … An event column (§6.6)"), instead of folding a
// Wednesday with an event into "unassigned". db is mocked; each query is
// answered by what it reads, with the `event` flag the reads now select.
//
// Week Mon 5 .. Sun 11 Oct 2026. Wednesday 7 Oct: a weekday session (3 free
// cups, COGS R13,52) and Discipleship 101 (2 free cups, COGS R10,59).
// Thursday 8 Oct: a paid social, 2 × R38.00 = R76,00, COGS R21,18.

import { describe, it, expect, vi } from "vitest";

const queries: string[] = [];

vi.mock("@db/index", async () => {
  const { PgDialect } = await import("drizzle-orm/pg-core");
  const dialect = new PgDialect();
  return {
    db: {
      execute: vi.fn().mockImplementation(async (q: Parameters<typeof dialect.sqlToQuery>[0]) => {
        const { sql: text } = dialect.sqlToQuery(q);
        queries.push(text);
        if (text.includes("FROM voucher_redemptions")) return [];
        if (text.includes("UNION ALL")) return [];
        if (text.includes("written_off_at IS NOT NULL")) return [];
        if (text.includes("FROM staff WHERE active")) return [];
        if (text.includes("coffee_shots")) return [];
        if (text.includes("FROM walk_ins")) return [];
        if (text.includes("FROM opening_sessions"))
          return [
            { session_date: "2026-10-07", mode: "weekday" },
            { session_date: "2026-10-07", mode: "event" },
            { session_date: "2026-10-08", mode: "event" },
          ];
        if (text.includes("FROM order_items"))
          return [
            { revenue_day: "2026-10-07", drinks: "3", event: false },
            { revenue_day: "2026-10-07", drinks: "2", event: true },
            { revenue_day: "2026-10-08", drinks: "2", event: true },
          ];
        if (text.includes("FROM staff_entitlement_log")) return [{ revenue_day: "2026-10-07", cups: "3", event: false }];
        if (text.includes("FROM stock_movements")) return [];
        if (text.includes("FROM orders o"))
          return [
            { revenue_day: "2026-10-07", event_window_id: null, cogs_zar: 451, absent_item_ids: [], estimated: false, missing: false },
            { revenue_day: "2026-10-07", event_window_id: null, cogs_zar: 451, absent_item_ids: [], estimated: false, missing: false },
            { revenue_day: "2026-10-07", event_window_id: null, cogs_zar: 450, absent_item_ids: [], estimated: false, missing: false },
            { revenue_day: "2026-10-07", event_window_id: "evw_d101", cogs_zar: 529, absent_item_ids: [], estimated: false, missing: false },
            { revenue_day: "2026-10-07", event_window_id: "evw_d101", cogs_zar: 530, absent_item_ids: [], estimated: false, missing: false },
            { revenue_day: "2026-10-08", event_window_id: "evw_thu", cogs_zar: 1059, absent_item_ids: [], estimated: false, missing: false },
            { revenue_day: "2026-10-08", event_window_id: "evw_thu", cogs_zar: 1059, absent_item_ids: [], estimated: false, missing: false },
          ];
        if (text.includes("FROM inventory_items")) return [];
        if (text.includes("FROM expenses")) return [];
        if (text.includes("SUM(total_zar)")) {
          // readPeriodFigures' plain read has no event column; the split read does.
          if (text.includes("event_window_id IS NOT NULL")) return [{ revenue_day: "2026-10-08", event: true, revenue_zar: "7600" }];
          return [{ revenue_day: "2026-10-08", revenue_zar: "7600" }];
        }
        throw new Error(`unexpected query: ${text}`);
      }),
    },
  };
});

describe("readWeeklySummary — event-stamped orders read as Event (DEC-28 d)", () => {
  it("Wednesday's weekday cups stay Weekday; Discipleship 101 and the Thursday social are Event; nothing unassigned", async () => {
    const { readWeeklySummary } = await import("@/server/reports/weekly-summary");
    const s = await readWeeklySummary("2026-10-05");

    expect(s.sections.weekday).toMatchObject({ revenueZar: 0, cogsZar: 1352, orderCount: 3, drinks: 3, staffCoffees: 3 });
    expect(s.sections.event).toMatchObject({
      days: ["2026-10-07", "2026-10-08"], revenueZar: 7600, cogsZar: 1059 + 2118, orderCount: 4, drinks: 4, staffCoffees: 0,
    });
    expect(s.sections.unassigned.orderCount).toBe(0);
    // The sections still add up to the week's one-figure-path headline.
    const all = [s.sections.weekday, s.sections.sunday, s.sections.event, s.sections.unassigned];
    expect(all.reduce((t, x) => t + x.revenueZar, 0)).toBe(s.headline.revenueZar);
    expect(all.reduce((t, x) => t + (x.cogsZar ?? 0), 0)).toBe(s.headline.cogsZar);
    // Every per-day count read is split by the stamp.
    for (const from of ["FROM order_items", "FROM staff_entitlement_log", "FROM walk_ins", "FROM stock_movements"]) {
      expect(queries.find((q) => q.includes(from))).toContain("(o.event_window_id IS NOT NULL)");
    }
  });
});
