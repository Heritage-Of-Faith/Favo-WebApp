"use server";

// POS daily summary — task M12 (POS-readable; coordinated with G13).
// getPosToday: barista+ readable. Returns today's order count, revenue, and
// waste count for the SAST revenue day. Revenue reuses the v_daily_revenue
// view (migration 0004) so the number matches the admin COGS dashboard.
// REQ-128 (PRD v7 §7.5) adds drinks, fee, net, write-offs, comps, entitlement
// cups and walk-in cups, each read as PRD §7.0.2's DAY block defines it.
// Docs: BUSINESS_RULES.md L07 (midnight SAST boundary)

import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { authorize } from "@/server/auth/guard";
import { todaySast } from "@/server/cogs/compute";
import { revenueOrderScope } from "@/server/reports/revenue-scope";
import { feeAndNet } from "@/lib/pos-today";
import type { ActionResult, PosTodaySummary } from "@/lib/types";

const POS_ROLES = ["barista", "admin"] as const;

/**
 * Today's barista-facing volume summary for the current SAST day.
 * Revenue and the order count use the shared revenue scope (started orders,
 * plus a cancelled order holding a successful payment — the v_daily_revenue
 * definition, src/server/reports/revenue-scope.ts). Waste count is waste_log
 * rows logged today (SAST), not counting abandoned orders.
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

  // Order count — the same revenue scope and SAST-day boundary as the view.
  const [orderRow] = await db.execute<{ n: string | null }>(
    sql`SELECT COUNT(*)::text AS n FROM orders
        WHERE ${revenueOrderScope}
          AND (placed_at AT TIME ZONE 'Africa/Johannesburg')::date = ${date}::date`
  );
  const orderCount = parseInt(orderRow?.n ?? "0", 10) || 0;

  // Waste events logged today (SAST). AT-209: an abandoned order (T6 step 2b)
  // is a per-barista write-down (§7.3.1), not stock waste — it holds no lot
  // and moves no stock — so it is not counted here.
  const [wasteRow] = await db.execute<{ n: string | null }>(
    sql`SELECT COUNT(*)::text AS n FROM waste_log
        WHERE (at AT TIME ZONE 'Africa/Johannesburg')::date = ${date}::date
          AND category <> 'abandoned'`
  );
  const wasteCount = parseInt(wasteRow?.n ?? "0", 10) || 0;

  // REQ-128 / PRD §7.5: drinks, fee, net, write-offs, comps, entitlement cups
  // and walk-in cups — each one PRD §7.0.2 DAY term, read for today's revenue
  // day (orders.revenue_day, L07). Read only: nothing here writes.
  const [day] = await db.execute<Record<string, string | null>>(
    sql`SELECT
      (SELECT COALESCE(SUM(oi.quantity), 0)::text FROM order_items oi
         JOIN orders ON orders.id = oi.order_id
        WHERE ${revenueOrderScope} AND orders.revenue_day = ${date}::date) AS drinks,
      (SELECT COALESCE(SUM(orders.total_zar), 0)::text FROM orders
        WHERE ${revenueOrderScope} AND orders.revenue_day = ${date}::date
          AND orders.payment_mode IN ('yoco', 'yoco_deferred')) AS card_gross_zar,
      (SELECT COALESCE(SUM(p.amount_zar), 0)::text FROM payments p
        WHERE p.fund_topup_id IS NOT NULL AND p.status = 'successful'
          AND (p.at AT TIME ZONE 'Africa/Johannesburg')::date = ${date}::date) AS topups_settled_zar,
      (SELECT COALESCE(SUM(p.fee_zar), 0)::text FROM payments p LEFT JOIN orders o ON o.id = p.order_id
        WHERE p.status = 'successful'
          AND (o.revenue_day = ${date}::date
               OR (p.fund_topup_id IS NOT NULL AND (p.at AT TIME ZONE 'Africa/Johannesburg')::date = ${date}::date))) AS fee_sum_zar,
      (SELECT COUNT(*)::text FROM payments p LEFT JOIN orders o ON o.id = p.order_id
        WHERE p.status = 'successful' AND p.fee_zar IS NULL
          AND (o.revenue_day = ${date}::date
               OR (p.fund_topup_id IS NOT NULL AND (p.at AT TIME ZONE 'Africa/Johannesburg')::date = ${date}::date))) AS fee_unknown,
      (SELECT COALESCE(SUM(orders.total_zar), 0)::text FROM orders
        WHERE orders.revenue_day = ${date}::date AND orders.written_off_at IS NOT NULL) AS written_off_zar,
      (SELECT COALESCE(SUM(oi.discount_zar), 0)::text FROM order_items oi
         JOIN orders ON orders.id = oi.order_id
        WHERE ${revenueOrderScope} AND orders.revenue_day = ${date}::date
          AND oi.comp_reason IS NOT NULL) AS comps_zar,
      (SELECT COUNT(*)::text FROM staff_entitlement_log WHERE day = ${date}) AS entitlement_cups,
      (SELECT COALESCE(SUM(w.quantity), 0)::text FROM walk_ins w
         JOIN orders ON orders.id = w.order_id
        WHERE orders.revenue_day = ${date}::date) AS walk_in_cups,
      -- REQ-133 / §7.5: yoco_deferred split by settled_at and written_off_at.
      (SELECT COALESCE(SUM(orders.total_zar), 0)::text FROM orders
        WHERE orders.revenue_day = ${date}::date AND orders.payment_mode = 'yoco_deferred'
          AND orders.state <> 'cancelled' AND orders.settled_at IS NULL AND orders.written_off_at IS NULL) AS deferred_open_zar,
      (SELECT COALESCE(SUM(orders.total_zar), 0)::text FROM orders
        WHERE orders.revenue_day = ${date}::date AND orders.payment_mode = 'yoco_deferred'
          AND orders.state <> 'cancelled' AND orders.settled_at IS NOT NULL) AS deferred_settled_zar,
      (SELECT COALESCE(SUM(orders.total_zar), 0)::text FROM orders
        WHERE orders.revenue_day = ${date}::date AND orders.payment_mode = 'yoco_deferred'
          AND orders.written_off_at IS NOT NULL) AS deferred_written_off_zar`
  );
  const int = (k: string) => parseInt(day?.[k] ?? "0", 10) || 0;
  const { feeZar, netSettledZar } = feeAndNet({
    cardGrossZar: int("card_gross_zar"),
    topupsSettledZar: int("topups_settled_zar"),
    feeSumZar: int("fee_sum_zar"),
    feeUnknownCount: int("fee_unknown"),
  });

  return {
    ok: true,
    data: {
      date, orderCount, revenueZar, wasteCount,
      drinks: int("drinks"),
      feeZar,
      netSettledZar,
      writtenOffZar: int("written_off_zar"),
      compsZar: int("comps_zar"),
      entitlementCups: int("entitlement_cups"),
      walkInCups: int("walk_in_cups"),
      deferredOpenZar: int("deferred_open_zar"),
      deferredSettledZar: int("deferred_settled_zar"),
      deferredWrittenOffZar: int("deferred_written_off_zar"),
    },
  };
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
