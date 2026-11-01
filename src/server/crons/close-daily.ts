// Daily close reconciliation — task G10
// Scheduled 00:05 SAST for the completed day (src/server/jobs/registry.ts). Compares order revenue vs confirmed payments
// for the day. Idempotent per revenue day (AT-193, PRD §9.6.2 job 2): the close
// record is the `daily_close` audit row — there is no `daily_closes` table yet
// (deferred, build-plan §5) — and a second close of a closed day writes nothing.
// Pushes an alert to admin staff devices on T01 variance band
// breach (L09) — this used to page Discord; deletion pass replaced it with
// Web Push (see docs on the deletion PR) so the alert doesn't vanish.
// Docs: API.md · BUSINESS_RULES.md L09 T01

import { and, eq, inArray, isNotNull, ne, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { cancelledWithSuccessfulPayment } from "@/server/reports/revenue-scope";
import type { DB } from "@/lib/db";
import { auditLog, orders, staff } from "@db/schema";
import { writeAudit } from "@/server/audit";
import { formatZarField } from "@/lib/format";
import webpush from "web-push";
import { initVapid } from "@/server/push/vapid";
import { isValidPushSubscription } from "@/server/push/payload";
import type { PushSubscriptionShape } from "@/server/push/payload";

/** Send a Web Push alert to a single admin staff subscription. */
async function sendAdminAlertPush(
  subscription: PushSubscriptionShape,
  payload: string
): Promise<boolean> {
  initVapid();
  try {
    await webpush.sendNotification(subscription, payload);
    return true;
  } catch (err) {
    const statusCode = (err as { statusCode?: number }).statusCode;
    return statusCode !== 404 && statusCode !== 410;
  }
}

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

export type CloseDailyResult =
  | {
      date: string;
      alreadyClosed: false;
      wasCatchUp: boolean;
      revenueZar: number;
      paymentsZar: number;
      variancePct: number;
      band: VarianceBand;
    }
  | { date: string; alreadyClosed: true };

/** The audit action that is a revenue day's close record (entity_kind 'system', entity_id = the day). */
export const DAILY_CLOSE_ACTION = "daily_close";

/**
 * Which of `dates` (YYYY-MM-DD, SAST) already have a close record. Only rows
 * written since AT-193 count: they carry `revenueDay` and always cover a whole
 * completed day. An older `daily_close` row may be a manual mid-day close of
 * "today", a part-day figure, so it never marks a day as closed.
 */
export async function closedDays(dates: string[], client: DB = db): Promise<Set<string>> {
  if (dates.length === 0) return new Set();
  const rows = await client
    .select({ day: auditLog.entityId })
    .from(auditLog)
    .where(
      and(
        eq(auditLog.entityKind, "system"),
        eq(auditLog.action, DAILY_CLOSE_ACTION),
        inArray(auditLog.entityId, dates),
        sql`(${auditLog.after} ->> 'revenueDay') IS NOT NULL`
      )
    );
  return new Set(rows.map((r) => r.day));
}

/**
 * Reconcile collected order totals against confirmed payment amounts for the
 * given SAST day. Returns the reconciliation result and sends a Web Push to admin staff when
 * variance exceeds the T01 "ok" threshold (>= 5%).
 *
 * Only a completed day can be closed: closing today early would make the real
 * 00:05 close a no-op. A day that is already closed returns `alreadyClosed`
 * and writes nothing — no second audit row, no second alert.
 */
export async function closeDaily(
  referenceDate?: Date,
  opts: { wasCatchUp?: boolean; now?: Date } = {}
): Promise<CloseDailyResult> {
  const { end, date } = dayBounds(referenceDate);
  const wasCatchUp = opts.wasCatchUp ?? false;
  if (end.getTime() >= (opts.now ?? new Date()).getTime()) {
    throw new Error(`Revenue day ${date} is not over yet; closeDaily only closes a completed day.`);
  }

  const closed = await db.transaction(async (tx) => {
    const txDb = tx as unknown as DB;
    // One close per revenue day: a second close of the same day (a catch-up
    // overlapping the scheduled run, or a second instance) waits here, then
    // finds the first one's close record.
    await txDb.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`daily_close:${date}`}))`);
    if ((await closedDays([date], txDb)).has(date)) return null;

    // Revenue = sum of totalZar for every non-cancelled order of this
    // revenue day, keyed on orders.revenue_day (minted at createOrder, L07 /
    // REQ-039), whatever its state. Owner decision, Nikao 21 Oct (#260): the
    // close no longer depends on an order having reached `collected`, so an
    // order Done at 23:50 and swept at 00:10 is in its own day's close.
    // AT-209 (L02, §11.3 cancelOrder): a cancelled order that holds a
    // successful payment also counts — cancelling does not return money, and
    // the payments query below counts that payment, so without it a paid order
    // cancelled after start would raise a false variance.
    const [revRow] = await txDb
      .select({ total: sql<number>`COALESCE(SUM(${orders.totalZar}), 0)::int` })
      .from(orders)
      .where(and(or(ne(orders.state, "cancelled"), cancelledWithSuccessfulPayment), eq(orders.revenueDay, date)));
    const revenueZar = revRow?.total ?? 0;

    // Payments = sum of amountZar for successful payments on orders of the
    // same revenue day, keyed the same way so the two figures line up.
    const [payRow] = await txDb.execute<{ total: string | null }>(sql`
      SELECT COALESCE(SUM(p.amount_zar), 0)::bigint AS total
      FROM payments p
      JOIN orders o ON p.order_id = o.id
      WHERE p.status = 'successful'
        AND o.revenue_day = ${date}::date
    `);
    const paymentsZar = parseInt(payRow?.total ?? "0", 10) || 0;

    const diffZar = Math.abs(revenueZar - paymentsZar);
    const variancePct = revenueZar > 0 ? (diffZar / revenueZar) * 100 : 0;
    const band = varianceBand(variancePct);

    await writeAudit(
      {
        entityKind: "system",
        entityId: date,
        action: DAILY_CLOSE_ACTION,
        actorRole: "system",
        after: {
          revenueDay: date,
          wasCatchUp,
          revenueZar,
          paymentsZar,
          variancePct: Math.round(variancePct * 100) / 100,
          band,
        },
        reason: wasCatchUp ? `catch-up on startup: closes revenue day ${date}` : undefined,
      },
      txDb
    );

    return { revenueZar, paymentsZar, variancePct, band };
  });
  if (!closed) return { date, alreadyClosed: true };
  const { revenueZar, paymentsZar, variancePct, band } = closed;

  // Only alert on mismatch (L09: "blocks + pages ops on mismatch"). Recipients
  // are admin-tier staff with a saved push subscription — this is an
  // operational money-reconciliation alert, not a barista-facing one.
  if (band !== "ok") {
    const admins = await db
      .select({ id: staff.id, pushSubscription: staff.pushSubscription })
      .from(staff)
      .where(and(eq(staff.role, "admin"), isNotNull(staff.pushSubscription)));

    const payload = JSON.stringify({
      title: `Daily close — ${band.toUpperCase()} mismatch (${date})`,
      body: `Revenue ${formatZarField(revenueZar)} vs payments ${formatZarField(paymentsZar)} — ${variancePct.toFixed(1)}% variance (${band}).`,
      data: { date, revenueZar, paymentsZar, variancePct, band },
    });

    for (const admin of admins) {
      if (admin.pushSubscription && isValidPushSubscription(admin.pushSubscription)) {
        await sendAdminAlertPush(admin.pushSubscription as PushSubscriptionShape, payload);
      }
    }
  }

  return { date, alreadyClosed: false, wasCatchUp, revenueZar, paymentsZar, variancePct, band };
}
