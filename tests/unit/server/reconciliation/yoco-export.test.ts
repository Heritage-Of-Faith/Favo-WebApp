// §11.2 importYocoTransactions — the parser for Yoco's transaction export.
//
// Fixture tests/fixtures/yoco/sunday-2026-08-16.csv is the PRD's grounded
// Sunday (§7.0.3): 14 Yoco transactions, 13 FAVO orders (#2636–#2649 bar
// #2646, the 250ml Cups retail line at R0.00), 08:05:51–09:16:02.
// PRD literals: gross R350.00 · fees R9.27 · net R340.73 (§7.0.3), and
// "fees of R0.53 on R20 and R1.32 on R50" (§6.8.3, §7.0.4).
// The R40 rows' R1.06 is NOT a PRD literal: it is the remainder that makes the
// 13 fees sum to the PRD's R9.27 (9 × R0.53 + R1.32 + 3 × R1.06 = R9.27).
// Payment ids, receipt numbers and the minute-by-minute times are invented.
// The column layout is UNVERIFIED (see YOCO_EXPORT_COLUMNS).

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  MAX_EXPORT_BYTES,
  YOCO_EXPORT_COLUMNS,
  parseCents,
  parseRevenueDay,
  parseYocoExport,
} from "@/server/reconciliation/yoco-export";

const FIXTURE = readFileSync(resolve(__dirname, "../../../fixtures/yoco/sunday-2026-08-16.csv"), "utf8");

function ok(text: string) {
  const r = parseYocoExport(text);
  if (!r.ok) throw new Error(r.reason);
  return r;
}

describe("the grounded Sunday 2026-08-16 (§7.0.3)", () => {
  const r = ok(FIXTURE);

  it("reads all 14 Yoco transactions, none rejected, all on 2026-08-16", () => {
    expect(r.rows).toHaveLength(14);
    expect(r.rejected).toEqual([]);
    expect(new Set(r.rows.map((x) => x.revenueDay))).toEqual(new Set(["2026-08-16"]));
  });

  it("gross R350.00, fees R9.27, net R340.73 — integer cents", () => {
    expect(r.rows.reduce((n, x) => n + x.amountZar, 0)).toBe(35000);
    expect(r.rows.reduce((n, x) => n + x.feeZar, 0)).toBe(927);
    expect(r.rows.reduce((n, x) => n + (x.netZar as number), 0)).toBe(34073);
  });

  it("R0.53 on R20 and R1.32 on R50 — not a constant rate, read as given", () => {
    for (const x of r.rows.filter((y) => y.amountZar === 2000)) expect(x.feeZar).toBe(53);
    const fifty = r.rows.filter((y) => y.amountZar === 5000);
    expect(fifty).toHaveLength(1);
    expect(fifty[0].feeZar).toBe(132);
  });

  it("13 card transactions carry a fee; the comped cups line is R0.00", () => {
    expect(r.rows.filter((x) => x.feeZar > 0)).toHaveLength(13);
    const cups = r.rows.find((x) => x.items?.includes("250ml Cups"));
    expect(cups).toMatchObject({ amountZar: 0, feeZar: 0, receiptNo: "2646" });
  });

  it("a quoted items cell with a comma stays one cell", () => {
    expect(r.rows.find((x) => x.receiptNo === "2648")?.items).toBe("Cappuccino (double) x1, Cappuccino (single) x1");
  });
});

describe("parseCents — string arithmetic, no float drift", () => {
  it.each([
    ["20", 2000], ["20.00", 2000], ["R20.00", 2000], ["R 1 234.56", 123456], ["1,234.56", 123456],
    ["20,00", 2000], ["0.53", 53], ["1.32", 132], ["R4.35", 435], ["0.29", 29], ["1.13", 113], ["R0.5", 50], ["ZAR 9.27", 927],
  ])("%s → %i cents", (raw, cents) => {
    expect(parseCents(raw)).toEqual({ ok: true, cents });
  });

  it.each(["1,234", "20.555", "abc", "", "1.2.3", "R", "20,5"])("refuses %j rather than guessing", (raw) => {
    expect(parseCents(raw).ok).toBe(false);
  });

  it("negative amounts are refused as negative", () => {
    expect(parseCents("-0.53")).toEqual({ ok: false, reason: "negative" });
    expect(parseCents("(0.53)")).toEqual({ ok: false, reason: "negative" });
    expect(parseCents("R-20.00")).toEqual({ ok: false, reason: "negative" });
  });
});

describe("parseRevenueDay — only unambiguous dates", () => {
  it("ISO without a zone is read as SAST", () => {
    expect(parseRevenueDay("2026-08-16 23:59:59")).toEqual({ ok: true, day: "2026-08-16" });
    expect(parseRevenueDay("2026-08-16")).toEqual({ ok: true, day: "2026-08-16" });
  });
  it("a UTC instant is converted to the SAST day (22:30Z is 00:30 SAST next day)", () => {
    expect(parseRevenueDay("2026-08-15T22:30:00Z")).toEqual({ ok: true, day: "2026-08-16" });
    expect(parseRevenueDay("2026-08-16T08:05:51+02:00")).toEqual({ ok: true, day: "2026-08-16" });
  });
  it("16 Aug 2026 is unambiguous", () => {
    expect(parseRevenueDay("16 Aug 2026 08:05")).toEqual({ ok: true, day: "2026-08-16" });
  });
  it.each(["16/08/2026", "08/16/2026", "03/04/2026", "2026-02-30", "yesterday"])("refuses %j", (raw) => {
    expect(parseRevenueDay(raw).ok).toBe(false);
  });
});

describe("tolerant header mapping (one table, UNVERIFIED)", () => {
  it("headers match case-, space- and punctuation-insensitively", () => {
    const r = ok("PAYMENT_ID, gross amount ,Processing Fee,Created At\nyp_1,R20.00,R0.53,2026-08-16 08:00\n");
    expect(r.rows[0]).toMatchObject({ yocoPaymentId: "yp_1", amountZar: 2000, feeZar: 53, revenueDay: "2026-08-16", tipZar: 0, status: "successful" });
  });

  it("a byte-order mark before the first header is ignored", () => {
    expect(ok("﻿Payment ID,Amount,Fee,Date\r\nyp_1,20,0.53,2026-08-16\r\n").rows[0].yocoPaymentId).toBe("yp_1");
  });

  it("a separate Time column is joined to the Date column", () => {
    const r = ok("Date,Time,Payment ID,Amount,Fee\n2026-08-15,23:59,yp_1,20,0.53\n");
    expect(r.rows[0].revenueDay).toBe("2026-08-15");
  });

  it("two columns that could both be one field refuse the whole file", () => {
    const r = parseYocoExport("Payment ID,Amount,Gross,Fee,Date\nyp_1,20,20,0.53,2026-08-16\n");
    expect(r).toMatchObject({ ok: false });
    if (!r.ok) expect(r.reason).toMatch(/amount/);
  });

  it("a missing required column refuses the file and names it", () => {
    const r = parseYocoExport("Payment ID,Amount,Date\nyp_1,20,2026-08-16\n");
    expect(r).toEqual({ ok: false, reason: "The file has no column FAVO recognises for: fee." });
  });

  it("a free-text Description column is never read as items (S7d needs an explicit items column)", () => {
    expect(YOCO_EXPORT_COLUMNS.items.aliases).not.toContain("description");
    const r = ok("Payment ID,Amount,Fee,Date,Description\nyp_1,20,0.53,2026-08-16,Beans\n");
    expect(r.rows[0].items).toBeNull();
    expect(r.columns).not.toContain("items");
  });

  it("no rejection reason echoes the cell's text", () => {
    const r = ok(
      "Payment ID,Amount,Fee,Date,Status,Type\n" +
        "yp_1,SECRETAMT,0.53,2026-08-16,Successful,Payment\n" +
        "yp_2,20,0.53,SECRETDATE,Successful,Payment\n" +
        "yp_3,20,0.53,2026-08-16,SECRETSTATUS,Payment\n" +
        "yp_4,20,0.53,2026-08-16,Successful,SECRETTYPE\n"
    );
    expect(r.rejected).toHaveLength(4);
    expect(JSON.stringify(r.rejected)).not.toMatch(/SECRET/);
  });

  it("the required set is id, amount, fee and date", () => {
    const required = Object.entries(YOCO_EXPORT_COLUMNS).filter(([, v]) => v.required).map(([k]) => k);
    expect(required.sort()).toEqual(["amount", "date", "fee", "yocoPaymentId"]);
  });

  it("columns it does not know (e.g. a card holder's name) are never read", () => {
    const r = ok("Payment ID,Amount,Fee,Date,Customer Name\nyp_1,20,0.53,2026-08-16,Jane Doe\n");
    expect(JSON.stringify(r)).not.toContain("Jane");
  });

  it("no status column is noted on T10, not silently assumed", () => {
    expect(ok("Payment ID,Amount,Fee,Date\nyp_1,20,0.53,2026-08-16\n").notes.join(" ")).toMatch(/no status column/);
  });
});

describe("malformed rows go to the exception list with a reason", () => {
  const head = "Payment ID,Amount,Fee,Date,Tip,Status,Type\n";

  it.each([
    [",20,0.53,2026-08-16,0,Successful,Payment", /No Yoco payment id/],
    ["yp_1,abc,0.53,2026-08-16,0,Successful,Payment", /Amount/],
    ["yp_1,-20,0.53,2026-08-16,0,Successful,Payment", /Negative amount/],
    ["yp_1,20,,2026-08-16,0,Successful,Payment", /Fee/],
    ["yp_1,20,-0.53,2026-08-16,0,Successful,Payment", /Negative fee/],
    ["yp_1,20,0.53,16/08/2026,0,Successful,Payment", /Date/],
    ["yp_1,20,0.53,2026-08-16,x,Successful,Payment", /Tip/],
    ["yp_1,20,0.53,2026-08-16,0,Mystery,Payment", /Status is not one FAVO recognises/],
    ["yp_1,20,0.53,2026-08-16,0,Successful,Reversal", /not a card payment/],
  ])("%s", (line, reason) => {
    const r = ok(head + line + "\n");
    expect(r.rows).toEqual([]);
    expect(r.rejected).toHaveLength(1);
    expect(r.rejected[0].line).toBe(2);
    expect(r.rejected[0].reason).toMatch(reason);
  });

  it("a declined row may carry no fee", () => {
    const r = ok(head + "yp_1,20,,2026-08-16,0,Declined,Payment\n");
    expect(r.rows[0]).toMatchObject({ status: "failed", feeZar: 0 });
  });

  it("an unclosed quote, an empty file and an oversized file are refused", () => {
    expect(parseYocoExport('Payment ID,Amount\n"yp_1,20\n').ok).toBe(false);
    expect(parseYocoExport("").ok).toBe(false);
    expect(parseYocoExport("x".repeat(MAX_EXPORT_BYTES + 1)).ok).toBe(false);
  });
});
