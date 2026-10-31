// Immediate Admin alert: a web push to every admin with a saved subscription.
// Same recipients and transport as the daily-close mismatch alert
// (src/server/crons/close-daily.ts). Never throws — an alert that fails must
// not break the request that raised it.
//
// The Admin's voucher-slip alert (AT-204, PRD §6.9.2, L43, REQ-156) lives here
// too. §6.9.2: a slip-count mismatch "raises the same Admin push as an L09 stock
// mismatch" — so it goes the way closeDaily's L09 alert goes: Web Push to
// every admin staff row with a saved subscription. Carries both figures.

import webpush from "web-push";
import { and, desc, eq, inArray, isNotNull } from "drizzle-orm";
import { db } from "@/lib/db";
import type { DB } from "@/lib/db";
import { auditLog, staff } from "@db/schema";
import { initVapid } from "@/server/push/vapid";
import { isValidPushSubscription } from "@/server/push/payload";

export async function alertAdmins(title: string, body: string, data: Record<string, unknown> = {}): Promise<void> {
  try {
    const admins = await db
      .select({ pushSubscription: staff.pushSubscription })
      .from(staff)
      .where(and(eq(staff.role, "admin"), isNotNull(staff.pushSubscription)));
    initVapid();
    const payload = JSON.stringify({ title, body, data });
    for (const a of admins) {
      if (!isValidPushSubscription(a.pushSubscription)) continue;
      await webpush.sendNotification(a.pushSubscription, payload).catch(() => {});
    }
  } catch {
    // Swallow: the audit_log row is the durable record of the breach.
  }
}

export type VoucherVariance = {
  sessionId: string;
  sessionDate: string;
  opensAt: string;
  counted: number;
  recorded: number;
};

/** The variance to alert on, or null when the tin matches voucher_redemptions_recorded. */
export function slipVariance(
  s: { id: string; sessionDate: string; opensAt: string; voucherRedemptionsRecorded: number },
  counted: number
): VoucherVariance | null {
  const recorded = s.voucherRedemptionsRecorded;
  return counted === recorded
    ? null
    : { sessionId: s.id, sessionDate: s.sessionDate, opensAt: s.opensAt, counted, recorded };
}

/**
 * True when the session's last recorded count (its latest `close` or
 * `voucher_count` audit row) carried exactly this (counted, recorded) pair —
 * that pair was already alerted, so it is not pushed again. Call it before
 * the new audit row is written.
 */
export async function pairAlreadyRecorded(dbc: Pick<DB, "select">, v: VoucherVariance): Promise<boolean> {
  const [last] = await dbc
    .select({ after: auditLog.after })
    .from(auditLog)
    .where(and(
      eq(auditLog.entityKind, "opening_session"), eq(auditLog.entityId, v.sessionId),
      inArray(auditLog.action, ["close", "voucher_count"]),
    ))
    .orderBy(desc(auditLog.at))
    .limit(1);
  const after = (last?.after ?? null) as { voucherSlipsCounted?: unknown; voucherRedemptionsRecorded?: unknown } | null;
  return after?.voucherSlipsCounted === v.counted && after?.voucherRedemptionsRecorded === v.recorded;
}

export function buildVoucherVariancePayload(v: VoucherVariance): string {
  return JSON.stringify({
    title: `Voucher slips don't match (${v.sessionDate})`,
    body: `Session from ${v.opensAt}: ${v.counted} slips counted, ${v.recorded} vouchers recorded.`,
    data: { sessionId: v.sessionId, counted: v.counted, recorded: v.recorded },
  });
}

/**
 * Fire-and-forget: a push failure never fails the close or the count (L43 —
 * nothing about the paper control may block the close).
 */
export function pushVoucherVariance(v: VoucherVariance): void {
  const payload = buildVoucherVariancePayload(v);
  db.select({ id: staff.id, pushSubscription: staff.pushSubscription })
    .from(staff)
    .where(and(eq(staff.role, "admin"), isNotNull(staff.pushSubscription)))
    .then(async (admins) => {
      for (const admin of admins) {
        if (!isValidPushSubscription(admin.pushSubscription)) continue;
        initVapid();
        await webpush.sendNotification(admin.pushSubscription, payload).catch((err: unknown) =>
          console.error("[push] voucher variance alert failed", { staffId: admin.id }, err)
        );
      }
    })
    .catch((err: unknown) => console.error("[push] failed to fetch admins for voucher variance", err));
}
