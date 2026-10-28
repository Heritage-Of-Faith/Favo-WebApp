// AT-201 part 2a: the Postgres TenderStore. Thin by design — every rule lives
// in ./tender.ts; this file only maps TenderTx onto SQL.
//
//   lockOrder / lockPayment → SELECT … FOR UPDATE (§6.8.4: beginTender is serialised per order)
//   listPayments            → ORDER BY attempt ASC (one row per attempt, §10.3.3)
//   setPaymentStatus        → the one UPDATE of payments.status in the chain (§10.2.1)
//   audit                   → writeAudit in the SAME transaction as the change it records

import { and, desc, eq } from "drizzle-orm";
import type { DB } from "@/lib/db";
import { writeAudit } from "@/server/audit";
import { auditLog, orders, payments } from "@db/schema";
import type {
  LookupRead,
  PaymentPatch,
  PaymentStatus,
  TenderPayment,
  TenderStore,
  TenderTx,
} from "./types";

const LOOKUP_READS: readonly LookupRead[] = ["successful", "failed", "pending", "not_found", "fetch_error"];

type PaymentRow = typeof payments.$inferSelect;

function toTenderPayment(r: PaymentRow): TenderPayment {
  if (r.orderId === null) {
    // Fund top-ups (fund_topup_id) are beginFundTender's, not this chain's.
    throw new Error(`tender: payment ${r.id} has no order`);
  }
  return {
    id: r.id,
    orderId: r.orderId,
    attempt: r.attempt,
    clientReference: r.clientReference,
    yocoPaymentId: r.yocoPaymentId,
    webposDeviceId: r.webposDeviceId,
    amountZar: r.amountZar,
    chargedAmountZar: r.chargedAmountZar,
    tipZar: r.tipZar,
    status: r.status,
    sentAt: r.sentAt,
    lastCheckedAt: r.lastCheckedAt,
    at: r.at,
  };
}

function makeTx(tx: DB): TenderTx {
  return {
    async lockOrder(orderId) {
      const [o] = await tx
        .select({ id: orders.id, state: orders.state, totalZar: orders.totalZar, clientUuid: orders.clientUuid })
        .from(orders)
        .where(eq(orders.id, orderId))
        .for("update");
      return o ?? null;
    },
    async listPayments(orderId) {
      const rows = await tx.select().from(payments).where(eq(payments.orderId, orderId)).orderBy(payments.attempt);
      return rows.map(toTenderPayment);
    },
    async lockPayment(orderId, attempt) {
      const [r] = await tx
        .select()
        .from(payments)
        .where(and(eq(payments.orderId, orderId), eq(payments.attempt, attempt)))
        .for("update");
      return r ? toTenderPayment(r) : null;
    },
    async insertPayment(row) {
      const [r] = await tx
        .insert(payments)
        .values({
          orderId: row.orderId,
          attempt: row.attempt,
          clientReference: row.clientReference,
          webposDeviceId: row.webposDeviceId,
          amountZar: row.amountZar,
          status: "pending",
          at: row.at,
        })
        .returning();
      return toTenderPayment(r);
    },
    async updatePayment(id, patch: PaymentPatch) {
      if (Object.keys(patch).length === 0) return;
      await tx.update(payments).set(patch).where(eq(payments.id, id));
    },
    async setPaymentStatus(id, status: PaymentStatus, patch: PaymentPatch = {}) {
      await tx.update(payments).set({ ...patch, status }).where(eq(payments.id, id));
    },
    async audit(row) {
      await writeAudit(row, tx);
    },
    async lastLookupRead(paymentId) {
      const [r] = await tx
        .select({ after: auditLog.after })
        .from(auditLog)
        .where(
          and(eq(auditLog.entityKind, "payment"), eq(auditLog.entityId, paymentId), eq(auditLog.action, "payment.lookup"))
        )
        .orderBy(desc(auditLog.at))
        .limit(1);
      const after = r?.after as { read?: unknown; at?: unknown } | null | undefined;
      if (!after || typeof after.at !== "string" || !LOOKUP_READS.includes(after.read as LookupRead)) return null;
      const at = new Date(after.at);
      return Number.isNaN(at.getTime()) ? null : { read: after.read as LookupRead, at };
    },
  };
}

export function createDrizzleTenderStore(db: DB): TenderStore {
  return {
    transaction: (fn) => db.transaction((tx) => fn(makeTx(tx as unknown as DB))),
  };
}
