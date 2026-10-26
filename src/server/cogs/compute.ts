// COGS computation — task G13, rewritten for AT-189 / AT-190 / AT-191 / AT-192.
// getCogsLive: revenue from v_daily_revenue; COGS as Σ order_cogs for the SAST
// revenue day (PRD v7 §7.0.2 L1790 — v_daily_cogs is dropped by 0038); and
// the day's cost state: empty | unavailable | provisional | final (§7.0.1b,
// REQ-110, REQ-129). Spec: docs/FAVO_PRD_v7.md · BUSINESS_RULES.md L07.

import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import type { CogsLive } from "@/lib/types";
import { readPeriodCogs } from "@/server/cogs/period-cogs";

// Africa/Johannesburg = UTC+2 (no DST)
const SAST_OFFSET_HOURS = 2;

/**
 * Returns today's SAST date string as YYYY-MM-DD.
 * Uses the UTC offset directly — SA has no DST so this is always correct.
 */
export function todaySast(): string {
  const now = new Date();
  const sast = new Date(now.getTime() + SAST_OFFSET_HOURS * 60 * 60 * 1000);
  return sast.toISOString().slice(0, 10);
}

/**
 * Computes the COGS summary for a given SAST date.
 *
 * A day with no orders is a genuine zero (state "empty"). A day with an absent
 * cost input has cogs, gross margin and net NULL — UNAVAILABLE, the offending
 * items named — never a smaller number (REQ-109).
 */
export async function getCogsLive(date: string): Promise<CogsLive> {
  // ── Revenue ────────────────────────────────────────────────────────────────
  const [revRow] = await db.execute<{ revenue_zar: string | null }>(
    sql`SELECT revenue_zar FROM v_daily_revenue WHERE sast_date = ${date}::date`
  );
  const revenueZar = parseInt(revRow?.revenue_zar ?? "0", 10) || 0;

  // ── COGS — Σ order_cogs (REQ-106): integers rounded once per order at the
  // sale, never re-rounded here, never filtered.
  const cogs = await readPeriodCogs(date, date);
  const cogsZar = cogs.cogsZar;

  // ── Expenses ─────────────────────────────────────────────────────────────
  // Non-stock operating expenses for the day (rent, utilities, wages, …).
  // PRD §04 SC01 requires the live dashboard to show expenses and a net that
  // accounts for them — previously hard-coded to 0.
  const [expRow] = await db.execute<{ expenses_zar: string | null }>(
    sql`SELECT expenses_zar FROM v_daily_expenses WHERE sast_date = ${date}::date`
  );
  const expensesZar = parseInt(expRow?.expenses_zar ?? "0", 10) || 0;

  const grossMarginZar = cogsZar === null ? null : revenueZar - cogsZar;
  const netZar = grossMarginZar === null ? null : grossMarginZar - expensesZar;

  return {
    date,
    revenueZar,
    cogsZar,
    expensesZar,
    grossMarginZar,
    netZar,
    costState: cogs.state,
    absentItems: cogs.absentItemNames,
    ordersWithoutCost: cogs.ordersWithoutCost,
  };
}
