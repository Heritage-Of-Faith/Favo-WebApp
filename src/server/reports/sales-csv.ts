// Sales CSV renderer — task G21 (AT-62)
// Produces per-order sales rows with customer name, total, and state.
// ZAR amounts formatted as display strings (e.g. "R 45,00") for Excel.

import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { formatZar } from "@/lib/format";

const SAST_OFFSET_MS = 2 * 60 * 60 * 1000;

function sastDayStart(yyyymmdd: string): Date {
  const utcMidnight = new Date(`${yyyymmdd}T00:00:00Z`);
  return new Date(utcMidnight.getTime() - SAST_OFFSET_MS);
}

function csvCell(value: string | number | null | undefined): string {
  const s = value == null ? "" : String(value);
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export async function buildSalesCsv(from: string, to: string): Promise<string> {
  const startUtc = sastDayStart(from);
  const endUtc = new Date(sastDayStart(to).getTime() + 24 * 60 * 60 * 1000);

  const rows = await db.execute<{
    order_id: string;
    placed_at_sast: string;
    customer_name: string | null;
    total_zar: number;
    state: string;
  }>(sql`
    SELECT
      o.id AS order_id,
      TO_CHAR(o.placed_at AT TIME ZONE 'Africa/Johannesburg', 'YYYY-MM-DD HH24:MI') AS placed_at_sast,
      c.name AS customer_name,
      o.total_zar,
      o.state
    FROM orders o
    LEFT JOIN customers c ON o.customer_id = c.id
    WHERE o.placed_at >= ${startUtc.toISOString()}::timestamptz
      AND o.placed_at < ${endUtc.toISOString()}::timestamptz
    ORDER BY o.placed_at
  `);

  const headers = ["Order ID", "Placed At (SAST)", "Customer", "Total (ZAR)", "State"];
  const lines = [headers.map(csvCell).join(",")];

  for (const r of rows) {
    lines.push(
      [
        r.order_id,
        r.placed_at_sast,
        r.customer_name ?? "Walk-in",
        formatZar(r.total_zar),
        r.state,
      ]
        .map(csvCell)
        .join(",")
    );
  }

  return "﻿" + lines.join("\r\n");
}
