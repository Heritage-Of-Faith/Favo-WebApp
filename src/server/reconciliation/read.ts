// T10 reads. SELECT only.

import { and, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import type { DB } from "@/lib/db";
import { auditLog, payments } from "@db/schema";
import { WRITE_OFF_ACTION, WRITE_OFF_REASONS } from "@/server/close/write-offs";
import { YOCO_IMPORT_ACTION, YOCO_IMPORT_ENTITY, type ImportSummary } from "./import";
import {
  T10_CONFIRMED_NO_PAYMENT_ACTION,
  readImportSummary,
  writeOffItems,
  type OpenWriteOffInput,
  type T10View,
} from "./t10-view";

/** The newest import summary per revenue day, for the given days. */
export async function latestImports(client: DB, days: string[]): Promise<Map<string, ImportSummary>> {
  const out = new Map<string, ImportSummary>();
  if (days.length === 0) return out;
  const rows = await client
    .select({ day: auditLog.entityId, after: auditLog.after })
    .from(auditLog)
    .where(and(eq(auditLog.entityKind, YOCO_IMPORT_ENTITY), eq(auditLog.action, YOCO_IMPORT_ACTION), inArray(auditLog.entityId, days)))
    .orderBy(desc(auditLog.at));
  for (const r of rows) {
    if (out.has(r.day)) continue;
    const s = readImportSummary(r.after);
    if (s) out.set(r.day, s);
  }
  return out;
}

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

export async function readT10View(client: DB, revenueDay: string): Promise<T10View> {
  const writeOffs = await openUnresolvedWriteOffs(client);
  const imports = await latestImports(client, [...new Set([revenueDay, ...writeOffs.map((w) => w.revenueDay)])]);
  return {
    revenueDay,
    latestImport: imports.get(revenueDay) ?? null,
    writeOffs: writeOffItems(writeOffs, imports),
  };
}
