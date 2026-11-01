// AT-205 — REQ-112, REQ-113, REQ-114 · PRD §7.0.2 ROLLUP, §7.2.
//
// The ministry rollup over revenue days from..to inclusive, built on the ONE
// figure path: the same revenue, order_cogs and expenses reads every period
// figure uses (period-cogs.ts). It adds only the day's session modes, the
// count of settled card orders (whose fees are not recorded yet — no
// payments.fee_zar column), and whether logExpense has ever written.

import { sql } from "drizzle-orm";
import { db as defaultDb, type DB } from "@/lib/db";
import { ministryRollup, type MinistryDay, type MinistryRollup } from "@/lib/ministry-rollup";
import type { SessionMode } from "@/lib/session-mode";
import { EMPTY_PERIOD_COGS, readDailyCogs, readDailyExpenses, readDailyRevenue } from "@/server/cogs/period-cogs";
import { revenueOrderScope } from "@/server/reports/revenue-scope";

// PRD L3411's Expenses empty-state wording ("reads COGS only until one is")
// contradicts REQ-114 (UNAVAILABLE, never COGS-only); the expenses screen must not ship it.

/** The audit action logExpense writes; its existence is REQ-114's "writer". */
export const EXPENSE_LOGGED_ACTION = "expense.logged";

async function readDayModes(from: string, to: string, db: DB): Promise<Map<string, SessionMode[]>> {
  const rows = await db.execute<{ session_date: string; mode: SessionMode }>(sql`
    SELECT session_date, mode FROM opening_sessions
    WHERE session_date >= ${from} AND session_date <= ${to}
  `);
  const out = new Map<string, SessionMode[]>();
  for (const r of rows) out.set(r.session_date, [...(out.get(r.session_date) ?? []), r.mode]);
  return out;
}

/** Counted orders with a successful payment, per revenue day. */
async function readSettledOrders(from: string, to: string, db: DB): Promise<Map<string, number>> {
  const rows = await db.execute<{ revenue_day: string; n: string | number }>(sql`
    SELECT TO_CHAR(orders.revenue_day, 'YYYY-MM-DD') AS revenue_day, COUNT(DISTINCT orders.id) AS n
    FROM orders
    JOIN payments p ON p.order_id = orders.id AND p.status = 'successful'
    WHERE ${revenueOrderScope}
      AND orders.revenue_day >= ${from}::date
      AND orders.revenue_day <= ${to}::date
    GROUP BY 1
  `);
  return new Map([...rows].map((r) => [r.revenue_day, Number(r.n) || 0]));
}

async function readExpenseWriterExists(db: DB): Promise<boolean> {
  const rows = await db.execute<{ exists: boolean }>(sql`
    SELECT EXISTS (SELECT 1 FROM audit_log WHERE action = ${EXPENSE_LOGGED_ACTION}) AS exists
  `);
  return [...rows][0]?.exists === true;
}

export async function readMinistryRollup(from: string, to: string, db: DB = defaultDb): Promise<MinistryRollup & { from: string; to: string }> {
  const [revenue, cogs, expenses, modes, settled, writer] = await Promise.all([
    readDailyRevenue(from, to, db),
    readDailyCogs(from, to, db),
    readDailyExpenses(from, to, db),
    readDayModes(from, to, db),
    readSettledOrders(from, to, db),
    readExpenseWriterExists(db),
  ]);
  const days: MinistryDay[] = [...cogs.keys()].sort().map((date) => {
    const c = cogs.get(date) ?? EMPTY_PERIOD_COGS;
    return {
      date,
      modes: modes.get(date) ?? [],
      orderCount: c.orderCount,
      revenueZar: revenue.get(date) ?? 0,
      cogs: c,
      // No payments.fee_zar yet: any settled card order's fee is unrecorded.
      processingFeeZar: (settled.get(date) ?? 0) > 0 ? null : 0,
    };
  });
  const expensesZar = [...expenses.values()].reduce((s, v) => s + v, 0);
  return { from, to, ...ministryRollup({ days, expensesZar, expenseWriterExists: writer }) };
}
