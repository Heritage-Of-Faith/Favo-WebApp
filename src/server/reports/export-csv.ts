// Reports CSV export — task G11
// Produces an RFC 4180 CSV with daily Sales + COGS for a date range.
// Docs: docs/API.md → GET /api/reports/export

import { sql } from "drizzle-orm";
import { db } from "@/lib/db";

const SAST_OFFSET_MS = 2 * 60 * 60 * 1000;

export type ReportRow = {
  date: string;
  revenueZar: number;
  cogsZar: number;
  grossMarginZar: number;
  grossMarginPct: number;
};

/** Parse a YYYY-MM-DD string into 00:00:00 SAST expressed as a UTC Date. */
function sastDayStart(yyyymmdd: string): Date {
  const utcMidnight = new Date(`${yyyymmdd}T00:00:00Z`);
  return new Date(utcMidnight.getTime() - SAST_OFFSET_MS);
}

/**
 * Build daily revenue + COGS rows for the given SAST date range (inclusive).
 * `from` and `to` are YYYY-MM-DD SAST dates.
 */
export async function buildReportRows(from: string, to: string): Promise<ReportRow[]> {
  const startUtc = sastDayStart(from);
  // End = start of the next day after `to`
  const toStart = sastDayStart(to);
  const endUtc = new Date(toStart.getTime() + 24 * 60 * 60 * 1000);

  // Revenue aggregated by SAST day
  const revRows = await db.execute<{ sast_date: string; revenue: string }>(sql`
    SELECT
      TO_CHAR(placed_at AT TIME ZONE 'Africa/Johannesburg', 'YYYY-MM-DD') AS sast_date,
      COALESCE(SUM(total_zar), 0)::bigint AS revenue
    FROM orders
    WHERE state IN ('in_progress', 'ready', 'collected')
      AND placed_at >= ${startUtc}
      AND placed_at < ${endUtc}
    GROUP BY sast_date
    ORDER BY sast_date
  `);

  // COGS aggregated by SAST day (stock deductions × unit cost)
  const cogsRows = await db.execute<{ sast_date: string; cogs: string }>(sql`
    SELECT
      TO_CHAR(sm.at AT TIME ZONE 'Africa/Johannesburg', 'YYYY-MM-DD') AS sast_date,
      ROUND(COALESCE(SUM(-sm.delta::numeric * il.unit_cost_zar), 0))::bigint AS cogs
    FROM stock_movements sm
    JOIN inventory_lots il ON sm.inventory_lot_id = il.id
    WHERE sm.kind = 'deduction'
      AND il.unit_cost_zar IS NOT NULL
      AND sm.at >= ${startUtc}
      AND sm.at < ${endUtc}
    GROUP BY sast_date
    ORDER BY sast_date
  `);

  // Build a date-keyed map to merge the two result sets
  const revMap = new Map(revRows.map((r) => [r.sast_date, parseInt(r.revenue, 10) || 0]));
  const cogsMap = new Map(cogsRows.map((r) => [r.sast_date, parseInt(r.cogs, 10) || 0]));

  // Enumerate every calendar day in range
  const rows: ReportRow[] = [];
  const cursor = new Date(startUtc);
  while (cursor.getTime() < endUtc.getTime()) {
    const sastCursor = new Date(cursor.getTime() + SAST_OFFSET_MS);
    const date = sastCursor.toISOString().slice(0, 10);
    const revenueZar = revMap.get(date) ?? 0;
    const cogsZar = cogsMap.get(date) ?? 0;
    const grossMarginZar = revenueZar - cogsZar;
    const grossMarginPct =
      revenueZar > 0 ? Math.round((grossMarginZar / revenueZar) * 10000) / 100 : 0;
    rows.push({ date, revenueZar, cogsZar, grossMarginZar, grossMarginPct });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return rows;
}

/** Encode a value for RFC 4180 CSV (wrap in quotes, escape internal quotes). */
function csvCell(value: string | number): string {
  const s = String(value);
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function rowsToCsv(rows: ReportRow[]): string {
  const headers = ["Date", "Revenue (cents)", "COGS (cents)", "Gross Margin (cents)", "Gross Margin %"];
  const lines = [headers.map(csvCell).join(",")];
  for (const r of rows) {
    lines.push(
      [r.date, r.revenueZar, r.cogsZar, r.grossMarginZar, r.grossMarginPct]
        .map(csvCell)
        .join(",")
    );
  }
  return lines.join("\r\n");
}
