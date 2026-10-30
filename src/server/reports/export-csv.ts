// Reports CSV export — task G11, rewritten for AT-189..192.
// Produces an RFC 4180 CSV with daily revenue, COGS, gross margin, expenses
// and net for a date range — every figure from readDailyFigures, i.e. the
// same reads and the same periodFigures arithmetic as the dashboard and the
// weekly/monthly reports. All money columns are integer cents.
// Docs: docs/API.md → GET /api/reports/export

import { costStatusLabel, UNAVAILABLE } from "@/lib/cost-state";
import { readDailyFigures, type DayFigures } from "@/server/cogs/period-cogs";

export type ReportRow = {
  date: string;
  revenueZar: number;
  /** NULL = UNAVAILABLE (REQ-109) — rendered as the named refusal, never as 0. */
  cogsZar: number | null;
  grossMarginZar: number | null;
  /** NULL when cogs is UNAVAILABLE, or when there was no revenue (n/a). */
  grossMarginPct: number | null;
  expensesZar: number;
  /** revenue − COGS − expenses. NULL = UNAVAILABLE. */
  netZar: number | null;
  /** "provisional (estimated costs)" | "UNAVAILABLE — <items>" | "final" | "no orders" (REQ-129, REQ-131). */
  costStatus: string;
};

export function toReportRow(d: DayFigures): ReportRow {
  return {
    date: d.date,
    revenueZar: d.revenueZar,
    cogsZar: d.cogsZar,
    grossMarginZar: d.grossMarginZar,
    grossMarginPct: d.grossMarginPct,
    expensesZar: d.expensesZar,
    netZar: d.netZar,
    costStatus: costStatusLabel({
      state: d.cogs.state,
      absentItemIds: d.cogs.absentItemNames,
      ordersWithoutCost: d.cogs.ordersWithoutCost,
    }),
  };
}

/**
 * Build daily rows for the given SAST date range (inclusive).
 * `from` and `to` are YYYY-MM-DD SAST revenue days.
 */
export async function buildReportRows(from: string, to: string): Promise<ReportRow[]> {
  return (await readDailyFigures(from, to)).map(toReportRow);
}

/** Encode a value for RFC 4180 CSV (wrap in quotes, escape internal quotes). */
function csvCell(value: string | number): string {
  const s = String(value);
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/**
 * A figure, or the row's named refusal ("UNAVAILABLE — Oat Milk") — never a
 * blank, never 0, never a bare UNAVAILABLE (REQ-109).
 */
export function reportFigure(v: number | null, r: Pick<ReportRow, "costStatus">): string | number {
  if (v !== null) return v;
  return r.costStatus.startsWith(UNAVAILABLE) ? r.costStatus : UNAVAILABLE;
}

/** A margin %, the named refusal when costs are absent, or "n/a" on a day with no revenue. */
export function reportPct(r: Pick<ReportRow, "grossMarginPct" | "cogsZar" | "costStatus">): string | number {
  if (r.grossMarginPct !== null) return r.grossMarginPct;
  return r.cogsZar === null ? reportFigure(null, r) : "n/a";
}

export function rowsToCsv(rows: ReportRow[]): string {
  const headers = [
    "Date",
    "Revenue (cents)",
    "COGS (cents)",
    "Gross Margin (cents)",
    "Gross Margin %",
    "Expenses (cents)",
    "Net (cents)",
    "Cost status",
  ];
  const lines = [headers.map(csvCell).join(",")];
  for (const r of rows) {
    lines.push(
      [
        r.date,
        r.revenueZar,
        reportFigure(r.cogsZar, r),
        reportFigure(r.grossMarginZar, r),
        reportPct(r),
        r.expensesZar,
        reportFigure(r.netZar, r),
        r.costStatus,
      ]
        .map(csvCell)
        .join(",")
    );
  }
  return lines.join("\r\n");
}
