// COGS computation — task G13
// getCogsLive: queries v_daily_revenue, v_daily_cogs, v_daily_expenses for
// a given SAST date and returns the full daily P&L breakdown.
//
// The cost_estimated_warning flag is true when any inventory_lot contributing
// to today's COGS was seeded with reason containing 'cost_estimated' in the
// audit_log (R10 mitigation). Admin dismisses this by recosting via A8.
//
// Docs: FAVO_PRD_v3.md §04 §07 §10 R10 · BUSINESS_RULES.md L07

import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import type { CogsLive } from "@/lib/types";

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
 * Queries the v_daily_revenue, v_daily_cogs, and v_daily_expenses views
 * created in migration 0004.  Returns zeros for any missing view row
 * (e.g. no orders / no deductions / no expenses on that day).
 *
 * cost_estimated_warning: checks the audit_log for any deduction on this
 * date where the linked lot's creation audit row has reason LIKE
 * '%cost_estimated%'.
 */
export async function getCogsLive(date: string): Promise<CogsLive> {
  // ── Revenue ────────────────────────────────────────────────────────────────
  const [revRow] = await db.execute<{ revenue_zar: string | null }>(
    sql`SELECT revenue_zar FROM v_daily_revenue WHERE sast_date = ${date}::date`
  );
  const revenueZar = parseInt(revRow?.revenue_zar ?? "0", 10) || 0;

  // ── COGS ───────────────────────────────────────────────────────────────────
  const [cogsRow] = await db.execute<{ cogs_zar: string | null }>(
    sql`SELECT cogs_zar FROM v_daily_cogs WHERE sast_date = ${date}::date`
  );
  const cogsZar = parseInt(cogsRow?.cogs_zar ?? "0", 10) || 0;

  // ── Expenses ───────────────────────────────────────────────────────────────
  const [expRow] = await db.execute<{ expenses_zar: string | null }>(
    sql`SELECT expenses_zar FROM v_daily_expenses WHERE sast_date = ${date}::date`
  );
  const expensesZar = parseInt(expRow?.expenses_zar ?? "0", 10) || 0;

  // ── cost_estimated_warning (R10) ───────────────────────────────────────────
  // A lot is considered "estimated" if its creation audit row contains
  // 'cost_estimated' in the reason field.
  const [warnRow] = await db.execute<{ cnt: string }>(sql`
    SELECT COUNT(DISTINCT al.entity_id) AS cnt
    FROM audit_log al
    JOIN stock_movements sm ON sm.inventory_lot_id = al.entity_id
    WHERE al.entity_kind = 'inventory_lot'
      AND al.action        = 'create'
      AND al.reason LIKE '%cost_estimated%'
      AND sm.kind          = 'deduction'
      AND (sm.at AT TIME ZONE 'Africa/Johannesburg')::date = ${date}::date
  `);
  const costEstimatedWarning = parseInt(warnRow?.cnt ?? "0", 10) > 0;

  const grossMarginZar = revenueZar - cogsZar;
  const netZar = grossMarginZar - expensesZar;

  return {
    date,
    revenueZar,
    cogsZar,
    expensesZar,
    grossMarginZar,
    netZar,
    profit: netZar > 0,
    costEstimatedWarning,
  };
}
