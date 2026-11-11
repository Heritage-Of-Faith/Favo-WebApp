// The admin unpaid-orders list (PRD v7.0 §6.7 "Admin surface", S3a, the §11.2
// row "GET /api/admin/unpaid-orders | admin | Every unpaid order —
// yoco_deferred, plus any yoco order with no successful payment (S3a) — with
// its daily_seq, age and value", REQ-166). One definition of unpaid: the
// close's own (listUnpaidOrders, src/server/close/write-offs.ts), so the list
// and the sweep can never disagree.
//
// daily_seq does not exist yet (§10.3 commissions it; no migration adds it),
// so an order is named by the first 8 characters of its id, as the write-off
// queue and the tender pushes do. Oldest first. Money is integer cents.

import { sql } from "drizzle-orm";
import type { DB } from "@/lib/db";
import { listUnpaidOrders } from "@/server/close/write-offs";

export type UnpaidOrderRow = {
  orderId: string;
  /** Stands in for daily_seq until that column exists. */
  orderRef: string;
  revenueDay: string;
  placedAt: string;
  /** Whole minutes since placed_at. */
  ageMinutes: number;
  /** orders.total_zar, integer cents. */
  valueZar: number;
  paymentMode: string | null;
};

/** Pure: the list's rows, oldest first. */
export function toUnpaidRows(
  facts: ReadonlyArray<{ id: string; placedAt: Date; revenueDay: string; totalZar: number; paymentMode: string | null }>,
  now: Date
): UnpaidOrderRow[] {
  return [...facts]
    .sort((a, b) => a.placedAt.getTime() - b.placedAt.getTime() || a.id.localeCompare(b.id))
    .map((o) => ({
      orderId: o.id,
      orderRef: o.id.slice(0, 8),
      revenueDay: o.revenueDay,
      placedAt: o.placedAt.toISOString(),
      ageMinutes: Math.max(0, Math.floor((now.getTime() - o.placedAt.getTime()) / 60_000)),
      valueZar: o.totalZar,
      paymentMode: o.paymentMode,
    }));
}

export async function readUnpaidOrders(client: DB, now: Date): Promise<UnpaidOrderRow[]> {
  return toUnpaidRows(await listUnpaidOrders(client), now);
}

/**
 * The barista's settle list (T3 "Settling: the unpaid list, oldest first, with
 * the amount"): the revenue day's yoco_deferred orders that are still open —
 * not cancelled, not settled, not written off, no successful payment. A fund
 * draw rewrites payment_mode away from 'yoco_deferred', so a fund-paid order
 * never appears here (and this file stays off the REQ-160 allow-list). Deliberately NOT the close's predicate: under DEC-21 the close never
 * sweeps a Sunday order, but a Sunday deferred order can still be settled.
 */
export async function readOpenDeferredOrders(client: DB, revenueDay: string, now: Date): Promise<UnpaidOrderRow[]> {
  const rows = (await client.execute<{
    id: string; placed_at: string | Date; revenue_day: string; total_zar: number | string; payment_mode: string | null;
  }>(sql`
    SELECT o.id, to_json(o.placed_at) #>> '{}' AS placed_at, o.revenue_day::text AS revenue_day, o.total_zar, o.payment_mode
    FROM orders o
    WHERE o.revenue_day = ${revenueDay}::date
      AND o.payment_mode = 'yoco_deferred'
      AND o.state <> 'cancelled'
      AND o.settled_at IS NULL
      AND o.written_off_at IS NULL
      AND o.total_zar > 0
      AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.order_id = o.id AND p.status = 'successful')
    ORDER BY o.placed_at, o.id
  `)) as unknown as Array<{ id: string; placed_at: string | Date; revenue_day: string; total_zar: number | string; payment_mode: string | null }>;
  return toUnpaidRows(
    rows.map((r) => ({
      id: r.id,
      placedAt: r.placed_at instanceof Date ? r.placed_at : new Date(r.placed_at),
      revenueDay: String(r.revenue_day),
      totalZar: Number(r.total_zar),
      paymentMode: r.payment_mode,
    })),
    now
  );
}
