// AT-205 — REQ-112, REQ-113, REQ-114, REQ-122, REQ-134, REQ-158 · PRD §7.0.2
// DAY + ROLLUP, §6.9.4, §6.10.4, §7.2.
//
// The ministry rollup over revenue days from..to inclusive, built on the ONE
// figure path: the same order_cogs and expenses reads every period figure
// uses (period-cogs.ts) and the shared revenue scope (revenue-scope.ts). It
// adds, per revenue day:
//   • the sessions and, for an event session, its window's payment_posture
//     (snapshotted at open — REQ-044);
//   • gross split by payment_mode — card (yoco | yoco_deferred), fund
//     (donor_fund), free — and written_off_zar. Any other payment_mode,
//     NULL included, throws UnknownPaymentModeError (REQ-134, §10.6). The
//     yoco_deferred part is split by settled_at / written_off_at (REQ-133,
//     §10.3.3) for display; no total reads the split;
//   • processing_fee from payments.fee_zar over successful payments — the
//     day's orders, and fund top-ups by their SAST day (§6.10.4: a top-up's fee
//     flows to processing_fee). Any NULL fee_zar makes it NULL (REQ-108);
//   • outreach_cogs from live voucher_redemptions on started orders (§6.10.5:
//     counted as paper, not as coffee, until in_progress). order_cogs holds
//     one integer per order and no per-line figure, so an order's outreach
//     share is known only when EVERY unit of every line carries a live
//     redemption — then it is the whole order_cogs, rounded once with its
//     order (L1821). Any other vouchered order is counted as unrecorded and
//     the day's outreach_cogs is UNAVAILABLE, never 0.
// And, for the period: Admin-confirmed sweeps (donor_fund_entries kind
// 'sweep', by SAST day) and whether logExpense has ever written.

import { sql } from "drizzle-orm";
import { db as defaultDb, type DB } from "@/lib/db";
import { ministryRollup, type DeferredSplit, type MinistryDay, type MinistryRollup, type MinistrySession } from "@/lib/ministry-rollup";
import { assertPaymentMode } from "@/lib/payment-mode";
import type { PaymentPosture, SessionMode } from "@/lib/session-mode";
import { EMPTY_PERIOD_COGS, readDailyCogs, readDailyExpenses, readDailyOutreach } from "@/server/cogs/period-cogs";
import { revenueOrderScope } from "@/server/reports/revenue-scope";

// PRD L3421's Expenses empty-state wording ("reads COGS only until one is")
// contradicts REQ-114 (UNAVAILABLE, never COGS-only); the expenses screen must not ship it.

/** The audit action logExpense writes; its existence is REQ-114's "writer". */
export const EXPENSE_LOGGED_ACTION = "expense.logged";

async function readDaySessions(from: string, to: string, db: DB): Promise<Map<string, MinistrySession[]>> {
  const rows = await db.execute<{ session_date: string; mode: SessionMode; payment_posture: PaymentPosture | null }>(sql`
    SELECT s.session_date, s.mode, w.payment_posture
    FROM opening_sessions s
    LEFT JOIN event_windows w ON w.id = s.event_window_id
    WHERE s.session_date >= ${from} AND s.session_date <= ${to}
  `);
  const out = new Map<string, MinistrySession[]>();
  for (const r of rows) {
    out.set(r.session_date, [...(out.get(r.session_date) ?? []), { mode: r.mode, paymentPosture: r.payment_posture ?? null }]);
  }
  return out;
}

type Gross = {
  cardGrossZar: number;
  fundGrossZar: number;
  writtenOffZar: number;
  cardOrdersWithoutFavoPayment: number;
  deferred: DeferredSplit;
};

const NO_GROSS: Gross = {
  cardGrossZar: 0,
  fundGrossZar: 0,
  writtenOffZar: 0,
  cardOrdersWithoutFavoPayment: 0,
  deferred: { openZar: 0, settledZar: 0, writtenOffZar: 0 },
};

/**
 * Gross by payment_mode and written_off_zar per revenue day, over the revenue
 * scope. Fails loudly on an unknown mode. Also counts the card-mode orders
 * with a charge, not written off, that hold no successful FAVO payment: sold
 * on the Yoco machine outside FAVO (DEC-21), their fee is not in FAVO.
 */
async function readDailyGross(from: string, to: string, db: DB): Promise<Map<string, Gross>> {
  const rows = await db.execute<{
    revenue_day: string;
    payment_mode: string | null;
    gross_zar: string | number;
    written_off_zar: string | number;
    without_favo_payment: string | number;
    deferred_open_zar?: string | number;
    deferred_settled_zar?: string | number;
    deferred_written_off_zar?: string | number;
  }>(sql`
    SELECT
      TO_CHAR(orders.revenue_day, 'YYYY-MM-DD') AS revenue_day,
      orders.payment_mode,
      SUM(orders.total_zar)::bigint AS gross_zar,
      COALESCE(SUM(orders.total_zar) FILTER (WHERE orders.written_off_at IS NOT NULL), 0)::bigint AS written_off_zar,
      COUNT(*) FILTER (
        WHERE orders.total_zar > 0
          AND orders.written_off_at IS NULL
          AND NOT EXISTS (SELECT 1 FROM payments wp WHERE wp.order_id = orders.id AND wp.status = 'successful')
      )::int AS without_favo_payment,
      -- REQ-133 / §10.3.3: yoco_deferred split by settled_at and written_off_at.
      COALESCE(SUM(orders.total_zar) FILTER (
        WHERE orders.payment_mode = 'yoco_deferred' AND orders.settled_at IS NULL AND orders.written_off_at IS NULL
      ), 0)::bigint AS deferred_open_zar,
      COALESCE(SUM(orders.total_zar) FILTER (
        WHERE orders.payment_mode = 'yoco_deferred' AND orders.settled_at IS NOT NULL AND orders.written_off_at IS NULL
      ), 0)::bigint AS deferred_settled_zar,
      COALESCE(SUM(orders.total_zar) FILTER (
        WHERE orders.payment_mode = 'yoco_deferred' AND orders.written_off_at IS NOT NULL
      ), 0)::bigint AS deferred_written_off_zar
    FROM orders
    WHERE ${revenueOrderScope}
      AND orders.revenue_day >= ${from}::date
      AND orders.revenue_day <= ${to}::date
    GROUP BY 1, 2
  `);
  const out = new Map<string, Gross>();
  for (const r of rows) {
    const mode = assertPaymentMode(r.payment_mode, r.revenue_day);
    const g = out.get(r.revenue_day) ?? { ...NO_GROSS, deferred: { ...NO_GROSS.deferred } };
    const gross = Number(r.gross_zar) || 0;
    if (mode === "yoco" || mode === "yoco_deferred") {
      g.cardGrossZar += gross;
      g.cardOrdersWithoutFavoPayment += Number(r.without_favo_payment) || 0;
    } else if (mode === "donor_fund") g.fundGrossZar += gross;
    if (mode === "yoco_deferred") {
      g.deferred.openZar += Number(r.deferred_open_zar) || 0;
      g.deferred.settledZar += Number(r.deferred_settled_zar) || 0;
      g.deferred.writtenOffZar += Number(r.deferred_written_off_zar) || 0;
    }
    g.writtenOffZar += Number(r.written_off_zar) || 0;
    out.set(r.revenue_day, g);
  }
  return out;
}

/** Σ fee_zar over successful payments per day; NULL when any of them has no fee recorded. */
async function readDailyFees(from: string, to: string, db: DB): Promise<Map<string, number | null>> {
  const rows = await db.execute<{ day: string; fee_zar: string | number; fee_missing: string | number }>(sql`
    SELECT day, SUM(fee_zar)::bigint AS fee_zar, SUM(fee_missing)::bigint AS fee_missing
    FROM (
      SELECT
        TO_CHAR(orders.revenue_day, 'YYYY-MM-DD') AS day,
        COALESCE(p.fee_zar, 0) AS fee_zar,
        CASE WHEN p.fee_zar IS NULL THEN 1 ELSE 0 END AS fee_missing
      FROM orders
      JOIN payments p ON p.order_id = orders.id AND p.status = 'successful'
      WHERE ${revenueOrderScope}
        AND orders.revenue_day >= ${from}::date
        AND orders.revenue_day <= ${to}::date
      UNION ALL
      SELECT
        TO_CHAR((p.at AT TIME ZONE 'Africa/Johannesburg')::date, 'YYYY-MM-DD') AS day,
        COALESCE(p.fee_zar, 0) AS fee_zar,
        CASE WHEN p.fee_zar IS NULL THEN 1 ELSE 0 END AS fee_missing
      FROM payments p
      WHERE p.fund_topup_id IS NOT NULL
        AND p.status = 'successful'
        AND (p.at AT TIME ZONE 'Africa/Johannesburg')::date >= ${from}::date
        AND (p.at AT TIME ZONE 'Africa/Johannesburg')::date <= ${to}::date
    ) fees
    GROUP BY day
  `);
  return new Map([...rows].map((r) => [r.day, Number(r.fee_missing) > 0 ? null : Number(r.fee_zar) || 0]));
}

/** Σ Admin-confirmed sweeps (positive cents) over SAST days from..to. */
async function readSweeps(from: string, to: string, db: DB): Promise<number> {
  const rows = await db.execute<{ swept_zar: string | number | null }>(sql`
    SELECT COALESCE(SUM(-amount_zar), 0)::bigint AS swept_zar
    FROM donor_fund_entries
    WHERE kind = 'sweep'
      AND (at AT TIME ZONE 'Africa/Johannesburg')::date >= ${from}::date
      AND (at AT TIME ZONE 'Africa/Johannesburg')::date <= ${to}::date
  `);
  return Number([...rows][0]?.swept_zar) || 0;
}

async function readExpenseWriterExists(db: DB): Promise<boolean> {
  const rows = await db.execute<{ exists: boolean }>(sql`
    SELECT EXISTS (SELECT 1 FROM audit_log WHERE action = ${EXPENSE_LOGGED_ACTION}) AS exists
  `);
  return [...rows][0]?.exists === true;
}

export async function readMinistryRollup(from: string, to: string, db: DB = defaultDb): Promise<MinistryRollup & { from: string; to: string }> {
  const [gross, cogs, expenses, sessions, fees, outreach, sweepsZar, writer] = await Promise.all([
    readDailyGross(from, to, db),
    readDailyCogs(from, to, db),
    readDailyExpenses(from, to, db),
    readDaySessions(from, to, db),
    readDailyFees(from, to, db),
    readDailyOutreach(from, to, db),
    readSweeps(from, to, db),
    readExpenseWriterExists(db),
  ]);
  // Every day that holds a counted order, revenue or a fee — never only the COGS days.
  const dates = [...new Set([...cogs.keys(), ...gross.keys(), ...fees.keys()])].sort();
  const days: MinistryDay[] = dates.map((date) => {
    const c = cogs.get(date) ?? EMPTY_PERIOD_COGS;
    const g = gross.get(date) ?? NO_GROSS;
    const o = outreach.get(date) ?? { cogsZar: 0, unrecordedOrders: 0, absentCostOrders: 0 };
    return {
      date,
      sessions: sessions.get(date) ?? [],
      orderCount: c.orderCount,
      cardGrossZar: g.cardGrossZar,
      fundGrossZar: g.fundGrossZar,
      writtenOffZar: g.writtenOffZar,
      cogs: c,
      outreachCogsZar: o.unrecordedOrders > 0 || o.absentCostOrders > 0 ? null : o.cogsZar,
      outreachUnrecordedOrders: o.unrecordedOrders,
      outreachAbsentCostOrders: o.absentCostOrders,
      // No successful payment on the day: no FAVO fee. A card sale taken
      // outside FAVO is caught by cardOrdersWithoutFavoPayment, never this 0.
      processingFeeZar: fees.has(date) ? fees.get(date)! : 0,
      cardOrdersWithoutFavoPayment: g.cardOrdersWithoutFavoPayment,
      deferred: g.deferred,
    };
  });
  const expensesZar = [...expenses.values()].reduce((s, v) => s + v, 0);
  return { from, to, ...ministryRollup({ days, expensesZar, expenseWriterExists: writer, sweepsZar }) };
}
