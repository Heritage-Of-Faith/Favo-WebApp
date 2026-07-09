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

const POS_ROLES = ["barista", "admin"] as const;

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

// ─── AT-146 — daily item history ──────────────────────────────────────────────

export type DailyItemCount = { menuItemId: string; name: string; quantity: number };
export type DailyHistoryDay = {
  /** SAST calendar date, YYYY-MM-DD. */
  date: string;
  totalItems: number;
  /** Every active menu item, zero-filled, in stable name order. */
  items: DailyItemCount[];
};

const HISTORY_MAX_DAYS = 31;

/**
 * Per-menu-item "items made" counts for the last `days` SAST days (today
 * first). Counts sum order_items.quantity for orders that were actually made
 * (in_progress / ready / collected — same state filter as getPosToday), so
 * cancelled and never-started orders don't inflate the tally. Every active
 * menu item appears in every day, zero-filled, so the list stays scannable
 * (wireframe screen 4). Counts only — no revenue.
 */
export async function getDailyItemHistory(
  days = 7
): Promise<ActionResult<{ days: DailyHistoryDay[] }>> {
  const auth = await authorize(...POS_ROLES);
  if (!auth.ok) return auth;

  const span = Math.min(Math.max(Math.trunc(days), 1), HISTORY_MAX_DAYS);
  const today = todaySast();

  const [menuRows, countRows] = await Promise.all([
    db.execute<{ id: string; name: string }>(
      sql`SELECT id, name FROM menu_items WHERE active = true ORDER BY name`
    ),
    db.execute<{ day: string; menu_item_id: string; qty: string }>(
      sql`SELECT (o.placed_at AT TIME ZONE 'Africa/Johannesburg')::date::text AS day,
                 oi.menu_item_id,
                 SUM(oi.quantity)::text AS qty
          FROM order_items oi
          JOIN orders o ON o.id = oi.order_id
          WHERE o.state IN ('in_progress','ready','collected')
            AND (o.placed_at AT TIME ZONE 'Africa/Johannesburg')::date
                > (${today}::date - ${span}::int)
          GROUP BY 1, 2`
    ),
  ]);

  const byDayItem = new Map<string, number>();
  for (const r of countRows) {
    byDayItem.set(`${r.day}|${r.menu_item_id}`, parseInt(r.qty, 10) || 0);
  }

  // Build the day list in Node (today backwards) rather than a generate_series
  // join — the span is tiny and this keeps the SQL to one aggregate.
  const result: DailyHistoryDay[] = [];
  const todayUtc = new Date(`${today}T00:00:00Z`);
  for (let i = 0; i < span; i++) {
    const d = new Date(todayUtc);
    d.setUTCDate(d.getUTCDate() - i);
    const date = d.toISOString().slice(0, 10);
    const items = [...menuRows].map((m) => ({
      menuItemId: m.id,
      name: m.name,
      quantity: byDayItem.get(`${date}|${m.id}`) ?? 0,
    }));
    result.push({
      date,
      totalItems: items.reduce((sum, it) => sum + it.quantity, 0),
      items,
    });
  }

  return { ok: true, data: { days: result } };
}
