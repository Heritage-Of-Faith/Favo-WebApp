// T10 matching (PRD v7.0 §6.8.3, REQ-019, REQ-032, REQ-033, REQ-034, DEC-17).
// Pure: the plan only. Fixture: the grounded Sunday (see yoco-export.test.ts).

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseYocoExport, type YocoRow } from "@/server/reconciliation/yoco-export";
import { isAllNonMenu, reconcile, type FavoPayment, type ReconcileInput } from "@/server/reconciliation/t10";

const DAY = "2026-08-16";
const MENU = ["Espresso", "Americano", "Cappuccino", "Flat White", "Latte", "Cortado", "Mocha", "Hot Chocolate", "Chai Latte"];
const FIXTURE = readFileSync(resolve(__dirname, "../../../fixtures/yoco/sunday-2026-08-16.csv"), "utf8");

function fixtureRows(): YocoRow[] {
  const r = parseYocoExport(FIXTURE);
  if (!r.ok) throw new Error(r.reason);
  return r.rows;
}

function pay(over: Partial<FavoPayment> & { id: string }): FavoPayment {
  return {
    orderId: `ord-${over.id}`,
    fundTopupId: null,
    attempt: 1,
    clientReference: `cu-${over.id}:1`,
    yocoPaymentId: null,
    status: "successful",
    amountZar: 2000,
    chargedAmountZar: 2000,
    feeZar: null,
    receiptNo: null,
    orderWrittenOff: false,
    ...over,
  };
}

function row(over: Partial<YocoRow> & { yocoPaymentId: string }): YocoRow {
  return {
    line: 2, clientReference: null, amountZar: 2000, feeZar: 53, netZar: null, tipZar: 0,
    revenueDay: DAY, receiptNo: null, items: "Cappuccino (double) x1", status: "successful", ...over,
  };
}

function run(over: Partial<ReconcileInput>) {
  return reconcile({ revenueDay: DAY, rows: [], rejected: [], candidates: [], dayPayments: [], settlementRefs: [], menuNames: MENU, ...over });
}

/** The 13 FAVO card payments of the grounded day, each holding Yoco's id. */
function groundedPayments(rows: YocoRow[]): FavoPayment[] {
  return rows
    .filter((r) => !r.items?.includes("250ml Cups"))
    .map((r) => pay({ id: `p${r.receiptNo}`, yocoPaymentId: r.yocoPaymentId, amountZar: r.amountZar, chargedAmountZar: r.amountZar }));
}

describe("the grounded Sunday reconciles cleanly", () => {
  const rows = fixtureRows();
  const favo = groundedPayments(rows);
  const plan = run({ rows, candidates: favo, dayPayments: favo });

  it("13 matched, the cups line is a named retail line (S7d, REQ-019), nothing unmatched", () => {
    expect(plan.matchedRows).toBe(13);
    expect(plan.unmatchedRows).toBe(0);
    expect(plan.exceptions).toEqual([]);
    expect(plan.info).toEqual([
      { kind: "retail", line: 12, yocoPaymentId: "yp_20260816_2646", amountZar: 0, orderId: null },
    ]);
    expect(JSON.stringify(plan)).not.toContain("250ml Cups");
    expect(plan.missingFromYoco).toEqual([]);
    expect(plan.totalRows).toBe(14);
  });

  it("writes Yoco's own fees: R9.27 across the 13 payments, R0.53 on R20, R1.32 on R50", () => {
    expect(plan.annotations).toHaveLength(13);
    expect(plan.annotations.reduce((n, a) => n + (a.patch.feeZar as number), 0)).toBe(927);
    expect(plan.annotations.find((a) => a.paymentId === "p2638")?.patch).toEqual({ feeZar: 132, receiptNo: "2638" });
    expect(plan.annotations.find((a) => a.paymentId === "p2637")?.patch).toEqual({ feeZar: 53, receiptNo: "2637" });
    expect(plan.yocoGrossZar).toBe(35000);
    expect(plan.yocoFeeZar).toBe(927);
  });

  it("a plan can only carry fee_zar and receipt_no — never a status", () => {
    for (const a of plan.annotations) expect(Object.keys(a.patch).sort()).toEqual(["feeZar", "receiptNo"]);
    expect(JSON.stringify(plan.annotations)).not.toMatch(/"status"/);
  });
});

describe("REQ-033: zero or more than one match is left unmatched, never guessed", () => {
  it("a row matching no FAVO payment is unmatched (Yoco holds it, FAVO does not)", () => {
    const plan = run({ rows: [row({ yocoPaymentId: "yp_x" })] });
    expect(plan.exceptions).toEqual([expect.objectContaining({ kind: "unmatched", yocoPaymentId: "yp_x", amountZar: 2000 })]);
    expect(plan.annotations).toEqual([]);
    expect(plan.unmatchedRows).toBe(1);
  });

  it("id points at one payment and client_reference at another → ambiguous, nothing written", () => {
    const a = pay({ id: "a", yocoPaymentId: "yp_1" });
    const b = pay({ id: "b", clientReference: "ref-b" });
    const plan = run({ rows: [row({ yocoPaymentId: "yp_1", clientReference: "ref-b" })], candidates: [a, b] });
    expect(plan.exceptions.map((e) => e.kind)).toEqual(["ambiguous"]);
    expect(plan.annotations).toEqual([]);
    expect(plan.unmatchedRows).toBe(1);
    expect(plan.matchedRows).toBe(0);
  });

  it("falls back to client_reference when FAVO holds no Yoco id (a timed-out send)", () => {
    const p = pay({ id: "a", clientReference: "cu-a:2", yocoPaymentId: null });
    const plan = run({ rows: [row({ yocoPaymentId: "yp_9", clientReference: "cu-a:2" })], candidates: [p] });
    expect(plan.matchedRows).toBe(1);
    expect(plan.annotations[0]).toMatchObject({ paymentId: "a", patch: { feeZar: 53 } });
  });

  it("client_reference never matches a payment that holds a DIFFERENT Yoco id", () => {
    const p = pay({ id: "a", clientReference: "cu-a:1", yocoPaymentId: "yp_other" });
    const plan = run({ rows: [row({ yocoPaymentId: "yp_9", clientReference: "cu-a:1" })], candidates: [p] });
    expect(plan.exceptions.map((e) => e.kind)).toEqual(["unmatched"]);
  });

  it("two Yoco rows on one FAVO payment: both listed, neither annotated", () => {
    const p = pay({ id: "a", clientReference: "cu-a:1" });
    const plan = run({
      rows: [row({ yocoPaymentId: "yp_1", clientReference: "cu-a:1", line: 2 }), row({ yocoPaymentId: "yp_2", clientReference: "cu-a:1", line: 3 })],
      candidates: [p],
    });
    expect(plan.exceptions.map((e) => e.kind)).toEqual(["two_yoco_rows_one_payment", "two_yoco_rows_one_payment"]);
    expect(plan.annotations).toEqual([]);
  });

  it("the daily unmatched rate: unmatched rows of all rows in the file", () => {
    const rows = fixtureRows();
    const favo = groundedPayments(rows).slice(2); // FAVO lacks two of Yoco's payments
    const plan = run({ rows, candidates: favo, dayPayments: favo, rejected: [{ line: 99, yocoPaymentId: null, reason: "No Yoco payment id." }] });
    expect(plan.unmatchedRows).toBe(2);
    expect(plan.totalRows).toBe(15);
  });

  it("a duplicated id in one file and a row of another day are listed, never matched", () => {
    const p = pay({ id: "a", yocoPaymentId: "yp_1" });
    const plan = run({
      rows: [row({ yocoPaymentId: "yp_1" }), row({ yocoPaymentId: "yp_1", line: 3 }), row({ yocoPaymentId: "yp_2", revenueDay: "2026-08-17", line: 4 })],
      candidates: [p],
    });
    expect(plan.exceptions.map((e) => e.kind)).toEqual(["duplicate_in_file", "duplicate_in_file", "other_day"]);
    expect(plan.annotations).toEqual([]);
  });
});

describe("REQ-032: both directions, at transaction grain", () => {
  it("a successful FAVO payment of the day with no Yoco row is listed as missing from Yoco", () => {
    const held = pay({ id: "a", yocoPaymentId: "yp_held", chargedAmountZar: 2500, amountZar: 2500 });
    const plan = run({ rows: [], dayPayments: [held] });
    expect(plan.missingFromYoco).toEqual([{ paymentId: "a", orderId: "ord-a", fundTopupId: null, yocoPaymentId: "yp_held", amountZar: 2500 }]);
  });
});

describe("variances", () => {
  it("DEC-17: a non-zero tip is listed, never stored, and the fee and receipt are withheld", () => {
    const p = pay({ id: "a", yocoPaymentId: "yp_1" });
    const plan = run({ rows: [row({ yocoPaymentId: "yp_1", tipZar: 500, receiptNo: "2636" })], candidates: [p], dayPayments: [p] });
    expect(plan.exceptions).toEqual([expect.objectContaining({ kind: "tip", paymentId: "a" })]);
    expect(plan.annotations).toEqual([]);
    // The withheld figures ride on the exception for clearTipVariance.
    // CHANGED (review, DEC-17 strictly): the tip amount is stored NOWHERE — not
    // as a field, and not in the detail text that lands on the audit summary.
    expect(plan.exceptions[0].withheld).toEqual({ feeZar: 53, receiptNo: "2636" });
    expect(Object.keys(plan.exceptions[0])).not.toContain("tipZar");
    expect(JSON.stringify(plan.exceptions[0])).not.toContain("500");
  });

  it("a tip row still lists a fee or receipt that disagrees with one FAVO already holds", () => {
    const p = pay({ id: "a", yocoPaymentId: "yp_1", feeZar: 70, receiptNo: "9999" });
    const plan = run({ rows: [row({ yocoPaymentId: "yp_1", tipZar: 500, feeZar: 53, receiptNo: "2636" })], candidates: [p], dayPayments: [p] });
    expect(plan.exceptions.map((e) => e.kind)).toEqual(["tip", "fee_conflict", "receipt_conflict"]);
    expect(plan.annotations).toEqual([]);
  });

  it("a tip row agreeing with what FAVO holds lists only the tip", () => {
    const p = pay({ id: "a", yocoPaymentId: "yp_1", feeZar: 53, receiptNo: "2636" });
    const plan = run({ rows: [row({ yocoPaymentId: "yp_1", tipZar: 500, feeZar: 53, receiptNo: "2636" })], candidates: [p], dayPayments: [p] });
    expect(plan.exceptions.map((e) => e.kind)).toEqual(["tip"]);
    expect(plan.annotations).toEqual([]);
    expect(plan.matchedRows).toBe(1);
    expect(plan.missingFromYoco).toEqual([]);
  });

  it("charged-amount variance: Yoco's amount differs from what FAVO recorded", () => {
    const p = pay({ id: "a", yocoPaymentId: "yp_1", amountZar: 2000, chargedAmountZar: 2000 });
    const plan = run({ rows: [row({ yocoPaymentId: "yp_1", amountZar: 2500 })], candidates: [p] });
    expect(plan.exceptions).toEqual([expect.objectContaining({ kind: "amount_variance", amountZar: 2500 })]);
  });

  it("a fee FAVO already holds is never overwritten: a different one is a conflict", () => {
    const p = pay({ id: "a", yocoPaymentId: "yp_1", feeZar: 50, receiptNo: "R1" });
    const plan = run({ rows: [row({ yocoPaymentId: "yp_1", feeZar: 53, receiptNo: "R2" })], candidates: [p] });
    expect(plan.exceptions.map((e) => e.kind)).toEqual(["fee_conflict", "receipt_conflict"]);
    expect(plan.annotations).toEqual([]);
  });

  it("re-running against what the first run wrote plans nothing (idempotent)", () => {
    const p = pay({ id: "a", yocoPaymentId: "yp_1", feeZar: 53, receiptNo: "2636" });
    const plan = run({ rows: [row({ yocoPaymentId: "yp_1", feeZar: 53, receiptNo: "2636" })], candidates: [p], dayPayments: [p] });
    expect(plan.annotations).toEqual([]);
    expect(plan.exceptions).toEqual([]);
    expect(plan.matchedRows).toBe(1);
  });

  it("a declined Yoco row against a FAVO payment held as paid is listed; a declined row writes nothing", () => {
    const p = pay({ id: "a", yocoPaymentId: "yp_1" });
    const plan = run({ rows: [row({ yocoPaymentId: "yp_1", status: "failed", feeZar: 0 })], candidates: [p] });
    expect(plan.exceptions.map((e) => e.kind)).toEqual(["status_disagrees"]);
    expect(plan.annotations).toEqual([]);
  });
});

describe("REQ-034: Yoco produces the payment of an unresolved_at_close write-off", () => {
  it("is listed as needs_attach — the import does not attach it, and writes no fee or receipt to it", () => {
    const p = pay({ id: "a", yocoPaymentId: "yp_1", status: "unresolved", chargedAmountZar: null, orderWrittenOff: true });
    const plan = run({ rows: [row({ yocoPaymentId: "yp_1", receiptNo: "R9" })], candidates: [p] });
    expect(plan.exceptions).toEqual([expect.objectContaining({ kind: "needs_attach", paymentId: "a", orderId: "ord-a" })]);
    expect(plan.exceptions[0].detail).toMatch(/Check with Yoco/);
    expect(plan.annotations).toEqual([]);
  });

  it.each(["pending", "declined", "unresolved"])("a %s FAVO payment is never annotated", (status) => {
    const p = pay({ id: "a", yocoPaymentId: "yp_1", status });
    const plan = run({ rows: [row({ yocoPaymentId: "yp_1" })], candidates: [p] });
    expect(plan.annotations).toEqual([]);
    expect(plan.exceptions.map((e) => e.kind)).toEqual(["needs_attach"]);
  });
});

describe("named information lines, never mismatches", () => {
  it("S7d: all items non-menu → retail; any menu item, or no items cell → not retail", () => {
    expect(isAllNonMenu("250ml Cups (25s) x1", MENU)).toBe(true);
    expect(isAllNonMenu("Coffee beans 1kg", MENU)).toBe(true);
    expect(isAllNonMenu("250ml Cups (25s) x1, Mocha x1", MENU)).toBe(false);
    expect(isAllNonMenu("CAPPUCCINO (double)", MENU)).toBe(false);
    expect(isAllNonMenu(null, MENU)).toBe(false);
    expect(isAllNonMenu("  ", MENU)).toBe(false);
    expect(isAllNonMenu("Coffee beans 1kg", [])).toBe(false);
  });

  it("no items column, a blank cell, or no menu names loaded → an unmatched exception, never retail", () => {
    for (const plan of [
      run({ rows: [row({ yocoPaymentId: "yp_b", items: null })] }),
      run({ rows: [row({ yocoPaymentId: "yp_b", items: "" })] }),
      run({ rows: [row({ yocoPaymentId: "yp_b", items: "Coffee beans 1kg" })], menuNames: [] }),
    ]) {
      expect(plan.info).toEqual([]);
      expect(plan.exceptions.map((e) => e.kind)).toEqual(["unmatched"]);
    }
  });

  it("a retail row is not counted as unmatched", () => {
    const plan = run({ rows: [row({ yocoPaymentId: "yp_beans", items: "Coffee beans 1kg", amountZar: 18000 })] });
    expect(plan.info.map((i) => i.kind)).toEqual(["retail"]);
    expect(plan.unmatchedRows).toBe(0);
    expect(plan.exceptions).toEqual([]);
  });

  it("§6.7 path B: a row whose receipt equals an order's settlement_ref is a standalone-machine line", () => {
    const plan = run({
      rows: [row({ yocoPaymentId: "yp_sa", receiptNo: "SLIP-77" })],
      settlementRefs: [{ orderId: "ord-77", settlementRef: "SLIP-77" }],
    });
    expect(plan.info).toEqual([expect.objectContaining({ kind: "standalone_machine", orderId: "ord-77" })]);
    expect(plan.unmatchedRows).toBe(0);
  });
});
