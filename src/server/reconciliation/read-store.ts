// T10's SELECT-only store reads. They live apart from drizzle-store.ts (which holds the import's
// two payments writes: fee_zar and receipt_no) so that read.ts, and through it job 9 (import-watch),
// never reaches a file that can write payments (REQ-066, DEC-29, the no-payment-initiation scan).

import { and, desc, eq, inArray, isNotNull, or, sql } from "drizzle-orm";
import type { DB } from "@/lib/db";
import { auditLog, orders, payments } from "@db/schema";
import { YOCO_IMPORT_ACTION, YOCO_IMPORT_ENTITY, type ImportSummary } from "./import";
import { readImportSummary } from "./t10-view";
import type { SettledCardPayment } from "./payout";

/** The newest import summary per revenue day, for the given days. SELECT only. */
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

/**
 * REQ-120 / §7.0.4: the revenue day's successful card payments, every device.
 * SELECT only. Same day rule as successfulPaymentsOfDay: an order's payment
 * belongs to the order's revenue day; a fund top-up to the SAST day it was taken.
 */
export async function settledCardPaymentsOfDay(client: DB, revenueDay: string): Promise<SettledCardPayment[]> {
  return client
    .select({
      paymentId: payments.id,
      deviceId: payments.webposDeviceId,
      chargedAmountZar: payments.chargedAmountZar,
      feeZar: payments.feeZar,
    })
    .from(payments)
    .leftJoin(orders, eq(orders.id, payments.orderId))
    .where(
      and(
        eq(payments.status, "successful"),
        or(
          eq(orders.revenueDay, revenueDay),
          and(isNotNull(payments.fundTopupId), sql`(${payments.at} AT TIME ZONE 'Africa/Johannesburg')::date = ${revenueDay}::date`)
        )
      )
    );
}
