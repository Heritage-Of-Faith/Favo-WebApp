// AT-189 · AT-190 — REQ-106, REQ-109. PRD §7.0.2 L1790 "cogs_zar = Σ order_cogs".
//
// The one read every period figure (day, week, month, CSV) goes through.
// It sums order_cogs integers — rounded once, half-up, per order, at the sale —
// and never re-rounds; it never filters an absent cost out. An order with no
// order_cogs row, or a row that refused (cogs_zar NULL), makes the period
// UNAVAILABLE with the offending items named (rollupOrderCogs).
//
// Orders are bucketed by orders.revenue_day (the L07 SAST revenue day of
// record) and counted in the same states revenue counts:
// in_progress | ready | collected.

import { sql } from "drizzle-orm";
import { db as defaultDb, type DB } from "@/lib/db";
import { periodFigures, rollupOrderCogs, type CostRollup, type PeriodFigures } from "@/lib/cost-state";

export type PeriodCogs = CostRollup & {
  /** Display names of absentItemIds, same order. Unknown ids fall back to the id. */
  absentItemNames: string[];
};

type Row = {
  revenue_day: string;
  cogs_zar: number | null;
  absent_item_ids: string[] | null;
  estimated: boolean | null;
  missing: boolean;
};

/** Raw per-order rows for revenue days from..to inclusive (YYYY-MM-DD). */
async function readRows(from: string, to: string, db: DB): Promise<Row[]> {
  const rows = await db.execute<Row>(sql`
    SELECT
      TO_CHAR(o.revenue_day, 'YYYY-MM-DD') AS revenue_day,
      oc.cogs_zar,
      oc.absent_item_ids,
      oc.estimated,
      (oc.order_id IS NULL) AS missing
    FROM orders o
    LEFT JOIN order_cogs oc ON oc.order_id = o.id
    WHERE o.state IN ('in_progress', 'ready', 'collected')
      AND o.revenue_day >= ${from}::date
      AND o.revenue_day <= ${to}::date
  `);
  return [...rows];
}

async function namesFor(ids: readonly string[], db: DB): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const rows = await db.execute<{ id: string; name: string }>(sql`
    SELECT id, name FROM inventory_items WHERE id IN (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})
  `);
  return new Map([...rows].map((r) => [r.id, r.name]));
}

function toRollup(rows: readonly Row[]) {
  return rollupOrderCogs(
    rows.map((r) => ({
      cogsZar: r.cogs_zar === null ? null : Number(r.cogs_zar),
      absentItemIds: r.absent_item_ids ?? [],
      estimated: r.estimated,
      missing: r.missing === true,
    }))
  );
}

async function withNames(rollups: CostRollup[], db: DB): Promise<PeriodCogs[]> {
  const ids = [...new Set(rollups.flatMap((r) => r.absentItemIds))];
  const names = await namesFor(ids, db);
  return rollups.map((r) => ({ ...r, absentItemNames: r.absentItemIds.map((id) => names.get(id) ?? id) }));
}

/** Σ order_cogs over revenue days from..to inclusive. */
export async function readPeriodCogs(from: string, to: string, db: DB = defaultDb): Promise<PeriodCogs> {
  const rows = await readRows(from, to, db);
  const [result] = await withNames([toRollup(rows)], db);
  return result;
}

/** Σ order_cogs per revenue day, from..to inclusive. Days with no order are absent from the map (= empty). */
export async function readDailyCogs(
  from: string,
  to: string,
  db: DB = defaultDb
): Promise<Map<string, PeriodCogs>> {
  const rows = await readRows(from, to, db);
  const byDay = new Map<string, Row[]>();
  for (const r of rows) {
    const list = byDay.get(r.revenue_day) ?? [];
    list.push(r);
    byDay.set(r.revenue_day, list);
  }
  const days = [...byDay.keys()];
  const named = await withNames(days.map((d) => toRollup(byDay.get(d)!)), db);
  return new Map(days.map((d, i) => [d, named[i]]));
}

/**
 * Σ expenses.amount_zar per SAST day of incurred_at, from..to inclusive — the
 * ONE expenses read every period figure uses (dashboard, CSV, weekly, monthly),
 * so all of them subtract the same expenses from the same days.
 */
export async function readDailyExpenses(from: string, to: string, db: DB = defaultDb): Promise<Map<string, number>> {
  const rows = await db.execute<{ sast_date: string; expenses_zar: string | number }>(sql`
    SELECT
      TO_CHAR((incurred_at AT TIME ZONE 'Africa/Johannesburg')::date, 'YYYY-MM-DD') AS sast_date,
      SUM(amount_zar)::bigint AS expenses_zar
    FROM expenses
    WHERE (incurred_at AT TIME ZONE 'Africa/Johannesburg')::date >= ${from}::date
      AND (incurred_at AT TIME ZONE 'Africa/Johannesburg')::date <= ${to}::date
    GROUP BY 1
  `);
  return new Map([...rows].map((r) => [r.sast_date, Number(r.expenses_zar) || 0]));
}

/** Σ expenses over from..to inclusive (integer cents). */
export async function readPeriodExpenses(from: string, to: string, db: DB = defaultDb): Promise<number> {
  const byDay = await readDailyExpenses(from, to, db);
  return [...byDay.values()].reduce((s, v) => s + v, 0);
}

/**
 * Σ orders.total_zar per revenue_day (L07), from..to inclusive, in the same
 * states and the same day bucket as the COGS read — the ONE revenue read.
 */
export async function readDailyRevenue(from: string, to: string, db: DB = defaultDb): Promise<Map<string, number>> {
  const rows = await db.execute<{ revenue_day: string; revenue_zar: string | number }>(sql`
    SELECT
      TO_CHAR(revenue_day, 'YYYY-MM-DD') AS revenue_day,
      SUM(total_zar)::bigint AS revenue_zar
    FROM orders
    WHERE state IN ('in_progress', 'ready', 'collected')
      AND revenue_day >= ${from}::date
      AND revenue_day <= ${to}::date
    GROUP BY revenue_day
  `);
  return new Map([...rows].map((r) => [r.revenue_day, Number(r.revenue_zar) || 0]));
}

export type DayFigures = PeriodFigures & { date: string; cogs: PeriodCogs };

/**
 * Revenue, COGS and expenses for every day from..to inclusive, each passed
 * through periodFigures. Days with nothing are a genuine empty zero.
 */
export async function readDailyFigures(from: string, to: string, db: DB = defaultDb): Promise<DayFigures[]> {
  const revenue = await readDailyRevenue(from, to, db);
  const cogs = await readDailyCogs(from, to, db);
  const expenses = await readDailyExpenses(from, to, db);
  const out: DayFigures[] = [];
  for (let d = from; d <= to; d = nextDay(d)) {
    const c = cogs.get(d) ?? EMPTY_PERIOD_COGS;
    out.push({
      date: d,
      cogs: c,
      ...periodFigures({ revenueZar: revenue.get(d) ?? 0, cogsZar: c.cogsZar, expensesZar: expenses.get(d) ?? 0, costState: c.state }),
    });
  }
  return out;
}

/** The whole of from..to as one period, through the same reads and periodFigures. */
export async function readPeriodFigures(
  from: string,
  to: string,
  db: DB = defaultDb
): Promise<PeriodFigures & { cogs: PeriodCogs }> {
  const revenue = await readDailyRevenue(from, to, db);
  const cogs = await readPeriodCogs(from, to, db);
  const expenses = await readDailyExpenses(from, to, db);
  const sum = (m: Map<string, number>) => [...m.values()].reduce((s, v) => s + v, 0);
  return {
    cogs,
    ...periodFigures({ revenueZar: sum(revenue), cogsZar: cogs.cogsZar, expensesZar: sum(expenses), costState: cogs.state }),
  };
}

function nextDay(yyyymmdd: string): string {
  const d = new Date(`${yyyymmdd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** The figure for a day with no order at all — a genuine zero. */
export const EMPTY_PERIOD_COGS: PeriodCogs = {
  state: "empty",
  cogsZar: 0,
  absentItemIds: [],
  ordersWithoutCost: 0,
  orderCount: 0,
  absentItemNames: [],
};
