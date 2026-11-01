// AT-206 — PRD §7.3 weekly ops summary, the in-app screen's read. REQ-123.
//
// Read-only. Revenue, COGS, expenses and the cost state come from the one
// figure path (period-cogs.ts: Σ order_cogs, never re-rounded, an absent
// input named, never filtered). The counts below are read for the same
// orders in the same states and the same revenue_day bucket.
//
// Stored vs live: this screen recomputes the week live; it does not read the
// weekly_reports row that job 3 froze. A recost of a lot after the report
// does NOT move the COGS here: order_cogs (amount and its estimated flag) is
// frozen at the sale and never rewritten. What CAN make this screen differ
// from the stored row — and from what the Monday push announced — is any
// other live input moving after the report was written: an order of that
// week changing state (counted or not), or an expense for that week logged
// late. The stored row is the record of the report; this screen is the
// current reading of the same week.

import { sql } from "drizzle-orm";
import { db as defaultDb, type DB } from "@/lib/db";
import { readDailyFigures, readPeriodFigures, type PeriodCogs } from "@/server/cogs/period-cogs";
import type { PeriodFigures } from "@/lib/cost-state";
import type { StaffRole } from "@/lib/types";
import { splitByMode, type Consumption, type ModeKey, type ModeSection, type SummaryDay } from "@/lib/weekly-summary";

export type WeeklySummary = {
  weekStarting: string;
  weekEnding: string;
  headline: PeriodFigures & { cogs: PeriodCogs };
  sections: Record<ModeKey, ModeSection>;
};

function addDays(yyyymmdd: string, days: number): string {
  const d = new Date(`${yyyymmdd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** What the screen receives: the week-level block is NULL unless the viewer is an Admin. */
export type WeeklySummaryForViewer = Omit<WeeklySummary, "headline"> & { headline: WeeklySummary["headline"] | null };

/**
 * AT-206 · §7.3 lists revenue, COGS and the profit flag per mode, not the
 * week's expenses or net; §10.7 keeps the other cost figures Admin-only. The
 * week-level block (revenue, COGS, expenses, net) is therefore removed on the
 * server for any non-Admin session — it never reaches a barista's browser.
 */
export function summaryForRole(summary: WeeklySummary, role: StaffRole): WeeklySummaryForViewer {
  return role === "admin" ? summary : { ...summary, headline: null };
}

/** Weeks that have a generated report, newest first. */
export async function listWeeklyReportWeeks(limit = 12, db: DB = defaultDb): Promise<string[]> {
  const rows = await db.execute<{ week_starting: string }>(sql`
    SELECT week_starting FROM weekly_reports ORDER BY week_starting DESC LIMIT ${limit}
  `);
  return [...rows].map((r) => r.week_starting);
}

export async function readWeeklySummary(weekStarting: string, db: DB = defaultDb): Promise<WeeklySummary> {
  const from = weekStarting;
  const to = addDays(weekStarting, 6);

  const [headline, daily, sessions, drinks, entitlements, consumption] = await Promise.all([
    readPeriodFigures(from, to, db),
    readDailyFigures(from, to, db),
    db.execute<{ session_date: string; mode: string }>(sql`
      SELECT session_date, mode::text AS mode FROM opening_sessions
      WHERE session_date >= ${from} AND session_date <= ${to}
    `),
    db.execute<{ revenue_day: string; drinks: string | number }>(sql`
      SELECT TO_CHAR(o.revenue_day, 'YYYY-MM-DD') AS revenue_day, SUM(oi.quantity)::bigint AS drinks
      FROM order_items oi JOIN orders o ON o.id = oi.order_id
      WHERE o.state IN ('in_progress', 'ready', 'collected')
        AND o.revenue_day >= ${from}::date AND o.revenue_day <= ${to}::date
      GROUP BY 1
    `),
    db.execute<{ revenue_day: string; cups: string | number }>(sql`
      SELECT TO_CHAR(o.revenue_day, 'YYYY-MM-DD') AS revenue_day, COUNT(*)::bigint AS cups
      FROM staff_entitlement_log sel JOIN orders o ON o.id = sel.order_id
      WHERE o.state IN ('in_progress', 'ready', 'collected')
        AND o.revenue_day >= ${from}::date AND o.revenue_day <= ${to}::date
      GROUP BY 1
    `),
    db.execute<{ revenue_day: string; kind: string; unit: string; quantity: string | number }>(sql`
      SELECT TO_CHAR(o.revenue_day, 'YYYY-MM-DD') AS revenue_day, ii.kind::text AS kind, ii.unit::text AS unit,
             SUM(-sm.delta)::bigint AS quantity
      FROM stock_movements sm
      JOIN orders o ON o.id = sm.related_order_id
      JOIN inventory_lots il ON il.id = sm.inventory_lot_id
      JOIN inventory_items ii ON ii.id = il.inventory_item_id
      WHERE sm.kind = 'deduction' AND ii.kind IN ('bean', 'milk')
        AND o.state IN ('in_progress', 'ready', 'collected')
        AND o.revenue_day >= ${from}::date AND o.revenue_day <= ${to}::date
      GROUP BY 1, 2, 3
    `),
  ]);

  const modes = new Map<string, string[]>();
  for (const s of sessions) modes.set(s.session_date, [...(modes.get(s.session_date) ?? []), s.mode]);
  const drinksBy = new Map([...drinks].map((r) => [r.revenue_day, Number(r.drinks) || 0]));
  const cupsBy = new Map([...entitlements].map((r) => [r.revenue_day, Number(r.cups) || 0]));
  const useBy = new Map<string, Consumption[]>();
  for (const r of consumption) {
    useBy.set(r.revenue_day, [...(useBy.get(r.revenue_day) ?? []), { kind: r.kind, unit: r.unit, quantity: Number(r.quantity) || 0 }]);
  }

  const days: SummaryDay[] = daily.map((d) => ({
    date: d.date,
    revenueZar: d.revenueZar,
    cogs: {
      state: d.cogs.state,
      cogsZar: d.cogs.cogsZar,
      absentItemNames: d.cogs.absentItemNames,
      ordersWithoutCost: d.cogs.ordersWithoutCost,
      orderCount: d.cogs.orderCount,
    },
    drinks: drinksBy.get(d.date) ?? 0,
    staffCoffees: cupsBy.get(d.date) ?? 0,
    consumption: useBy.get(d.date) ?? [],
  }));

  return { weekStarting, weekEnding: to, headline, sections: splitByMode(days, modes) };
}
