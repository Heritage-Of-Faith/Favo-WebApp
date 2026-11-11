// §11.2 importYocoTransactions — "idempotent on (revenue_day, yoco payment id)
// … writes an audit_log row with actor_kind='system'. It never writes
// payments.status." In-memory store; no DB, no Yoco.

import { describe, it, expect, vi } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import {
  importYocoTransactions,
  PAYMENT_ANNOTATED_ACTION,
  YOCO_IMPORT_ACTION,
  YOCO_IMPORT_REFUSED_ACTION,
  type ImportStore,
  type ImportTx,
} from "@/server/reconciliation/import";
import type { FavoPayment } from "@/server/reconciliation/t10";
import type { AuditInput } from "@/server/audit";

const DAY = "2026-08-16";
const NOW = new Date("2026-08-17T07:00:00.000Z");
const ROOT = resolve(__dirname, "../../../..");
const FIXTURE = readFileSync(resolve(ROOT, "tests/fixtures/yoco/sunday-2026-08-16.csv"), "utf8");
const MENU = ["Americano", "Cappuccino", "Mocha", "Hot Chocolate"];

function grounded(): FavoPayment[] {
  return [...FIXTURE.matchAll(/yp_20260816_(\d+),\d+,[^,]*?(?:"[^"]*")?,?R(\d+)\.(\d\d)/g)]
    .filter((m) => m[1] !== "2646")
    .map((m) => {
      const cents = Number(m[2]) * 100 + Number(m[3]);
      return {
        id: `p${m[1]}`, orderId: `o${m[1]}`, fundTopupId: null, attempt: 1, clientReference: `cu${m[1]}:1`,
        yocoPaymentId: `yp_20260816_${m[1]}`, status: "successful", amountZar: cents, chargedAmountZar: cents,
        feeZar: null, receiptNo: null, orderWrittenOff: false,
      };
    });
}

class MemoryImportStore implements ImportStore {
  audits: AuditInput[] = [];
  annotate = vi.fn<ImportTx["annotatePayment"]>();
  constructor(public payments: FavoPayment[]) {
    this.annotate.mockImplementation(async (id, patch) => {
      const p = this.payments.find((x) => x.id === id);
      if (!p) return false;
      let changed = false;
      if (patch.feeZar !== undefined && p.feeZar === null) { p.feeZar = patch.feeZar; changed = true; }
      if (patch.receiptNo !== undefined && p.receiptNo === null) { p.receiptNo = patch.receiptNo; changed = true; }
      return changed;
    });
  }
  async transaction<T>(fn: (tx: ImportTx) => Promise<T>): Promise<T> {
    const tx: ImportTx = {
      paymentsByKeys: async (ids, refs) =>
        this.payments.filter((p) => (p.yocoPaymentId !== null && ids.includes(p.yocoPaymentId)) || refs.includes(p.clientReference)),
      successfulPaymentsOfDay: async () => this.payments.filter((p) => p.status === "successful"),
      ordersBySettlementRefs: async () => [],
      menuItemNames: async () => MENU,
      annotatePayment: this.annotate,
      audit: async (row) => { this.audits.push(row); },
    };
    return fn(tx);
  }
}

describe("importYocoTransactions", () => {
  it("the grounded day: fees R9.27 written on 13 payments, statuses untouched", async () => {
    const payments = grounded();
    expect(payments).toHaveLength(13);
    const before = payments.map((p) => p.status);
    const store = new MemoryImportStore(payments);
    const r = await importYocoTransactions(store, { revenueDay: DAY, csvText: FIXTURE, uploadedByStaffId: "staff-admin", now: NOW });

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(payments.reduce((n, p) => n + (p.feeZar as number), 0)).toBe(927);
    expect(payments.map((p) => p.status)).toEqual(before);
    expect(r.summary).toMatchObject({ matchedRows: 13, unmatchedRows: 0, totalRows: 14, annotatedPayments: 13, yocoGrossZar: 35000, yocoFeeZar: 927 });
    expect(r.summary.info.map((i) => i.kind)).toEqual(["retail"]);
  });

  it("every write is fee_zar / receipt_no only — a spy on the one payments writer", async () => {
    const store = new MemoryImportStore(grounded());
    await importYocoTransactions(store, { revenueDay: DAY, csvText: FIXTURE, uploadedByStaffId: "staff-admin", now: NOW });
    expect(store.annotate).toHaveBeenCalledTimes(13);
    for (const [, patch] of store.annotate.mock.calls) {
      expect(Object.keys(patch).every((k) => k === "feeZar" || k === "receiptNo")).toBe(true);
    }
  });

  it("audits as the system: one row per annotated payment and one import row naming the uploader", async () => {
    const store = new MemoryImportStore(grounded());
    await importYocoTransactions(store, { revenueDay: DAY, csvText: FIXTURE, uploadedByStaffId: "staff-admin", now: NOW });
    expect(store.audits.every((a) => a.actorRole === "system" && a.actorId === undefined)).toBe(true);
    expect(store.audits.filter((a) => a.action === PAYMENT_ANNOTATED_ACTION)).toHaveLength(13);
    const imp = store.audits.filter((a) => a.action === YOCO_IMPORT_ACTION);
    expect(imp).toHaveLength(1);
    expect(imp[0]).toMatchObject({ entityKind: "yoco_import", entityId: DAY, after: { uploadedByStaffId: "staff-admin", revenueDay: DAY } });
  });

  it("no free-text cell reaches audit_log.after: ids and amounts only", async () => {
    const store = new MemoryImportStore(grounded());
    const csv = FIXTURE.replace("Status\n", "Status\n").concat("2026-08-16 09:20:00,yp_bad,9999,Some Odd Thing,NOTMONEY,R0.53,R0.00,R0.00,Successful\n");
    await importYocoTransactions(store, { revenueDay: DAY, csvText: csv, uploadedByStaffId: "staff-admin", now: NOW });
    const stored = JSON.stringify(store.audits.map((a) => a.after));
    for (const text of ["Cappuccino", "Mocha", "250ml Cups", "Hot Chocolate", "Americano", "Some Odd Thing", "NOTMONEY"]) {
      expect(stored).not.toContain(text);
    }
  });

  it("idempotent: the same export again writes no payment and no payment audit", async () => {
    const store = new MemoryImportStore(grounded());
    const input = { revenueDay: DAY, csvText: FIXTURE, uploadedByStaffId: "staff-admin", now: NOW };
    await importYocoTransactions(store, input);
    const snapshot = JSON.stringify(store.payments);
    store.audits = [];
    store.annotate.mockClear();

    const again = await importYocoTransactions(store, input);
    expect(again.ok && again.summary.annotatedPayments).toBe(0);
    expect(again.ok && again.summary.exceptions).toEqual([]);
    expect(store.annotate).not.toHaveBeenCalled();
    expect(JSON.stringify(store.payments)).toBe(snapshot);
    expect(store.audits.map((a) => a.action)).toEqual([YOCO_IMPORT_ACTION]);
  });

  it("a file FAVO cannot read is refused, audited, and touches no payment", async () => {
    const store = new MemoryImportStore(grounded());
    const r = await importYocoTransactions(store, { revenueDay: DAY, csvText: "Payment ID,Amount\nyp_1,20\n", uploadedByStaffId: "staff-admin", now: NOW });
    expect(r).toMatchObject({ ok: false, code: "INVALID_EXPORT" });
    expect(store.annotate).not.toHaveBeenCalled();
    expect(store.audits).toEqual([expect.objectContaining({ action: YOCO_IMPORT_REFUSED_ACTION, entityId: DAY, actorRole: "system" })]);
  });
});

describe("§9.6.2 job 6: the import never writes payments.status (source check)", () => {
  const dir = resolve(ROOT, "src/server/reconciliation");
  const files = [
    ...readdirSync(dir).map((f) => resolve(dir, f)),
    resolve(ROOT, "src/server/actions/reconciliation.ts"),
  ];

  it.each(files)("%s", (file) => {
    const src = readFileSync(file, "utf8");
    expect(src).not.toMatch(/setPaymentStatus|recordTenderResult\(|resolveTenderByLookup\(/);
    expect(src).not.toMatch(/UPDATE\s+payments/i);
    // Every .set({...}) in these files names only fee_zar or receipt_no.
    for (const m of src.matchAll(/\.set\(\{([^}]*)\}\)/g)) {
      const keys = m[1].split(",").map((k) => k.split(":")[0].trim()).filter(Boolean);
      expect(keys.every((k) => k === "feeZar" || k === "receiptNo")).toBe(true);
    }
  });

  it("ImportTx exposes no status writer", () => {
    const src = readFileSync(resolve(dir, "import.ts"), "utf8");
    const iface = /export interface ImportTx \{([\s\S]*?)\n\}/.exec(src)?.[1] ?? "";
    expect(iface).toMatch(/annotatePayment/);
    expect(iface).not.toMatch(/status/i);
  });
});
