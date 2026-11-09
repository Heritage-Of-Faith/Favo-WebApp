// REQ-145 · REQ-124 — the Vouchers row of §7.3.1's write-down block, per
// barista: a count AND a value, "voucher_cups beside vouchers_zar, so the
// average value per slip is readable without anyone computing it" (§6.9.2a).
//
// Read only. Spec: docs/FAVO_PRD_v7.md §7.0.2 —
//   voucher_cups = COUNT( live voucher_redemptions rows in the period ):
//     reversed rows (COL-29) are excluded; rows on orders that never reached
//     in_progress are excluded too — "counted as paper, not counted as coffee".
//   vouchers_zar = Σ order_items.discount_zar WHERE the line carries a live
//     voucher_redemptions row.
// Per barista, each live row is attributed to voucher_redemptions
// .redeemed_by_staff_id and valued at its own discount_zar (one unit's
// line_unit_price, integer cents, CHECK > 0). Under L41 a vouchered line's
// discount_zar is exactly the sum of its live rows, so the per-barista values
// add up to vouchers_zar. Nothing here rounds.
//
// "Reached in_progress": the order is in_progress | ready | collected (the
// counted states every weekly figure uses), or it was abandoned (abandonOrder
// moves an in_progress / ready order to cancelled and audits action
// 'override' with after.abandoned = true — the drink was made). An order
// cancelled from in_progress by cancelOrder has its stock reversed by
// compensating rows, so no coffee was consumed and it is not counted.
// Bucketed by the order's revenue_day (L07), as every write-down is.

import { sql } from "drizzle-orm";
import type { DB } from "@/lib/db";
import { summarisePerBarista, type BaristaWriteDowns, type CountAndZar, type StaffRef, type WriteDownRow } from "@/server/write-downs/summary";

export type VoucherTally = { staffId: string; staffName: string | null; count: number; zar: number };

/** §7.3.1 per-barista line: the three AT-209 figures plus vouchers (count and value). */
export type BaristaWriteDownLine = BaristaWriteDowns & { vouchers: CountAndZar };

export async function readVoucherTallies(client: Pick<DB, "execute">, from: string, to: string): Promise<VoucherTally[]> {
  const rows = (await client.execute<{ staff_id: string; staff_name: string | null; cups: string | number; zar: string | number }>(sql`
    SELECT vr.redeemed_by_staff_id AS staff_id, s.name AS staff_name,
           COUNT(*)::bigint AS cups, SUM(vr.discount_zar)::bigint AS zar
    FROM voucher_redemptions vr
    JOIN order_items oi ON oi.id = vr.order_item_id
    JOIN orders o ON o.id = oi.order_id
    LEFT JOIN staff s ON s.id = vr.redeemed_by_staff_id
    WHERE vr.reversed_at IS NULL
      AND o.revenue_day BETWEEN ${from}::date AND ${to}::date
      AND (
        o.state IN ('in_progress', 'ready', 'collected')
        OR EXISTS (
          SELECT 1 FROM audit_log a
          WHERE a.entity_kind = 'order' AND a.entity_id = o.id
            AND a.action = 'override' AND (a.after->>'abandoned') = 'true'
        )
      )
    GROUP BY vr.redeemed_by_staff_id, s.name
    ORDER BY vr.redeemed_by_staff_id
  `)) as unknown as Array<{ staff_id: string; staff_name: string | null; cups: string | number; zar: string | number }>;
  return rows.map((r) => ({ staffId: r.staff_id, staffName: r.staff_name, count: Number(r.cups), zar: Number(r.zar) }));
}

/**
 * The per-barista block with vouchers beside the other figures. Every active
 * staff member appears, zero printed as 0 (§7.3.1: "never omitted"); a
 * barista who redeemed vouchers but is no longer active is added, never dropped.
 */
export function perBaristaWithVouchers(
  rows: WriteDownRow[],
  activeStaff: StaffRef[],
  tallies: readonly VoucherTally[]
): BaristaWriteDownLine[] {
  const known = new Set(activeStaff.map((s) => s.id));
  const extra = tallies
    .filter((t) => !known.has(t.staffId))
    .map((t) => ({ id: t.staffId, name: t.staffName ?? t.staffId }));
  const byStaff = new Map(tallies.map((t) => [t.staffId, t]));
  return summarisePerBarista(rows, [...activeStaff, ...extra]).map((b) => {
    const t = byStaff.get(b.staffId);
    return { ...b, vouchers: t ? { count: t.count, zar: t.zar } : { count: 0, zar: 0 } };
  });
}
