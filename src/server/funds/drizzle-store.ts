// AT-203: the Postgres FundStore. Thin by design — every rule lives in
// ./funds.ts; this file only maps FundTx onto SQL.
//
//   lockOrder / lockFund → SELECT … FOR UPDATE (the balance-locking idiom, §6.10.5)
//   listEntries          → the ledger, each card top-up with its payment attempts
//   insertEntry          → INSERT only: donor_fund_entries is append-only (trigger, 0045)
//   insertMember         → the partial unique index refuses a second active fund
//                          (REQ-172); caught inside a savepoint so the caller's
//                          transaction survives to report it
//   topupTenderStore     → the tender chain's fund-top-up store on THIS transaction
//
// This file never writes payments: the tender store does (src/server/tender/).

import { and, asc, count, eq, inArray } from "drizzle-orm";
import type { DB } from "@/lib/db";
import { writeAudit } from "@/server/audit";
import { createDrizzleFundTopupStore } from "@/server/tender/drizzle-store";
import { customers, donorFundEntries, donorFundMembers, donorFunds, orders, payments } from "@db/schema";
import type { DonorFund, FundEntry, FundStore, FundTx } from "./types";

type FundRow = typeof donorFunds.$inferSelect;
type EntryRow = typeof donorFundEntries.$inferSelect;

function toFund(r: FundRow): DonorFund {
  return { id: r.id, code: r.code, displayName: r.displayName, active: r.active, createdByStaffId: r.createdByStaffId, at: r.at };
}

function toEntry(r: EntryRow, topupPayments: FundEntry["topupPayments"] = []): FundEntry {
  return {
    id: r.id,
    fundId: r.fundId,
    kind: r.kind,
    amountZar: r.amountZar,
    orderId: r.orderId,
    fundingMethod: r.fundingMethod,
    reference: r.reference,
    clientUuid: r.clientUuid,
    recordedByStaffId: r.recordedByStaffId,
    reason: r.reason,
    at: r.at,
    topupPayments,
  };
}

/** Postgres unique_violation on the named constraint/index. */
function isUniqueViolation(err: unknown, name: string): boolean {
  const e = err as { code?: string; constraint_name?: string; constraint?: string; cause?: unknown };
  if (e?.code === "23505" && (e.constraint_name === name || e.constraint === name)) return true;
  return e?.cause !== undefined && e.cause !== err ? isUniqueViolation(e.cause, name) : false;
}

function makeTx(tx: DB): FundTx {
  return {
    async lockOrder(orderId) {
      const [o] = await tx
        .select({
          id: orders.id,
          state: orders.state,
          totalZar: orders.totalZar,
          paymentMode: orders.paymentMode,
          customerId: orders.customerId,
          writtenOffAt: orders.writtenOffAt,
        })
        .from(orders)
        .where(eq(orders.id, orderId))
        .for("update");
      if (!o) return null;
      const { writtenOffAt, ...order } = o;
      return { ...order, writtenOff: writtenOffAt !== null };
    },
    async orderAttempts(orderId) {
      return tx
        .select({ status: payments.status, sentAt: payments.sentAt, yocoPaymentId: payments.yocoPaymentId, attempt: payments.attempt })
        .from(payments)
        .where(eq(payments.orderId, orderId))
        .orderBy(payments.attempt);
    },
    async lockFund(fundId) {
      const [f] = await tx.select().from(donorFunds).where(eq(donorFunds.id, fundId)).for("update");
      return f ? toFund(f) : null;
    },
    async listEntries(fundId) {
      const rows = await tx
        .select()
        .from(donorFundEntries)
        .where(eq(donorFundEntries.fundId, fundId))
        .orderBy(asc(donorFundEntries.at), asc(donorFundEntries.id));
      const topupIds = rows.filter((r) => r.kind === "top_up" && r.fundingMethod === "card").map((r) => r.id);
      const pays = topupIds.length
        ? await tx
            .select({
              fundTopupId: payments.fundTopupId,
              status: payments.status,
              sentAt: payments.sentAt,
              yocoPaymentId: payments.yocoPaymentId,
              chargedAmountZar: payments.chargedAmountZar,
            })
            .from(payments)
            .where(inArray(payments.fundTopupId, topupIds))
            .orderBy(payments.attempt)
        : [];
      return rows.map((r) =>
        toEntry(
          r,
          pays
            .filter((p) => p.fundTopupId === r.id)
            .map(({ status, sentAt, yocoPaymentId, chargedAmountZar }) => ({ status, sentAt, yocoPaymentId, chargedAmountZar }))
        )
      );
    },
    async listMembers(fundId) {
      const rows = await tx.select({ customerId: donorFundMembers.customerId }).from(donorFundMembers).where(eq(donorFundMembers.fundId, fundId));
      return rows.map((r) => r.customerId);
    },
    async listActiveFunds() {
      const funds = await tx.select().from(donorFunds).where(eq(donorFunds.active, true)).orderBy(asc(donorFunds.at), asc(donorFunds.id));
      const counts = await tx
        .select({ fundId: donorFundMembers.fundId, n: count() })
        .from(donorFundMembers)
        .where(eq(donorFundMembers.fundActive, true))
        .groupBy(donorFundMembers.fundId);
      const byFund = new Map(counts.map((c) => [c.fundId, Number(c.n)]));
      return funds.map((f) => ({ ...toFund(f), memberCount: byFund.get(f.id) ?? 0 }));
    },
    async linkedFundOf(customerId) {
      const [m] = await tx
        .select({ fundId: donorFundMembers.fundId })
        .from(donorFundMembers)
        .where(and(eq(donorFundMembers.customerId, customerId), eq(donorFundMembers.fundActive, true)))
        .limit(1);
      return m?.fundId ?? null;
    },
    async insertEntry(row) {
      const [r] = await tx.insert(donorFundEntries).values(row).returning();
      return toEntry(r);
    },
    async spendForOrder(orderId) {
      const [r] = await tx
        .select()
        .from(donorFundEntries)
        .where(and(eq(donorFundEntries.orderId, orderId), eq(donorFundEntries.kind, "spend")));
      return r ? toEntry(r) : null;
    },
    async adjustmentForOrder(orderId) {
      const [r] = await tx
        .select()
        .from(donorFundEntries)
        .where(and(eq(donorFundEntries.orderId, orderId), eq(donorFundEntries.kind, "adjustment")));
      return r ? toEntry(r) : null;
    },
    async setOrderFundSettled(orderId) {
      await tx.update(orders).set({ paymentMode: "donor_fund" }).where(eq(orders.id, orderId));
    },
    async codeTaken(code) {
      const rows = await tx.select({ id: donorFunds.id }).from(donorFunds).where(eq(donorFunds.code, code)).limit(1);
      return rows.length > 0;
    },
    async insertFund(row) {
      const [f] = await tx.insert(donorFunds).values(row).returning();
      return toFund(f);
    },
    async customerExists(customerId) {
      const rows = await tx.select({ id: customers.id }).from(customers).where(eq(customers.id, customerId)).limit(1);
      return rows.length > 0;
    },
    async insertMember(fundId, customerId, addedByStaffId, at) {
      try {
        await tx.transaction(async (sp) => {
          await sp.insert(donorFundMembers).values({ fundId, customerId, addedByStaffId, at });
        });
        return "ok";
      } catch (err) {
        if (isUniqueViolation(err, "donor_fund_members_one_active_fund_per_customer")) return "linked_elsewhere";
        if (isUniqueViolation(err, "donor_fund_members_pkey")) return "duplicate";
        throw err;
      }
    },
    async deleteMember(fundId, customerId) {
      const gone = await tx
        .delete(donorFundMembers)
        .where(and(eq(donorFundMembers.fundId, fundId), eq(donorFundMembers.customerId, customerId)))
        .returning({ customerId: donorFundMembers.customerId });
      return gone.length > 0;
    },
    topupTenderStore() {
      return createDrizzleFundTopupStore(tx);
    },
    async audit(row) {
      await writeAudit(row, tx);
    },
  };
}

export function createDrizzleFundStore(db: DB): FundStore {
  return {
    transaction: (fn) => db.transaction((tx) => fn(makeTx(tx as unknown as DB))),
  };
}

/** A FundTx on a transaction the caller already holds (cancelOrder's). */
export function fundTxOn(tx: DB): FundTx {
  return makeTx(tx);
}
