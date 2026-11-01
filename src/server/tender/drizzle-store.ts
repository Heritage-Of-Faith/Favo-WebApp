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
import { auditLog, donorFundEntries, donorFunds, orders, payments } from "@db/schema";
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
        .select({
          id: orders.id,
          state: orders.state,
          totalZar: orders.totalZar,
          clientUuid: orders.clientUuid,
          paymentMode: orders.paymentMode,
        })
        .from(orders)
        .where(eq(orders.id, orderId))
        .for("update");
      if (!o) return null;
      const { paymentMode, ...order } = o;
      return { ...order, fundSettled: paymentMode === "donor_fund" };
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

// ─── AT-203: the same chain, for a blessing-fund card top-up ──────────────────
// PRD v7.0 §6.10.3: "From here the existing sendToTerminal · pollTenderResult ·
// recordTenderResult · resolveTenderByLookup chain runs unchanged." The chain's
// subject (its "order") is the card `top_up` entry in donor_fund_entries:
//   lockOrder(entryId)  → locks the fund row (SELECT … FOR UPDATE, the same lock
//                         drawFromDonorFund takes) and returns the entry as the
//                         subject: amount = the frozen top-up, client_uuid = the
//                         top-up's own (§6.10.3 step 5)
//   payments            → keyed on fund_topup_id instead of order_id
//   audit               → entity_kind 'donor_fund_topup' where the chain says 'order'
// payments.status is still written only by setPaymentStatus, called only by
// recordTenderResult and resolveTenderByLookup (§10.2.1).

function toTopupPayment(r: PaymentRow): TenderPayment {
  if (r.fundTopupId === null) throw new Error(`tender: payment ${r.id} is not a fund top-up`);
  return toTenderPayment({ ...r, orderId: r.fundTopupId });
}

function makeFundTopupTx(tx: DB): TenderTx {
  const base = makeTx(tx);
  return {
    ...base,
    async lockOrder(entryId) {
      const [e] = await tx
        .select({
          id: donorFundEntries.id,
          fundId: donorFundEntries.fundId,
          kind: donorFundEntries.kind,
          fundingMethod: donorFundEntries.fundingMethod,
          amountZar: donorFundEntries.amountZar,
          clientUuid: donorFundEntries.clientUuid,
        })
        .from(donorFundEntries)
        .where(eq(donorFundEntries.id, entryId));
      if (!e || e.kind !== "top_up" || e.fundingMethod !== "card" || e.clientUuid === null) return null;
      await tx.select({ id: donorFunds.id }).from(donorFunds).where(eq(donorFunds.id, e.fundId)).for("update");
      return { id: e.id, state: "ordered", totalZar: e.amountZar, clientUuid: e.clientUuid };
    },
    async listPayments(entryId) {
      const rows = await tx.select().from(payments).where(eq(payments.fundTopupId, entryId)).orderBy(payments.attempt);
      return rows.map(toTopupPayment);
    },
    async lockPayment(entryId, attempt) {
      const [r] = await tx
        .select()
        .from(payments)
        .where(and(eq(payments.fundTopupId, entryId), eq(payments.attempt, attempt)))
        .for("update");
      return r ? toTopupPayment(r) : null;
    },
    async insertPayment(row) {
      const [r] = await tx
        .insert(payments)
        .values({
          fundTopupId: row.orderId,
          attempt: row.attempt,
          clientReference: row.clientReference,
          webposDeviceId: row.webposDeviceId,
          amountZar: row.amountZar,
          status: "pending",
          at: row.at,
        })
        .returning();
      return toTopupPayment(r);
    },
    async audit(row) {
      await writeAudit({ ...row, entityKind: row.entityKind === "order" ? "donor_fund_topup" : row.entityKind }, tx);
    },
  };
}

/** The tender chain's store for fund top-ups. Pass a transaction to nest (savepoints). */
export function createDrizzleFundTopupStore(db: DB): TenderStore {
  return {
    transaction: (fn) => db.transaction((tx) => fn(makeFundTopupTx(tx as unknown as DB))),
  };
}
