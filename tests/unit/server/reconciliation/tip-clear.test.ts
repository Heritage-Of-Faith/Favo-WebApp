// DEC-17 / REQ-120: a tip the machine let through is a T10 variance for an
// Admin. The import withholds that payment's fee and receipt; they are written
// only AFTER an Admin has recorded (audit row, actor = the Admin, a reason)
// that the tip variance was reviewed. Even then: fee_zar / receipt_no only,
// only where NULL — never payments.status, and the tip amount is stored
// nowhere (DEC-17). The payment row is locked and the day's import read INSIDE the same
// transaction, so the clear acts on the import as it stands under the lock.
// In-memory store; no DB, no Yoco.

import { describe, it, expect } from "vitest";
import {
  clearTipVariance,
  T10_TIP_CLEARED_ACTION,
  T10_TIP_CLEAR_REFUSED_ACTION,
  type TipClearStore,
  type TipClearTx,
} from "@/server/reconciliation/tip-clear";
import { PAYMENT_ANNOTATED_ACTION, type ImportSummary } from "@/server/reconciliation/import";
import type { T10Exception } from "@/server/reconciliation/t10";
import type { AuditInput } from "@/server/audit";

const DAY = "2026-08-16";
const ADMIN = { actorId: "staff-admin", actorRole: "admin" };

type Pay = { id: string; status: string; feeZar: number | null; receiptNo: string | null };

const TIP: T10Exception = {
  kind: "tip", line: 6, yocoPaymentId: "yp_t", paymentId: "p1", orderId: "o1", amountZar: 2500,
  detail: "A tip came through the machine.", withheld: { feeZar: 66, receiptNo: "2637" },
};

function importOf(exceptions: T10Exception[] = [TIP]): ImportSummary {
  return {
    version: 1, revenueDay: DAY, importedAt: "2026-08-17T07:00:00.000Z", uploadedByStaffId: "staff-admin",
    columns: [], notes: [], totalRows: 1, matchedRows: 1, unmatchedRows: 0, yocoGrossZar: 2500, yocoFeeZar: 66,
    annotatedPayments: 0, exceptions, info: [], missingFromYoco: [], rowKeys: ["yp_t"],
  };
}

class MemoryTipStore implements TipClearStore {
  log: string[] = [];
  audits: AuditInput[] = [];
  patches: Array<Record<string, unknown>> = [];
  constructor(public payments: Pay[], public summary: ImportSummary | null = importOf()) {}
  async transaction<T>(fn: (tx: TipClearTx) => Promise<T>): Promise<T> {
    const tx: TipClearTx = {
      lockPayment: async (id) => { this.log.push(`lock:${id}`); },
      latestImport: async (day) => { this.log.push(`read_import:${day}`); return this.summary; },
      tipAlreadyCleared: async (paymentId) =>
        this.audits.some((a) => a.entityKind === "payment" && a.entityId === paymentId && a.action === T10_TIP_CLEARED_ACTION),
      annotatePayment: async (id, patch) => {
        this.log.push(`annotate:${id}`);
        this.patches.push({ ...patch });
        const p = this.payments.find((x) => x.id === id);
        if (!p) return false;
        let changed = false;
        if (patch.feeZar !== undefined && p.feeZar === null) { p.feeZar = patch.feeZar; changed = true; }
        if (patch.receiptNo !== undefined && p.receiptNo === null) { p.receiptNo = patch.receiptNo; changed = true; }
        return changed;
      },
      audit: async (row) => { this.log.push(`audit:${row.action}`); this.audits.push(row); },
    };
    return fn(tx);
  }
}

const input = (over: Partial<Parameters<typeof clearTipVariance>[1]> = {}) => ({
  paymentId: "p1", revenueDay: DAY, reason: "Customer tipped by mistake; comp offered", actor: ADMIN, ...over,
});

describe("clearTipVariance", () => {
  it("locks the payment, reads the import under the lock, records the Admin's review, THEN writes the withheld fee and receipt", async () => {
    const pay: Pay = { id: "p1", status: "successful", feeZar: null, receiptNo: null };
    const store = new MemoryTipStore([pay]);
    const r = await clearTipVariance(store, input());
    expect(r).toEqual({ ok: true, data: { paymentId: "p1", written: true } });
    expect(store.log).toEqual([
      "lock:p1", `read_import:${DAY}`, `audit:${T10_TIP_CLEARED_ACTION}`, "annotate:p1", `audit:${PAYMENT_ANNOTATED_ACTION}`,
    ]);
    expect(store.audits[0]).toEqual({
      entityKind: "payment",
      entityId: "p1",
      action: "t10_tip_cleared",
      actorId: "staff-admin",
      actorRole: "admin",
      reason: "Customer tipped by mistake; comp offered",
      after: { revenueDay: DAY, yocoPaymentId: "yp_t", line: 6, feeZar: 66, receiptNo: "2637" },
    });
    expect(store.audits[1]).toMatchObject({ entityKind: "payment", entityId: "p1", action: PAYMENT_ANNOTATED_ACTION, actorId: "staff-admin", actorRole: "admin" });
    expect(pay).toEqual({ id: "p1", status: "successful", feeZar: 66, receiptNo: "2637" });
  });

  // CHANGED (review, DEC-17 strictly): no tip figure on the payment OR on any audit row.
  it("the payment write carries only fee_zar / receipt_no; no audit row carries a tip or a status", async () => {
    const store = new MemoryTipStore([{ id: "p1", status: "successful", feeZar: null, receiptNo: null }]);
    await clearTipVariance(store, input());
    expect(store.patches).toEqual([{ feeZar: 66, receiptNo: "2637" }]);
    expect(JSON.stringify(store.audits.map((a) => a.after))).not.toMatch(/tip\w*zar|"status"/i);
  });

  it("a fee already held is not overwritten (only where NULL)", async () => {
    const pay: Pay = { id: "p1", status: "successful", feeZar: 70, receiptNo: "2637" };
    const store = new MemoryTipStore([pay]);
    expect(await clearTipVariance(store, input())).toEqual({ ok: true, data: { paymentId: "p1", written: false } });
    expect(pay.feeZar).toBe(70);
    expect(store.audits.map((a) => a.action)).toEqual([T10_TIP_CLEARED_ACTION]);
  });

  it("no receipt on the Yoco row → only the fee is written", async () => {
    const pay: Pay = { id: "p1", status: "successful", feeZar: null, receiptNo: null };
    const store = new MemoryTipStore([pay], importOf([{ ...TIP, withheld: { feeZar: 66, receiptNo: null } }]));
    await clearTipVariance(store, input());
    expect(pay).toMatchObject({ feeZar: 66, receiptNo: null });
  });

  it("refuses, and audits the refusal, when the day has no tip row for that payment", async () => {
    const pays = (): Pay[] => [{ id: "p1", status: "successful", feeZar: null, receiptNo: null }];
    const noImport = new MemoryTipStore(pays(), null);
    expect(await clearTipVariance(noImport, input())).toMatchObject({ ok: false, code: "NOT_FOUND" });
    const otherPayment = new MemoryTipStore(pays());
    expect(await clearTipVariance(otherPayment, input({ paymentId: "p2" }))).toMatchObject({ ok: false, code: "NOT_FOUND" });
    const notTip = new MemoryTipStore(pays(), importOf([{ ...TIP, kind: "amount_variance" }]));
    expect(await clearTipVariance(notTip, input())).toMatchObject({ ok: false, code: "NOT_FOUND" });
    for (const s of [noImport, otherPayment, notTip]) {
      expect(s.log.filter((l) => l.startsWith("annotate"))).toEqual([]);
      expect(s.audits.map((a) => [a.action, a.reason, a.actorId])).toEqual([
        [T10_TIP_CLEAR_REFUSED_ACTION, "not_a_tip_variance_on_that_day", "staff-admin"],
      ]);
    }
  });

  it("refuses a tip row from an import made before clearing existed (no withheld figures): re-import the day", async () => {
    const { withheld: _drop, ...old } = TIP;
    void _drop;
    const store = new MemoryTipStore([{ id: "p1", status: "successful", feeZar: null, receiptNo: null }], importOf([old]));
    expect(await clearTipVariance(store, input())).toMatchObject({ ok: false, code: "NOT_FOUND" });
    expect(store.audits.map((a) => a.reason)).toEqual(["withheld_figures_not_recorded"]);
    expect(store.log.filter((l) => l.startsWith("annotate"))).toEqual([]);
  });

  it("refuses (audited) a second clearing of the same payment", async () => {
    const store = new MemoryTipStore([{ id: "p1", status: "successful", feeZar: null, receiptNo: null }]);
    await clearTipVariance(store, input());
    expect(await clearTipVariance(store, input())).toMatchObject({ ok: false, code: "ALREADY_CLEARED" });
    expect(store.audits.map((a) => a.action)).toEqual([T10_TIP_CLEARED_ACTION, PAYMENT_ANNOTATED_ACTION, T10_TIP_CLEAR_REFUSED_ACTION]);
    expect(store.audits[2].reason).toBe("already_cleared");
  });

  it("the import is read under the lock: a re-import made before the lock is what the clear sees", async () => {
    const store = new MemoryTipStore([{ id: "p1", status: "successful", feeZar: null, receiptNo: null }], importOf([]));
    store.summary = importOf([{ ...TIP, withheld: { feeZar: 71, receiptNo: "2637" } }]);
    await clearTipVariance(store, input());
    expect(store.patches).toEqual([{ feeZar: 71, receiptNo: "2637" }]);
  });
});
