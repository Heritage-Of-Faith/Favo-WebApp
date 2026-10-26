// Monthly P&L CSV renderer — task G21 (AT-62)
// Exports monthly_reports rows for a given date range (YYYY-MM months).

import { and, gte, lte } from "drizzle-orm";
import { db } from "@/lib/db";
import { monthlyReports } from "@db/schema";
import { formatZar } from "@/lib/format";
import { costStatusLabel, UNAVAILABLE } from "@/lib/cost-state";

function csvCell(value: string | number | null | undefined): string {
  const s = value == null ? "" : String(value);
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function monthFromDate(yyyymmdd: string): string {
  return yyyymmdd.slice(0, 7); // "YYYY-MM"
}

export async function buildMonthlyPnlCsv(from: string, to: string): Promise<string> {
  const fromMonth = monthFromDate(from);
  const toMonth = monthFromDate(to);

  const rows = await db
    .select()
    .from(monthlyReports)
    .where(and(gte(monthlyReports.month, fromMonth), lte(monthlyReports.month, toMonth)));

  const headers = [
    "Month",
    "Revenue (ZAR)",
    "COGS (ZAR)",
    "Gross Margin (ZAR)",
    "Net (ZAR)",
    "Cost status",
    "Status",
    "Admin Signed",
  ];
  const lines = [headers.map(csvCell).join(",")];

  for (const r of rows) {
    const adminSig = r.adminSig as { signerName?: string; at?: string } | null;
    lines.push(
      [
        r.month,
        formatZar(r.revenueZar),
        // NULL = UNAVAILABLE (REQ-109), never 0; the status column marks
        // provisional (estimated) figures in the export too (REQ-131).
        r.cogsZar === null ? UNAVAILABLE : formatZar(r.cogsZar),
        r.grossMarginZar === null ? UNAVAILABLE : formatZar(r.grossMarginZar),
        r.netZar === null ? UNAVAILABLE : formatZar(r.netZar),
        costStatusLabel({ state: r.costState, absentItemIds: r.cogsAbsentItems, ordersWithoutCost: 0 }),
        r.status,
        adminSig ? `${adminSig.signerName ?? "yes"} (${adminSig.at ?? ""})` : "",
      ]
        .map(csvCell)
        .join(",")
    );
  }

  return "﻿" + lines.join("\r\n");
}
