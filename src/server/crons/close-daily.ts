// Daily close reconciliation — task G10
// Scheduled 00:05 SAST for the completed day (src/server/jobs/registry.ts).
// AT-207 / PRD §6.0.5, in this normative order, inside one per-day locked
// transaction: (1) the write-off sweep, first and unconditionally — every
// unpaid order, never a `free` or fund-settled one (src/server/close/write-offs.ts);
// (2) the reconciliation: order revenue vs confirmed payments, written-off
// orders on neither side; (3) the close record — a `daily_closes` row, plus the
// `daily_close` audit row that closedDays() and the 06:00 watch read. A
// mismatch blocks only the daily_closes record. Idempotent per revenue day
// (AT-193, PRD §9.6.2 job 2): a second close of a closed day writes nothing.
// Pushes an alert to admin staff devices on T01 variance band
// breach (L09) — this used to page Discord; deletion pass replaced it with
// Web Push (see docs on the deletion PR) so the alert doesn't vanish.
// Docs: API.md · BUSINESS_RULES.md L09 T01

import { and, eq, inArray, isNotNull, isNull, ne, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { cancelledWithSuccessfulPayment } from "@/server/reports/revenue-scope";
import type { DB } from "@/lib/db";
import { auditLog, orders, staff } from "@db/schema";
import { writeAudit } from "@/server/audit";
import { formatZarField } from "@/lib/format";
import {
  buildWriteOffAlert,
  hasDailyClose,
  recordDailyClose,
  sweepWriteOffs,
  type WrittenOffOrder,
} from "@/server/close/write-offs";
import { alertAdmins } from "@/server/push/admin-alert";
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
      /** AT-207: the day's written-off orders (count, integer cents). */
      writtenOffCount: number;
      writtenOffZar: number;
      reconciliationStatus: "payments_matched" | "blocked";
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
  const now = opts.now ?? new Date();
  if (end.getTime() >= now.getTime()) {
    throw new Error(`Revenue day ${date} is not over yet; closeDaily only closes a completed day.`);
  }

  const closed = await db.transaction(async (tx) => {
    const txDb = tx as unknown as DB;
    // One close per revenue day: a second close of the same day (a catch-up
    // overlapping the scheduled run, or a second instance) waits here, then
    // finds the first one's close record.
    await txDb.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`daily_close:${date}`}))`);
    if ((await closedDays([date], txDb)).has(date)) return null;
    if (await hasDailyClose(txDb, date)) return null;

    // (1) §6.0.5 / REQ-007: settle-or-write-off, first and unconditionally —
    // never gated on the reconciliation below. It only writes off; it never
    // settles and never touches a payment.
    const sweep = await sweepWriteOffs(txDb, date, now);

    // Revenue = sum of totalZar for every non-cancelled order of this
    // revenue day, keyed on orders.revenue_day (minted at createOrder, L07 /
    // REQ-039), whatever its state. Owner decision, Nikao 21 Oct (#260): the
    // close no longer depends on an order having reached `collected`, so an
    // order Done at 23:50 and swept at 00:10 is in its own day's close.
    // AT-209 (L02, §11.3 cancelOrder): a cancelled order that holds a
    // successful payment also counts — cancelling does not return money, and
    // the payments query below counts that payment, so without it a paid order
    // cancelled after start would raise a false variance.
    // AT-203 / L47: an order settled from a blessing fund is paid without a
    // payments row, so it is not card revenue and is left out of this
    // card-versus-payments reconciliation (it would read as a variance).
    const [revRow] = await txDb
      .select({ total: sql<number>`COALESCE(SUM(${orders.totalZar}), 0)::int` })
      .from(orders)
      .where(
        and(
          or(ne(orders.state, "cancelled"), cancelledWithSuccessfulPayment),
          eq(orders.revenueDay, date),
          sql`${orders.paymentMode} IS DISTINCT FROM 'donor_fund'`,
          // AT-207 / §6.0.5, S2a: a written-off order "contributes nothing to
          // either" side — it is its own write-off line, not negative revenue.
          isNull(orders.writtenOffAt)
        )
      );
    const revenueZar = revRow?.total ?? 0;

    // Payments = sum of amountZar for successful payments on orders of the
    // same revenue day, keyed the same way so the two figures line up.
    const [payRow] = await txDb.execute<{ total: string | null }>(sql`
      SELECT COALESCE(SUM(p.amount_zar), 0)::bigint AS total
      FROM payments p
      JOIN orders o ON p.order_id = o.id
      WHERE p.status = 'successful'
        AND o.revenue_day = ${date}::date
        AND o.written_off_at IS NULL
    `);
    const paymentsZar = parseInt(payRow?.total ?? "0", 10) || 0;

    const diffZar = Math.abs(revenueZar - paymentsZar);
    const variancePct = revenueZar > 0 ? (diffZar / revenueZar) * 100 : 0;
    const band = varianceBand(variancePct);

    // (2) REQ-036: a mismatch blocks only the close record. The write-offs
    // above stand; no order, payment or session is touched.
    const reconciliationStatus = band === "ok" ? ("payments_matched" as const) : ("blocked" as const);
    const blockedReason =
      reconciliationStatus === "blocked"
        ? `Revenue ${formatZarField(revenueZar)} vs payments ${formatZarField(paymentsZar)} — ${variancePct.toFixed(1)}% variance (${band}).`
        : null;

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
          writtenOffCount: sweep.dayCount,
          writtenOffZar: sweep.dayZar,
          reconciliationStatus,
        },
        reason: wasCatchUp ? `catch-up on startup: closes revenue day ${date}` : undefined,
      },
      txDb
    );

    // (3) §10.2: the close record.
    await recordDailyClose(txDb, {
      revenueDay: date,
      writtenOffCount: sweep.dayCount,
      writtenOffZar: sweep.dayZar,
      reconciliationStatus,
      blockedReason,
      closedAt: now,
      wasCatchUp,
    });

    return {
      revenueZar,
      paymentsZar,
      variancePct,
      band,
      reconciliationStatus,
      written: sweep.written,
      writtenOffCount: sweep.dayCount,
      writtenOffZar: sweep.dayZar,
    };
  });
  if (!closed) return { date, alreadyClosed: true };
  const { revenueZar, paymentsZar, variancePct, band, reconciliationStatus, written, writtenOffCount, writtenOffZar } =
    closed;

  // §6.0.5 "Admin | 00:05": a push naming the count and value written off and
  // the reason for each. Sent after the commit; never throws (admin-alert.ts).
  if (written.length > 0) await pushWriteOffs(date, written);

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

  return {
    date,
    alreadyClosed: false,
    wasCatchUp,
    revenueZar,
    paymentsZar,
    variancePct,
    band,
    writtenOffCount,
    writtenOffZar,
    reconciliationStatus,
  };
}

async function pushWriteOffs(date: string, written: WrittenOffOrder[]): Promise<void> {
  const { title, body, data } = buildWriteOffAlert(date, written);
  await alertAdmins(title, body, data);
}
