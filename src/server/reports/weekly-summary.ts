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
import {
  readDailyFiguresByEvent, readMarginByShot, readPeriodFigures,
  type DayFigures, type PeriodCogs, type ShotMarginRow,
} from "@/server/cogs/period-cogs";
import type { PeriodFigures } from "@/lib/cost-state";
import type { StaffRole } from "@/lib/types";
import { splitByMode, type Consumption, type ModeKey, type ModeSection, type SummaryDay } from "@/lib/weekly-summary";
import { listUnapprovedWriteOffDays } from "@/server/close/write-offs";
import { readActiveStaff, readWriteDowns } from "@/server/write-downs/summary";
import { perBaristaWithVouchers, readVoucherTallies, type BaristaWriteDownLine } from "@/server/write-downs/vouchers";

export type WeeklySummary = {
  weekStarting: string;
  weekEnding: string;
  headline: PeriodFigures & { cogs: PeriodCogs };
  sections: Record<ModeKey, ModeSection>;
  /**
   * REQ-139 · §7.1/§7.3: margin by shot count, per mode (readMarginByShot).
   * Gross figures only: a bucket's expensesZar / netZar are dropped, so no
   * expenses or net figure reaches a barista through this block.
   */
  marginByShot: Omit<ShotMarginRow, "expensesZar" | "netZar">[];
  /**
   * REQ-124 · REQ-145 · §7.3.1: the write-down block, per barista — comps,
   * deferred write-offs, abandoned orders and vouchers (count and value).
   */
  writeDowns: BaristaWriteDownLine[];
};

function addDays(yyyymmdd: string, days: number): string {
  const d = new Date(`${yyyymmdd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** What the screen receives: the week-level block and the write-down block are NULL unless the viewer is an Admin. */
export type WeeklySummaryForViewer = Omit<WeeklySummary, "headline" | "writeDowns"> & {
  headline: WeeklySummary["headline"] | null;
  writeDowns: WeeklySummary["writeDowns"] | null;
};

/**
 * AT-206 · §7.3 lists revenue, COGS and the profit flag per mode, not the
 * week's expenses or net; §10.7 keeps the other cost figures Admin-only. The
 * week-level block (revenue, COGS, expenses, net) is therefore removed on the
 * server for any non-Admin session — it never reaches a barista's browser.
 *
 * The §7.3.1 per-barista write-down block is removed the same way: §10.7
 * gives /admin/write-downs (the same per-barista figures, §17.4 "the
 * comps-review surface") to the Admin alone, so no barista session receives
 * another barista's comps, write-offs or vouchers until that is decided.
 */
export function summaryForRole(summary: WeeklySummary, role: StaffRole): WeeklySummaryForViewer {
  return role === "admin" ? summary : { ...summary, headline: null, writeDowns: null };
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

  const [headline, daily, sessions, drinks, entitlements, walkIns, consumption] = await Promise.all([
    readPeriodFigures(from, to, db),
    readDailyFiguresByEvent(from, to, db),
    db.execute<{ session_date: string; mode: string }>(sql`
      SELECT session_date, mode::text AS mode FROM opening_sessions
      WHERE session_date >= ${from} AND session_date <= ${to}
    `),
    // DEC-28 (d): every count below is split by orders.event_window_id, so an
    // event's drinks land in the Event section with its money.
    db.execute<{ revenue_day: string; drinks: string | number; event?: boolean | null }>(sql`
      SELECT TO_CHAR(o.revenue_day, 'YYYY-MM-DD') AS revenue_day, SUM(oi.quantity)::bigint AS drinks,
             (o.event_window_id IS NOT NULL) AS event
      FROM order_items oi JOIN orders o ON o.id = oi.order_id
      WHERE o.state IN ('in_progress', 'ready', 'collected')
        AND o.revenue_day >= ${from}::date AND o.revenue_day <= ${to}::date
      GROUP BY 1, (o.event_window_id IS NOT NULL)
    `),
    db.execute<{ revenue_day: string; cups: string | number; event?: boolean | null }>(sql`
      SELECT TO_CHAR(o.revenue_day, 'YYYY-MM-DD') AS revenue_day, COUNT(*)::bigint AS cups,
             (o.event_window_id IS NOT NULL) AS event
      FROM staff_entitlement_log sel JOIN orders o ON o.id = sel.order_id
      WHERE o.state IN ('in_progress', 'ready', 'collected')
        AND o.revenue_day >= ${from}::date AND o.revenue_day <= ${to}::date
      GROUP BY 1, (o.event_window_id IS NOT NULL)
    `),
    // REQ-123 / §7.0.2: walk_in_cups = Σ walk_ins.quantity (one row per line).
    db.execute<{ revenue_day: string; cups: string | number; event?: boolean | null }>(sql`
      SELECT TO_CHAR(o.revenue_day, 'YYYY-MM-DD') AS revenue_day, SUM(w.quantity)::bigint AS cups,
             (o.event_window_id IS NOT NULL) AS event
      FROM walk_ins w JOIN orders o ON o.id = w.order_id
      WHERE o.state IN ('in_progress', 'ready', 'collected')
        AND o.revenue_day >= ${from}::date AND o.revenue_day <= ${to}::date
      GROUP BY 1, (o.event_window_id IS NOT NULL)
    `),
    db.execute<{ revenue_day: string; kind: string; unit: string; quantity: string | number; event?: boolean | null }>(sql`
      SELECT TO_CHAR(o.revenue_day, 'YYYY-MM-DD') AS revenue_day, ii.kind::text AS kind, ii.unit::text AS unit,
             SUM(-sm.delta)::bigint AS quantity, (o.event_window_id IS NOT NULL) AS event
      FROM stock_movements sm
      JOIN orders o ON o.id = sm.related_order_id
      JOIN inventory_lots il ON il.id = sm.inventory_lot_id
      JOIN inventory_items ii ON ii.id = il.inventory_item_id
      WHERE sm.kind = 'deduction' AND ii.kind IN ('bean', 'milk')
        AND o.state IN ('in_progress', 'ready', 'collected')
        AND o.revenue_day >= ${from}::date AND o.revenue_day <= ${to}::date
      GROUP BY 1, 2, 3, (o.event_window_id IS NOT NULL)
    `),
  ]);

  const modes = new Map<string, string[]>();
  for (const s of sessions) modes.set(s.session_date, [...(modes.get(s.session_date) ?? []), s.mode]);
  // Keyed by day and part ("|e" = the day's event-stamped orders).
  const key = (day: string, event: boolean | null | undefined) => (event === true ? `${day}|e` : day);
  function sumBy<R extends { revenue_day: string; event?: boolean | null }>(rs: Iterable<R>, n: (r: R) => number) {
    const m = new Map<string, number>();
    for (const r of rs) {
      const k = key(r.revenue_day, r.event);
      m.set(k, (m.get(k) ?? 0) + n(r));
    }
    return m;
  }
  const drinksBy = sumBy(drinks, (r) => Number(r.drinks) || 0);
  const cupsBy = sumBy(entitlements, (r) => Number(r.cups) || 0);
  const walkInsBy = sumBy(walkIns, (r) => Number(r.cups) || 0);
  const useBy = new Map<string, Consumption[]>();
  for (const r of consumption) {
    const k = key(r.revenue_day, r.event);
    useBy.set(k, [...(useBy.get(k) ?? []), { kind: r.kind, unit: r.unit, quantity: Number(r.quantity) || 0 }]);
  }

  const toDay = (d: DayFigures, part?: "event"): SummaryDay => {
    const k = part ? `${d.date}|e` : d.date;
    return {
      date: d.date,
      ...(part ? { part } : {}),
      revenueZar: d.revenueZar,
      cogs: {
        state: d.cogs.state,
        cogsZar: d.cogs.cogsZar,
        absentItemNames: d.cogs.absentItemNames,
        ordersWithoutCost: d.cogs.ordersWithoutCost,
        orderCount: d.cogs.orderCount,
      },
      drinks: drinksBy.get(k) ?? 0,
      staffCoffees: cupsBy.get(k) ?? 0,
      walkInCups: walkInsBy.get(k) ?? 0,
      consumption: useBy.get(k) ?? [],
    };
  };
  const days: SummaryDay[] = [...daily.rest.map((d) => toDay(d)), ...daily.event.map((d) => toDay(d, "event"))];

  // REQ-139: the dashboard's own margin-by-shot read, for the same Mon..Sun.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const marginByShot = (await readMarginByShot(from, to, db)).map(({ expensesZar, netZar, ...gross }) => gross);

  // §7.3.1 / REQ-124 / REQ-145: the /admin/write-downs reads, plus vouchers.
  // "unapproved" has one definition — the §6.0.5 approval queue's reader.
  const unapproved = new Set((await listUnapprovedWriteOffDays(db)).map((d) => d.revenueDay));
  const writeDownRows = await readWriteDowns(db, from, to, unapproved);
  const staff = await readActiveStaff(db);
  const tallies = await readVoucherTallies(db, from, to);

  return {
    weekStarting,
    weekEnding: to,
    headline,
    sections: splitByMode(days, modes),
    marginByShot,
    writeDowns: perBaristaWithVouchers(writeDownRows, staff, tallies),
  };
}
