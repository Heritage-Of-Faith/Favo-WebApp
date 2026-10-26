// The open session a voucher is redeemed against — moved verbatim from
// src/server/actions/vouchers.ts (AT-204) so createOrder reuses it. Not a
// "use server" module: nothing here may become a client-callable action.

import { and, count, eq, isNull } from "drizzle-orm";
import { openingSessions, eventWindows, orderItems, voucherRedemptions } from "@db/schema";
import type { DB } from "@/lib/db";
import { revenueDay } from "@/lib/format";
import { forcedCloseAt } from "@/lib/session-mode";

/** Read-only: live (unreversed) voucher redemptions per line of one order — for the order panels' "Voucher m of n". */
export async function liveVoucherCountsByLine(dbc: Pick<DB, "select">, orderId: string): Promise<Map<string, number>> {
  const rows = await dbc
    .select({ orderItemId: voucherRedemptions.orderItemId, n: count() })
    .from(voucherRedemptions)
    .innerJoin(orderItems, eq(voucherRedemptions.orderItemId, orderItems.id))
    .where(and(eq(orderItems.orderId, orderId), isNull(voucherRedemptions.reversedAt)))
    .groupBy(voucherRedemptions.orderItemId);
  return new Map(rows.map((r) => [r.orderItemId, Number(r.n)]));
}

/** The one open session (closed_at IS NULL), locked; null if none or past its end (L07, COL-11). */
export async function lockOpenSession(tx: Pick<DB, "select">, now: Date) {
  const [s] = await tx
    .select({
      id: openingSessions.id, sessionDate: openingSessions.sessionDate, mode: openingSessions.mode,
      voucherKindsActive: openingSessions.voucherKindsActive, eventWindowId: openingSessions.eventWindowId,
      voucherRedemptionsRecorded: openingSessions.voucherRedemptionsRecorded,
    })
    .from(openingSessions)
    .where(isNull(openingSessions.closedAt))
    .for("update");
  if (!s) return null;
  let window: { endsAt: Date } | null = null;
  if (s.eventWindowId) {
    const [w] = await tx
      .select({ endsAt: eventWindows.endsAt })
      .from(eventWindows)
      .where(eq(eventWindows.id, s.eventWindowId));
    window = w ?? null;
  }
  return forcedCloseAt(s, window, revenueDay(now), now) ? null : s;
}
