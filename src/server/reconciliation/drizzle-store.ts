// The Postgres ImportStore for importYocoTransactions. Thin: every rule lives
// in ./t10.ts and ./import.ts. The ONLY write to `payments` here is
// annotatePayment, and it sets fee_zar / receipt_no where they are NULL —
// never payments.status (§9.6.2 job 6, §10.2.1).

import { and, eq, inArray, isNotNull, isNull, or, sql, type SQL } from "drizzle-orm";
import type { DB } from "@/lib/db";
import { writeAudit } from "@/server/audit";
import { menuItems, orders, payments } from "@db/schema";
import type { ImportStore, ImportTx } from "./import";
import type { FavoPayment } from "./t10";

const PAYMENT_COLUMNS = {
  id: payments.id,
  orderId: payments.orderId,
  fundTopupId: payments.fundTopupId,
  attempt: payments.attempt,
  clientReference: payments.clientReference,
  yocoPaymentId: payments.yocoPaymentId,
  status: payments.status,
  amountZar: payments.amountZar,
  chargedAmountZar: payments.chargedAmountZar,
  feeZar: payments.feeZar,
  receiptNo: payments.receiptNo,
  orderWrittenOff: sql<boolean>`(${orders.writtenOffAt} IS NOT NULL)`,
};

function toFavo(r: Omit<FavoPayment, "orderWrittenOff"> & { orderWrittenOff: unknown }): FavoPayment {
  return { ...r, orderWrittenOff: r.orderWrittenOff === true };
}

function makeTx(tx: DB): ImportTx {
  return {
    async paymentsByKeys(ids, refs) {
      const conds: SQL[] = [];
      if (ids.length > 0) conds.push(inArray(payments.yocoPaymentId, ids));
      if (refs.length > 0) conds.push(inArray(payments.clientReference, refs));
      if (conds.length === 0) return [];
      const rows = await tx
        .select(PAYMENT_COLUMNS)
        .from(payments)
        .leftJoin(orders, eq(orders.id, payments.orderId))
        .where(or(...conds));
      return rows.map(toFavo);
    },
    async successfulPaymentsOfDay(revenueDay) {
      // An order's payment belongs to the order's revenue day; a fund top-up
      // (no order) to the SAST day it was taken.
      const rows = await tx
        .select(PAYMENT_COLUMNS)
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
      return rows.map(toFavo);
    },
    async ordersBySettlementRefs(refs) {
      if (refs.length === 0) return [];
      const rows = await tx
        .select({ orderId: orders.id, settlementRef: orders.settlementRef })
        .from(orders)
        .where(inArray(orders.settlementRef, refs));
      return rows.flatMap((r) => (r.settlementRef === null ? [] : [{ orderId: r.orderId, settlementRef: r.settlementRef }]));
    },
    async menuItemNames() {
      const rows = await tx.select({ name: menuItems.name }).from(menuItems);
      return rows.map((r) => r.name);
    },
    async annotatePayment(paymentId, patch) {
      let changed = false;
      if (patch.feeZar !== undefined) {
        const r = await tx
          .update(payments)
          .set({ feeZar: patch.feeZar })
          .where(and(eq(payments.id, paymentId), isNull(payments.feeZar)))
          .returning({ id: payments.id });
        changed = changed || r.length > 0;
      }
      if (patch.receiptNo !== undefined) {
        const r = await tx
          .update(payments)
          .set({ receiptNo: patch.receiptNo })
          .where(and(eq(payments.id, paymentId), isNull(payments.receiptNo)))
          .returning({ id: payments.id });
        changed = changed || r.length > 0;
      }
      return changed;
    },
    async audit(row) {
      await writeAudit(row, tx);
    },
  };
}

export function createDrizzleImportStore(db: DB): ImportStore {
  return {
    transaction: (fn) => db.transaction((tx) => fn(makeTx(tx as unknown as DB))),
  };
}
