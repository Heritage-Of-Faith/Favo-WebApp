"use server";

// POS daily summary — task M12 (POS-readable; coordinated with G13).
// getPosToday: barista+ readable. Returns today's order count, revenue, and
// waste count for the SAST revenue day. Revenue reuses the v_daily_revenue
// view (migration 0004) so the number matches the admin COGS dashboard.
// Docs: FAVO_PRD_v3.md §07 §09 · BUSINESS_RULES.md L07 (midnight SAST boundary)

import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { authorize } from "@/server/auth/guard";
import { todaySast } from "@/server/cogs/compute";
import type { ActionResult, PosTodaySummary } from "@/lib/types";

const POS_ROLES = ["barista", "roaster", "manager", "admin", "owner"] as const;

/**
 * Today's barista-facing volume summary for the current SAST day.
 * Revenue counts orders in in_progress / ready / collected (same definition
 * as v_daily_revenue). Waste count is waste_log rows logged today (SAST).
 */
export async function getPosToday(): Promise<ActionResult<PosTodaySummary>> {
  const auth = await authorize(...POS_ROLES);
  if (!auth.ok) return auth;

  const date = todaySast();

  // Revenue — reuse the admin dashboard's view so numbers always agree.
  const [revRow] = await db.execute<{ revenue_zar: string | null }>(
    sql`SELECT revenue_zar FROM v_daily_revenue WHERE sast_date = ${date}::date`
  );
  const revenueZar = parseInt(revRow?.revenue_zar ?? "0", 10) || 0;

  // Order count — same state filter and SAST-day boundary as revenue.
  const [orderRow] = await db.execute<{ n: string | null }>(
    sql`SELECT COUNT(*)::text AS n FROM orders
        WHERE state IN ('in_progress','ready','collected')
          AND (placed_at AT TIME ZONE 'Africa/Johannesburg')::date = ${date}::date`
  );
  const orderCount = parseInt(orderRow?.n ?? "0", 10) || 0;

  // Waste events logged today (SAST).
  const [wasteRow] = await db.execute<{ n: string | null }>(
    sql`SELECT COUNT(*)::text AS n FROM waste_log
        WHERE (at AT TIME ZONE 'Africa/Johannesburg')::date = ${date}::date`
  );
  const wasteCount = parseInt(wasteRow?.n ?? "0", 10) || 0;

  return { ok: true, data: { date, orderCount, revenueZar, wasteCount } };
}
