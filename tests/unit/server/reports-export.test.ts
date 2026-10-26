// Reports CSV export unit tests — G11
// Tests pure helpers (rowsToCsv, date encoding) without DB or network.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { rowsToCsv } from "@/server/reports/export-csv";
import type { ReportRow } from "@/server/reports/export-csv";

// ─── rowsToCsv ────────────────────────────────────────────────────────────────

describe("rowsToCsv — RFC 4180 output", () => {
  it("produces a header row", () => {
    const csv = rowsToCsv([]);
    const header = csv.split("\r\n")[0];
    expect(header).toContain("Date");
    expect(header).toContain("Revenue");
    expect(header).toContain("COGS");
    expect(header).toContain("Gross Margin");
  });

  it("encodes one data row correctly", () => {
    const rows: ReportRow[] = [
      { date: "2026-06-08", revenueZar: 150000, cogsZar: 45000, grossMarginZar: 105000, grossMarginPct: 70.0, costStatus: "final" },
    ];
    const csv = rowsToCsv(rows);
    const lines = csv.split("\r\n");
    expect(lines).toHaveLength(2);
    // CHANGED (AT-192, REQ-131): a trailing "Cost status" column.
    expect(lines[1]).toBe("2026-06-08,150000,45000,105000,70,final");
  });

  it("uses CRLF line endings (RFC 4180)", () => {
    const csv = rowsToCsv([
      { date: "2026-06-08", revenueZar: 0, cogsZar: 0, grossMarginZar: 0, grossMarginPct: 0, costStatus: "final" },
    ]);
    expect(csv).toContain("\r\n");
  });

  it("escapes values containing commas with double-quotes", () => {
    const rows: ReportRow[] = [
      { date: "2026,06,08", revenueZar: 0, cogsZar: 0, grossMarginZar: 0, grossMarginPct: 0, costStatus: "final" },
    ];
    const csv = rowsToCsv(rows);
    expect(csv).toContain('"2026,06,08"');
  });

  it("escapes internal double-quotes per RFC 4180", () => {
    const rows: ReportRow[] = [
      { date: '"quoted"', revenueZar: 0, cogsZar: 0, grossMarginZar: 0, grossMarginPct: 0, costStatus: "final" },
    ];
    const csv = rowsToCsv(rows);
    expect(csv).toContain('"""quoted"""');
  });

  it("returns header-only CSV for empty rows array", () => {
    const csv = rowsToCsv([]);
    const lines = csv.split("\r\n").filter(Boolean);
    expect(lines).toHaveLength(1);
  });

  it("handles multiple rows in order", () => {
    const rows: ReportRow[] = [
      { date: "2026-06-01", revenueZar: 10000, cogsZar: 3000, grossMarginZar: 7000, grossMarginPct: 70, costStatus: "final" },
      { date: "2026-06-02", revenueZar: 20000, cogsZar: 6000, grossMarginZar: 14000, grossMarginPct: 70, costStatus: "final" },
    ];
    const csv = rowsToCsv(rows);
    const lines = csv.split("\r\n").filter(Boolean);
    expect(lines).toHaveLength(3);
    expect(lines[1]).toContain("2026-06-01");
    expect(lines[2]).toContain("2026-06-02");
  });
});

// ─── buildReportRows — DB integration (mocked) ────────────────────────────────

import { PgDialect } from "drizzle-orm/pg-core";

vi.mock("@db/index", () => ({
  db: {
    execute: vi.fn(),
  },
}));

type ExecResult = Awaited<ReturnType<typeof import("@db/index").db.execute>>;
const emptyResult = [] as unknown as ExecResult;

describe("buildReportRows — date range enumeration", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns one row per calendar day (inclusive)", async () => {
    const { db } = await import("@db/index");
    vi.mocked(db.execute)
      .mockResolvedValueOnce(emptyResult) // revenue
      .mockResolvedValueOnce(emptyResult); // cogs

    const { buildReportRows } = await import("@/server/reports/export-csv");
    const rows = await buildReportRows("2026-06-01", "2026-06-03");
    expect(rows).toHaveLength(3);
    expect(rows[0].date).toBe("2026-06-01");
    expect(rows[2].date).toBe("2026-06-03");
  });

  it("single-day range returns one row", async () => {
    const { db } = await import("@db/index");
    vi.mocked(db.execute)
      .mockResolvedValueOnce(emptyResult)
      .mockResolvedValueOnce(emptyResult);

    const { buildReportRows } = await import("@/server/reports/export-csv");
    const rows = await buildReportRows("2026-06-08", "2026-06-08");
    expect(rows).toHaveLength(1);
    expect(rows[0].date).toBe("2026-06-08");
  });

  it("merges revenue and COGS by date correctly", async () => {
    const { db } = await import("@db/index");
    vi.mocked(db.execute)
      .mockResolvedValueOnce([{ sast_date: "2026-06-08", revenue: "80000" }] as unknown as ExecResult)
      // CHANGED (AT-189): COGS is now a sum of order_cogs rows, not a per-day ROUND(SUM).
      .mockResolvedValueOnce([
        { revenue_day: "2026-06-08", cogs_zar: 14000, absent_item_ids: [], estimated: true, missing: false },
        { revenue_day: "2026-06-08", cogs_zar: 10000, absent_item_ids: [], estimated: false, missing: false },
      ] as unknown as ExecResult);

    const { buildReportRows } = await import("@/server/reports/export-csv");
    const rows = await buildReportRows("2026-06-08", "2026-06-08");
    expect(rows[0].revenueZar).toBe(80000);
    expect(rows[0].cogsZar).toBe(24000);
    expect(rows[0].grossMarginZar).toBe(56000);
    expect(rows[0].grossMarginPct).toBe(70);
    expect(rows[0].costStatus).toBe("provisional (estimated costs)");
  });

  it("days without transactions show zero revenue and COGS", async () => {
    const { db } = await import("@db/index");
    vi.mocked(db.execute)
      .mockResolvedValueOnce(emptyResult) // no revenue
      .mockResolvedValueOnce(emptyResult); // no cogs

    const { buildReportRows } = await import("@/server/reports/export-csv");
    const rows = await buildReportRows("2026-06-08", "2026-06-08");
    expect(rows[0].revenueZar).toBe(0);
    expect(rows[0].cogsZar).toBe(0);
    expect(rows[0].grossMarginPct).toBe(0);
    expect(rows[0].costStatus).toBe("no orders");
  });

  // Regression guard: date bounds must be bound as ISO strings with an explicit
  // ::timestamptz cast — never raw JS Date params. Drizzle's `db.execute(sql`…`)`
  // with a bound Date fails on the Supabase transaction pooler (prepare:false),
  // which 500'd the Sales/COGS exports and the Monthly draft in production.
  it("N2: revenue and COGS are both bucketed by orders.revenue_day, never placed_at", async () => {
    const { db } = await import("@db/index");
    vi.mocked(db.execute).mockResolvedValueOnce(emptyResult).mockResolvedValueOnce(emptyResult);
    const { buildReportRows } = await import("@/server/reports/export-csv");
    await buildReportRows("2026-08-10", "2026-08-16");
    const dialect = new PgDialect();
    for (const call of vi.mocked(db.execute).mock.calls) {
      const { sql: text, params } = dialect.sqlToQuery(call[0] as Parameters<typeof dialect.sqlToQuery>[0]);
      expect(text).toContain("revenue_day");
      expect(text).not.toContain("placed_at");
      expect(params).toEqual(["2026-08-10", "2026-08-16"]);
    }
  });

  it("an UNAVAILABLE day's figure cells carry the named refusal, never a bare UNAVAILABLE", async () => {
    const { db } = await import("@db/index");
    vi.mocked(db.execute)
      .mockResolvedValueOnce([{ sast_date: "2026-08-16", revenue: "35000" }] as unknown as ExecResult)
      .mockResolvedValueOnce([
        { revenue_day: "2026-08-16", cogs_zar: null, absent_item_ids: [], estimated: null, missing: true },
      ] as unknown as ExecResult);
    const { buildReportRows } = await import("@/server/reports/export-csv");
    const rows = await buildReportRows("2026-08-16", "2026-08-16");
    const line = rowsToCsv(rows).split("\r\n")[1];
    const named = "UNAVAILABLE — 1 order with no recorded cost";
    expect(line).toBe(`2026-08-16,35000,${named},${named},${named},${named}`);
  });

  it("binds date bounds as ::timestamptz string params, not raw Date objects", async () => {
    const { db } = await import("@db/index");
    vi.mocked(db.execute)
      .mockResolvedValueOnce(emptyResult) // revenue
      .mockResolvedValueOnce(emptyResult); // cogs

    const { buildReportRows } = await import("@/server/reports/export-csv");
    await buildReportRows("2026-06-08", "2026-06-08");

    const dialect = new PgDialect();
    for (const call of vi.mocked(db.execute).mock.calls) {
      const { sql: text, params } = dialect.sqlToQuery(call[0] as Parameters<typeof dialect.sqlToQuery>[0]);
      // CHANGED (AT-189): the order_cogs read binds revenue days as ::date.
      expect(text).toMatch(/::timestamptz|::date/);
      // No bound parameter may be a JS Date — they must be ISO strings.
      for (const p of params) {
        expect(p).not.toBeInstanceOf(Date);
        expect(typeof p).toBe("string");
      }
    }
  });
});
