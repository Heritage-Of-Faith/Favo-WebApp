// Reports CSV export — task G11
// Produces an RFC 4180 CSV with daily Sales + COGS for a date range.
// Docs: docs/API.md → GET /api/reports/export

import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { costStatusLabel, UNAVAILABLE } from "@/lib/cost-state";
import { EMPTY_PERIOD_COGS, readDailyCogs, type PeriodCogs } from "@/server/cogs/period-cogs";

const SAST_OFFSET_MS = 2 * 60 * 60 * 1000;

export type ReportRow = {
  date: string;
  revenueZar: number;
  /** NULL = UNAVAILABLE (REQ-109) — rendered as the word, never as 0. */
  cogsZar: number | null;
  grossMarginZar: number | null;
  grossMarginPct: number | null;
  /** "provisional (estimated costs)" | "UNAVAILABLE — <items>" | "final" | "no orders" (REQ-129, REQ-131). */
  costStatus: string;
};

function costStatusText(cogs: PeriodCogs): string {
  return costStatusLabel({ state: cogs.state, absentItemIds: cogs.absentItemNames, ordersWithoutCost: cogs.ordersWithoutCost });
}

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
      AND placed_at >= ${startUtc.toISOString()}::timestamptz
      AND placed_at < ${endUtc.toISOString()}::timestamptz
    GROUP BY sast_date
    ORDER BY sast_date
  `);

  // COGS per revenue day = Σ order_cogs (AT-189, REQ-106) — never re-rounded,
  // never filtered; an absent input makes that day UNAVAILABLE (AT-190).
  const cogsMap = await readDailyCogs(from, to);

  const revMap = new Map(revRows.map((r) => [r.sast_date, parseInt(r.revenue, 10) || 0]));

  // Enumerate every calendar day in range
  const rows: ReportRow[] = [];
  const cursor = new Date(startUtc);
  while (cursor.getTime() < endUtc.getTime()) {
    const sastCursor = new Date(cursor.getTime() + SAST_OFFSET_MS);
    const date = sastCursor.toISOString().slice(0, 10);
    const revenueZar = revMap.get(date) ?? 0;
    const cogs = cogsMap.get(date) ?? EMPTY_PERIOD_COGS;
    const cogsZar = cogs.cogsZar;
    const grossMarginZar = cogsZar === null ? null : revenueZar - cogsZar;
    // A display percentage of two integer-cent figures, not a money amount.
    const grossMarginPct =
      grossMarginZar === null ? null : revenueZar > 0 ? Math.round((grossMarginZar / revenueZar) * 10000) / 100 : 0;
    rows.push({ date, revenueZar, cogsZar, grossMarginZar, grossMarginPct, costStatus: costStatusText(cogs) });
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

/** A figure, or the literal UNAVAILABLE — never a blank and never 0 (REQ-109). */
function figure(v: number | null): string | number {
  return v === null ? UNAVAILABLE : v;
}

export function rowsToCsv(rows: ReportRow[]): string {
  const headers = ["Date", "Revenue (cents)", "COGS (cents)", "Gross Margin (cents)", "Gross Margin %", "Cost status"];
  const lines = [headers.map(csvCell).join(",")];
  for (const r of rows) {
    lines.push(
      [r.date, r.revenueZar, figure(r.cogsZar), figure(r.grossMarginZar), figure(r.grossMarginPct), r.costStatus]
        .map(csvCell)
        .join(",")
    );
  }
  return lines.join("\r\n");
}
