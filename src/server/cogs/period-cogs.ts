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
import { dayMode, marginByShot, type ShotMargin } from "@/lib/margin-by-shot";
import { revenueOrderScope } from "@/server/reports/revenue-scope";

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
  /** DEC-28 (d): the order's event window, or null when rung under no event. */
  event_window_id?: string | null;
};

/** Raw per-order rows for revenue days from..to inclusive (YYYY-MM-DD). */
async function readRows(from: string, to: string, db: DB): Promise<Row[]> {
  const rows = await db.execute<Row>(sql`
    SELECT
      TO_CHAR(o.revenue_day, 'YYYY-MM-DD') AS revenue_day,
      o.event_window_id,
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
 * day bucket as the COGS read — the ONE revenue read. AT-209: its scope is the
 * shared revenue rule (src/server/reports/revenue-scope.ts) — the started
 * states, plus a cancelled order that holds a successful payment (L02, §11.3
 * cancelOrder: cancelling does not return money), or a fund draw that was not
 * given back (an abandoned fund-paid order, §6.10.4, L47). The COGS read keeps the
 * started states only: a started order cancelled with an admin PIN has its
 * stock reversed by compensating rows (REQ-040).
 */
export async function readDailyRevenue(from: string, to: string, db: DB = defaultDb): Promise<Map<string, number>> {
  const rows = await db.execute<{ revenue_day: string; revenue_zar: string | number }>(sql`
    SELECT
      TO_CHAR(revenue_day, 'YYYY-MM-DD') AS revenue_day,
      SUM(total_zar)::bigint AS revenue_zar
    FROM orders
    WHERE ${revenueOrderScope}
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

/**
 * DEC-28 (d): revenue per revenue_day, split by whether the order is stamped
 * with an event window — the same scope and day bucket as readDailyRevenue.
 */
async function readDailyRevenueByEvent(
  from: string,
  to: string,
  db: DB
): Promise<{ rest: Map<string, number>; event: Map<string, number> }> {
  const rows = await db.execute<{ revenue_day: string; event?: boolean | null; revenue_zar: string | number }>(sql`
    SELECT
      TO_CHAR(revenue_day, 'YYYY-MM-DD') AS revenue_day,
      (event_window_id IS NOT NULL) AS event,
      SUM(total_zar)::bigint AS revenue_zar
    FROM orders
    WHERE ${revenueOrderScope}
      AND revenue_day >= ${from}::date
      AND revenue_day <= ${to}::date
    GROUP BY revenue_day, (event_window_id IS NOT NULL)
  `);
  const rest = new Map<string, number>();
  const event = new Map<string, number>();
  for (const r of rows) {
    const m = r.event === true ? event : rest;
    m.set(r.revenue_day, (m.get(r.revenue_day) ?? 0) + (Number(r.revenue_zar) || 0));
  }
  return { rest, event };
}

/**
 * DEC-28 (d): the day figures in two parts — `rest`, every day from..to for
 * the orders with no event_window_id (carrying the day's expenses), and
 * `event`, only the days that hold event-stamped orders (expenses 0, so the
 * period's expenses are counted once). rest + event = readDailyFigures, order
 * for order: the same reads, the same frozen order_cogs integers, nothing
 * re-rounded (REQ-106).
 */
export async function readDailyFiguresByEvent(
  from: string,
  to: string,
  db: DB = defaultDb
): Promise<{ rest: DayFigures[]; event: DayFigures[] }> {
  const revenue = await readDailyRevenueByEvent(from, to, db);
  const rows = await readRows(from, to, db);
  const expenses = await readDailyExpenses(from, to, db);
  const restRows = new Map<string, Row[]>();
  const eventRows = new Map<string, Row[]>();
  for (const r of rows) {
    const m = r.event_window_id != null ? eventRows : restRows;
    m.set(r.revenue_day, [...(m.get(r.revenue_day) ?? []), r]);
  }
  const eventDates = [...new Set([...eventRows.keys(), ...revenue.event.keys()])].sort();
  const restDates: string[] = [];
  for (let d = from; d <= to; d = nextDay(d)) restDates.push(d);

  const rollups = [
    ...restDates.map((d) => (restRows.has(d) ? toRollup(restRows.get(d)!) : null)),
    ...eventDates.map((d) => toRollup(eventRows.get(d) ?? [])),
  ];
  const named = await withNames(rollups.filter((r): r is CostRollup => r !== null), db);
  let i = 0;
  const cogsOf = (r: CostRollup | null): PeriodCogs => (r === null ? EMPTY_PERIOD_COGS : named[i++]);
  const restCogs = rollups.slice(0, restDates.length).map(cogsOf);
  const eventCogs = rollups.slice(restDates.length).map(cogsOf);

  const figures = (date: string, c: PeriodCogs, revenueZar: number, expensesZar: number): DayFigures => ({
    date,
    cogs: c,
    ...periodFigures({ revenueZar, cogsZar: c.cogsZar, expensesZar, costState: c.state }),
  });
  return {
    rest: restDates.map((d, k) => figures(d, restCogs[k], revenue.rest.get(d) ?? 0, expenses.get(d) ?? 0)),
    event: eventDates.map((d, k) => figures(d, eventCogs[k], revenue.event.get(d) ?? 0, 0)),
  };
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

export type ShotMarginRow = ShotMargin & { absentItemNames: string[] };

/**
 * AT-208 · REQ-139: margin by shot count over revenue days from..to inclusive.
 * The same orders, states and day bucket as readPeriodCogs / readDailyRevenue,
 * the same frozen order_cogs integers, and periodFigures per bucket — so the
 * buckets sum to the period's revenue and cogs_zar. Buckets are per mode
 * (§7.1), the mode read from the revenue day's opening_sessions exactly as
 * cup-lid.ts does (orders carry no session link). A coffee line is one whose
 * menu item's recipe draws a 'bean' ingredient (the shot_factor rule, §7.0.2).
 */
export async function readMarginByShot(from: string, to: string, db: DB = defaultDb): Promise<ShotMarginRow[]> {
  const rows = await db.execute<{
    total_zar: number | string;
    cogs_zar: number | null;
    absent_item_ids: string[] | null;
    estimated: boolean | null;
    missing: boolean;
    coffee_shots: (number | string)[] | null;
    day_mode: string | null;
  }>(sql`
    SELECT
      o.total_zar,
      CASE WHEN o.event_window_id IS NULL THEN (
        SELECT CASE
          WHEN COUNT(*) = 0 THEN 'no_session'
          WHEN COUNT(DISTINCT s.mode) = 1 THEN MIN(s.mode::text)
          ELSE 'mixed_day'
        END
        FROM opening_sessions s
        WHERE s.session_date = TO_CHAR(o.revenue_day, 'YYYY-MM-DD')
          -- DEC-28 (d): an unstamped order on a day that holds a non-event
          -- session takes the non-event sessions' mode — the same rule as
          -- restOfDayMode (src/lib/weekly-summary.ts).
          AND NOT (
            s.mode = 'event'
            AND EXISTS (SELECT 1 FROM opening_sessions s2 WHERE s2.session_date = s.session_date AND s2.mode <> 'event')
          )
      ) ELSE 'event' END AS day_mode,
      oc.cogs_zar,
      oc.absent_item_ids,
      oc.estimated,
      (oc.order_id IS NULL) AS missing,
      ARRAY(
        SELECT oi.shots
        FROM order_items oi
        JOIN menu_items mi ON mi.id = oi.menu_item_id
        WHERE oi.order_id = o.id
          AND EXISTS (
            SELECT 1
            FROM recipe_ingredients ri
            JOIN inventory_items ii ON ii.id = ri.inventory_item_id
            WHERE ri.recipe_id = mi.recipe_id
              AND ii.kind = 'bean'
          )
      ) AS coffee_shots
    FROM orders o
    LEFT JOIN order_cogs oc ON oc.order_id = o.id
    WHERE o.state IN ('in_progress', 'ready', 'collected')
      AND o.revenue_day >= ${from}::date
      AND o.revenue_day <= ${to}::date
  `);
  const margins = marginByShot(
    [...rows].map((r) => ({
      mode: dayMode(r.day_mode),
      netChargedZar: Number(r.total_zar) || 0,
      coffeeShots: (r.coffee_shots ?? []).map(Number),
      cogs: {
        cogsZar: r.cogs_zar === null ? null : Number(r.cogs_zar),
        absentItemIds: r.absent_item_ids ?? [],
        estimated: r.estimated,
        missing: r.missing === true,
      },
    }))
  );
  const names = await namesFor([...new Set(margins.flatMap((m) => m.absentItemIds))], db);
  return margins.map((m) => ({ ...m, absentItemNames: m.absentItemIds.map((id) => names.get(id) ?? id) }));
}

export type DailyOutreach = { cogsZar: number; unrecordedOrders: number; absentCostOrders: number };

/**
 * REQ-158 · §7.0.2 L1814–1822 — outreach_cogs per revenue day: live
 * voucher_redemptions (reversed_at IS NULL) on orders in the same started
 * states as the COGS read (§6.10.5: "counted as paper, not counted as coffee"
 * until in_progress). order_cogs holds one integer per order and no per-line
 * figure, so an order's outreach share is known only when EVERY unit of every
 * line carries a live redemption: then it is the whole order_cogs, rounded
 * once with its order (L1821). Any other vouchered order is counted in
 * unrecordedOrders, a fully vouchered order with no order_cogs figure in
 * absentCostOrders, and either makes the day's outreach UNAVAILABLE.
 */
export async function readDailyOutreach(from: string, to: string, db: DB = defaultDb): Promise<Map<string, DailyOutreach>> {
  const rows = await db.execute<{ revenue_day: string; cogs_zar: number | string | null; fully_vouchered: boolean }>(sql`
    SELECT
      TO_CHAR(o.revenue_day, 'YYYY-MM-DD') AS revenue_day,
      oc.cogs_zar,
      BOOL_AND(v.live = oi.quantity) AS fully_vouchered
    FROM orders o
    JOIN order_items oi ON oi.order_id = o.id
    LEFT JOIN order_cogs oc ON oc.order_id = o.id
    CROSS JOIN LATERAL (
      SELECT COUNT(*)::int AS live
      FROM voucher_redemptions vr
      WHERE vr.order_item_id = oi.id AND vr.reversed_at IS NULL
    ) v
    WHERE o.state IN ('in_progress', 'ready', 'collected')
      AND o.revenue_day >= ${from}::date
      AND o.revenue_day <= ${to}::date
    GROUP BY o.id, o.revenue_day, oc.cogs_zar
    HAVING SUM(v.live) > 0
  `);
  const out = new Map<string, DailyOutreach>();
  for (const r of rows) {
    const o = out.get(r.revenue_day) ?? { cogsZar: 0, unrecordedOrders: 0, absentCostOrders: 0 };
    if (r.fully_vouchered !== true) o.unrecordedOrders += 1;
    // An absent order_cogs (NULL, or no row) is never an outreach cost of 0.
    else if (r.cogs_zar === null) o.absentCostOrders += 1;
    else o.cogsZar += Number(r.cogs_zar);
    out.set(r.revenue_day, o);
  }
  return out;
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
