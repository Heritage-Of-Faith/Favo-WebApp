// Daily close reconciliation — task G10
// Fires daily at 23:59 SAST. Compares order revenue vs confirmed payments
// for the day. Pages Discord on T01 variance band breach (L09).
// Docs: API.md · BUSINESS_RULES.md L09 T01

import { and, gte, lt, sql, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { orders } from "@db/schema";
import { writeAudit } from "@/server/audit";
import { pingFavoOps, formatZarField } from "@/server/discord/webhook";

// Africa/Johannesburg = UTC+2 (no DST)
const SAST_OFFSET_MS = 2 * 60 * 60 * 1000;

export type VarianceBand = "ok" | "investigate" | "critical";

/** T01 variance bands */
export function varianceBand(pct: number): VarianceBand {
  if (pct < 5) return "ok";
  if (pct < 10) return "investigate";
  return "critical";
}

/** SAST 00:00:00 and 23:59:59.999 as UTC Date objects for a given reference date. */
export function dayBounds(referenceDate?: Date): { start: Date; end: Date; date: string } {
  const ref = referenceDate ?? new Date();
  const sastMs = ref.getTime() + SAST_OFFSET_MS;
  const sastDay = new Date(sastMs);

  // SAST midnight
  const startSast = new Date(sastMs);
  startSast.setUTCHours(0, 0, 0, 0);
  const start = new Date(startSast.getTime() - SAST_OFFSET_MS);

  // SAST end of day = start + 24h - 1ms
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000 - 1);

  const date = `${sastDay.getUTCFullYear()}-${String(sastDay.getUTCMonth() + 1).padStart(2, "0")}-${String(sastDay.getUTCDate()).padStart(2, "0")}`;

  return { start, end, date };
}

export type CloseDailyResult = {
  date: string;
  revenueZar: number;
  paymentsZar: number;
  variancePct: number;
  band: VarianceBand;
};

/**
 * Reconcile collected order totals against confirmed payment amounts for the
 * given SAST day. Returns the reconciliation result and pings Discord when
 * variance exceeds the T01 "ok" threshold (>= 5%).
 */
export async function closeDaily(referenceDate?: Date): Promise<CloseDailyResult> {
  const { start, end, date } = dayBounds(referenceDate);

  // Revenue = sum of totalZar for orders placed today that reached 'collected'
  const [revRow] = await db
    .select({ total: sql<number>`COALESCE(SUM(${orders.totalZar}), 0)::int` })
    .from(orders)
    .where(
      and(
        inArray(orders.state, ["in_progress", "ready", "collected"]),
        gte(orders.placedAt, start),
        lt(orders.placedAt, end)
      )
    );
  const revenueZar = revRow?.total ?? 0;

  // Payments = sum of amountZar for successful payments on those same orders
  const [payRow] = await db.execute<{ total: string | null }>(sql`
    SELECT COALESCE(SUM(p.amount_zar), 0)::bigint AS total
    FROM payments p
    JOIN orders o ON p.order_id = o.id
    WHERE p.status = 'successful'
      AND o.placed_at >= ${start}
      AND o.placed_at < ${end}
  `);
  const paymentsZar = parseInt(payRow?.total ?? "0", 10) || 0;

  const diffZar = Math.abs(revenueZar - paymentsZar);
  const variancePct = revenueZar > 0 ? (diffZar / revenueZar) * 100 : 0;
  const band = varianceBand(variancePct);

  await writeAudit({
    entityKind: "system",
    entityId: date,
    action: "daily_close",
    actorRole: "system",
    after: { revenueZar, paymentsZar, variancePct: Math.round(variancePct * 100) / 100, band },
  });

  // Only ping Discord on mismatch (L09: "blocks + pages Discord on mismatch")
  if (band !== "ok") {
    const color = band === "critical" ? 0xe74c3c : 0xf39c12;
    await pingFavoOps({
      title: `⚠️ Daily Close — ${band.toUpperCase()} mismatch (${date})`,
      color,
      fields: [
        { name: "Revenue", value: formatZarField(revenueZar), inline: true },
        { name: "Payments", value: formatZarField(paymentsZar), inline: true },
        { name: "Variance", value: `${variancePct.toFixed(1)}%`, inline: true },
        { name: "Band", value: band === "critical" ? "🔴 Critical (>10%)" : "🟠 Investigate (5–10%)", inline: false },
      ],
    });
  }

  return { date, revenueZar, paymentsZar, variancePct, band };
}
