// REQ-121 · PRD §7.1 — the dashboard's per-mode read. Read only.
// The day figures are the one figure path (readDailyFigures: Σ order_cogs,
// rounded once per order at the sale; revenue by orders.revenue_day); the
// modes are the revenue days' opening_sessions, as the weekly summary reads
// them. The split itself is src/lib/mode-split.ts.
// DEC-28 (d): event-stamped orders (orders.event_window_id) are read as their
// own part of the day and reported as Event (readDailyFiguresByEvent).

import { sql } from "drizzle-orm";
import { db as defaultDb, type DB } from "@/lib/db";
import { readDailyFiguresByEvent, type DayFigures } from "@/server/cogs/period-cogs";
import { splitFiguresByMode, type ModeDay, type ModeSplit } from "@/lib/mode-split";

function toModeDay(d: DayFigures, part?: "event"): ModeDay {
  return {
    date: d.date,
    revenueZar: d.revenueZar,
    expensesZar: d.expensesZar,
    cogs: {
      state: d.cogs.state,
      cogsZar: d.cogs.cogsZar,
      absentItemNames: d.cogs.absentItemNames,
      ordersWithoutCost: d.cogs.ordersWithoutCost,
      orderCount: d.cogs.orderCount,
    },
    ...(part ? { part } : {}),
  };
}

export async function readModeSplit(from: string, to: string, db: DB = defaultDb): Promise<ModeSplit> {
  const daily = await readDailyFiguresByEvent(from, to, db);
  const sessions = await db.execute<{ session_date: string; mode: string }>(sql`
    SELECT session_date, mode::text AS mode FROM opening_sessions
    WHERE session_date >= ${from} AND session_date <= ${to}
  `);
  const modes = new Map<string, string[]>();
  for (const s of sessions) modes.set(s.session_date, [...(modes.get(s.session_date) ?? []), s.mode]);
  return splitFiguresByMode(
    from,
    to,
    [...daily.rest.map((d) => toModeDay(d)), ...daily.event.map((d) => toModeDay(d, "event"))],
    modes
  );
}
