// T10 reads. SELECT only.

// The app_config key of the configured card machine (§10.4). Same string as
// WEBPOS_DEVICE_KEY in src/server/tender/runtime.ts (a test pins them together);
// it is repeated here, not imported, because job 9 (import-watch) reaches this
// file and no scheduled job may import the tender chain (REQ-066, DEC-29).
const WEBPOS_DEVICE_KEY = "webpos_device_id";

import { and, desc, eq, inArray, isNotNull, like, sql } from "drizzle-orm";
import type { DB } from "@/lib/db";
import { appConfig, auditLog, payments } from "@db/schema";
import { WRITE_OFF_ACTION, WRITE_OFF_REASONS } from "@/server/close/write-offs";
import { latestImports, settledCardPaymentsOfDay } from "./read-store";
import {
  YOCO_PAYOUT_ACTION,
  YOCO_PAYOUT_ENTITY,
  YOCO_PAYOUT_VARIANCE_CONFIRMED_ACTION,
  clearedTipCountsByDevice,
  payoutCheck,
  payoutEntityId,
  payoutLine,
  readPayoutConfirmation,
  readPayoutRecord,
  type PayoutConfirmation,
  type PayoutLine,
  type PayoutRecord,
  type SettledCardPayment,
} from "./payout";
import { EXPECTED_FEE_RATE_KEY, feeRateCheck, readExpectedFeeRateBp } from "./fee-anomaly";
import { T10_TIP_CLEARED_ACTION } from "./tip-clear";

/** The single tenant (db/schema.ts tenantId() default). */
const TENANT = "hofmi";
import {
  T10_CONFIRMED_NO_PAYMENT_ACTION,
  writeOffItems,
  type OpenWriteOffInput,
  type T10View,
} from "./t10-view";

/** The newest import summary per revenue day (moved to ./drizzle-store so the tip clear can read it in its transaction). */
export { latestImports };

/** REQ-034: every order still written off whose latest write-off reason is unresolved_at_close. */
export async function openUnresolvedWriteOffs(client: DB): Promise<OpenWriteOffInput[]> {
  const rows = (await client.execute<{ id: string; revenue_day: string; total_zar: number | string }>(sql`
    SELECT o.id, o.revenue_day::text AS revenue_day, o.total_zar
    FROM orders o
    WHERE o.written_off_at IS NOT NULL
      AND (
        SELECT a.reason FROM audit_log a
        WHERE a.entity_kind = 'order' AND a.entity_id = o.id AND a.action = ${WRITE_OFF_ACTION}
        ORDER BY a.at DESC LIMIT 1
      ) = ${WRITE_OFF_REASONS.unresolvedAtClose}
    ORDER BY o.revenue_day, o.placed_at, o.id
  `)) as unknown as Array<{ id: string; revenue_day: string; total_zar: number | string }>;
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const [attempts, confirmations] = await Promise.all([
    client
      .select({ orderId: payments.orderId, yocoPaymentId: payments.yocoPaymentId, clientReference: payments.clientReference })
      .from(payments)
      .where(and(inArray(payments.orderId, ids), isNotNull(payments.sentAt))),
    client
      .select({ orderId: auditLog.entityId })
      .from(auditLog)
      .where(and(eq(auditLog.entityKind, "order"), eq(auditLog.action, T10_CONFIRMED_NO_PAYMENT_ACTION), inArray(auditLog.entityId, ids))),
  ]);
  const confirmed = new Set(confirmations.map((c) => c.orderId));
  return rows.map((r) => {
    const mine = attempts.filter((a) => a.orderId === r.id);
    return {
      orderId: r.id,
      revenueDay: String(r.revenue_day),
      totalZar: Number(r.total_zar),
      yocoPaymentIds: mine.flatMap((a) => (a.yocoPaymentId ? [a.yocoPaymentId] : [])),
      clientReferences: mine.map((a) => a.clientReference),
      confirmedNoPayment: confirmed.has(r.id),
    };
  });
}

/**
 * §10.4 keys T10 reads at the point of use. A key with no row is undefined
 * (expected_fee_rate_bp absent → the §10.4 default 265, in ./fee-anomaly.ts).
 */
export async function readT10Config(client: DB): Promise<{ webposDeviceId: string | null; expectedFeeRate: unknown }> {
  const rows = await client
    .select({ key: appConfig.key, value: appConfig.value })
    .from(appConfig)
    .where(and(eq(appConfig.tenantId, TENANT), inArray(appConfig.key, [WEBPOS_DEVICE_KEY, EXPECTED_FEE_RATE_KEY])));
  const device = rows.find((r) => r.key === WEBPOS_DEVICE_KEY)?.value;
  const rate = rows.find((r) => r.key === EXPECTED_FEE_RATE_KEY);
  return { webposDeviceId: typeof device === "string" && device !== "" ? device : null, expectedFeeRate: rate ? rate.value : undefined };
}

/** REQ-120: the latest payout entered per device for the day, newest first. */
async function latestPayouts(client: DB, revenueDay: string): Promise<Array<{ record: PayoutRecord; recordedAt: string }>> {
  const rows = await client
    .select({ id: auditLog.entityId, after: auditLog.after, at: auditLog.at })
    .from(auditLog)
    .where(and(eq(auditLog.entityKind, YOCO_PAYOUT_ENTITY), eq(auditLog.action, YOCO_PAYOUT_ACTION), like(auditLog.entityId, `${revenueDay}:%`)))
    .orderBy(desc(auditLog.at));
  const seen = new Set<string>();
  const out: Array<{ record: PayoutRecord; recordedAt: string }> = [];
  for (const r of rows) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    const rec = readPayoutRecord(r.after);
    if (rec && rec.revenueDay === revenueDay) out.push({ record: rec, recordedAt: new Date(r.at).toISOString() });
  }
  return out;
}

/** Payments among `ids` whose tip an Admin has cleared (t10_tip_cleared). IDs only: no tip figure exists. */
async function clearedTips(client: DB, ids: string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  const rows = await client
    .select({ id: auditLog.entityId })
    .from(auditLog)
    .where(and(eq(auditLog.entityKind, "payment"), eq(auditLog.action, T10_TIP_CLEARED_ACTION), inArray(auditLog.entityId, ids)));
  return [...new Set(rows.map((r) => r.id))];
}

/** The latest Admin confirmation per payout entity (day:device) of the day. */
async function latestConfirmations(client: DB, revenueDay: string): Promise<Map<string, PayoutConfirmation>> {
  const rows = await client
    .select({ id: auditLog.entityId, after: auditLog.after, reason: auditLog.reason, at: auditLog.at })
    .from(auditLog)
    .where(
      and(
        eq(auditLog.entityKind, YOCO_PAYOUT_ENTITY),
        eq(auditLog.action, YOCO_PAYOUT_VARIANCE_CONFIRMED_ACTION),
        like(auditLog.entityId, `${revenueDay}:%`)
      )
    )
    .orderBy(desc(auditLog.at));
  const out = new Map<string, PayoutConfirmation>();
  for (const r of rows) {
    if (out.has(r.id)) continue;
    const c = readPayoutConfirmation(r.after, r.reason, new Date(r.at));
    if (c) out.set(r.id, c);
  }
  return out;
}

/**
 * REQ-120: the day's payout lines, plus the day's settled card payments and the
 * payments whose tip was cleared. `tipIds` widens the cleared-tip lookup to the
 * tip rows of the day's import.
 */
export async function readPayoutLines(
  client: DB,
  revenueDay: string,
  tipIds: string[] = []
): Promise<{ lines: PayoutLine[]; settled: SettledCardPayment[]; clearedTipIds: string[] }> {
  const [settled, payouts, confirmations] = await Promise.all([
    settledCardPaymentsOfDay(client, revenueDay),
    latestPayouts(client, revenueDay),
    latestConfirmations(client, revenueDay),
  ]);
  const clearedTipIds = await clearedTips(client, [...new Set([...tipIds, ...settled.map((p) => p.paymentId)])]);
  const counts = clearedTipCountsByDevice(clearedTipIds, settled);
  const lines = payouts.map((p) =>
    payoutLine(
      p.recordedAt,
      payoutCheck(p.record.payoutZar, settled, p.record.deviceId),
      counts.get(p.record.deviceId) ?? 0,
      confirmations.get(payoutEntityId(revenueDay, p.record.deviceId)) ?? null
    )
  );
  return { lines, settled, clearedTipIds };
}

export async function readT10View(client: DB, revenueDay: string): Promise<T10View> {
  const writeOffs = await openUnresolvedWriteOffs(client);
  const imports = await latestImports(client, [...new Set([revenueDay, ...writeOffs.map((w) => w.revenueDay)])]);
  const latestImport = imports.get(revenueDay) ?? null;
  const tipIds = (latestImport?.exceptions ?? []).flatMap((e) => (e.kind === "tip" && e.paymentId ? [e.paymentId] : []));
  const [config, payouts] = await Promise.all([readT10Config(client), readPayoutLines(client, revenueDay, tipIds)]);
  return {
    revenueDay,
    latestImport,
    writeOffs: writeOffItems(writeOffs, imports),
    clearedTipPaymentIds: payouts.clearedTipIds.filter((id) => tipIds.includes(id)),
    payouts: payouts.lines,
    defaultDeviceId: config.webposDeviceId,
    feeRate: feeRateCheck(readExpectedFeeRateBp(config.expectedFeeRate), payouts.settled),
  };
}

