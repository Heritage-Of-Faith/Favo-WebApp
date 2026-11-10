// REQ-134 · REQ-158 · PRD §7.0.2 DAY (L1772–1822), §10.6, §6.10.5 — the v7
// terms of the pure day rollup: fund_gross_zar, topups_settled, outreach_cogs,
// and the loud failure on an unknown payment_mode. The orders are synthetic
// (the PRD prints no figures for these terms); the R20.00 / R0.53 shape is
// FIXTURE-A's single cappuccino (§7.0.3: order_cogs 1352 for a double).

import { describe, it, expect } from "vitest";
import { rollupDay, type DayOrder } from "@/server/cogs/day-rollup";
import { UnknownPaymentModeError, assertPaymentMode, chargeableMode } from "@/lib/payment-mode";

const CAPPUCCINO_DOUBLE: DayOrder = {
  netChargedZar: 2000,
  paymentMode: "yoco",
  writtenOff: false,
  payment: { feeZar: 53, tipZar: 0 },
  cogs: { cogsZar: 1352, absentItemIds: [], estimated: true },
  lines: [{ quantity: 1, shots: 2 }],
};

describe("REQ-134 — an unknown payment mode fails loudly, never defaults", () => {
  it.each([null, undefined, "cash", "YOCO", ""])("rollupDay throws on %p rather than absorbing the row", (mode) => {
    const bad = { ...CAPPUCCINO_DOUBLE, paymentMode: mode as string | null };
    expect(() => rollupDay([CAPPUCCINO_DOUBLE, bad])).toThrow(UnknownPaymentModeError);
  });

  it("the four enum values are known", () => {
    for (const m of ["yoco", "yoco_deferred", "free", "donor_fund"]) expect(assertPaymentMode(m)).toBe(m);
  });

  it("the error names the value and where it was met", () => {
    expect(() => assertPaymentMode(null, "2026-08-16")).toThrow(/NULL on 2026-08-16/);
    expect(() => assertPaymentMode("cash")).toThrow(/"cash"/);
  });
});

describe("fund_gross_zar — a fund draw is a tender at full price (L47, §6.10.5)", () => {
  it("donor_fund orders are fund_gross_zar, inside gross_zar, and never card_gross_zar or net_settled", () => {
    const fund: DayOrder = { ...CAPPUCCINO_DOUBLE, paymentMode: "donor_fund", payment: null };
    const d = rollupDay([CAPPUCCINO_DOUBLE, fund]);
    expect(d.cardGrossZar).toBe(2000);
    expect(d.fundGrossZar).toBe(2000);
    expect(d.grossZar).toBe(4000);
    expect(d.processingFeeZar).toBe(53);
    expect(d.netSettledZar).toBe(2000 - 53);
    expect(d.contributionZar).toBe(4000 - 2704 - 53);
  });

  it("a free order is neither card nor fund gross", () => {
    const free: DayOrder = { ...CAPPUCCINO_DOUBLE, netChargedZar: 0, paymentMode: "free", payment: null };
    const d = rollupDay([free]);
    expect(d.grossZar).toBe(0);
    expect(d.cogs.cogsZar).toBe(1352);
    expect(d.contributionZar).toBe(-1352);
  });
});

describe("topups_settled — a card top-up reaches the bank, so net_settled carries it (DEF-D)", () => {
  it("net_settled = card_gross + topups_settled − processing_fee; the top-up is not gross", () => {
    const d = rollupDay([CAPPUCCINO_DOUBLE], [{ amountZar: 50000, feeZar: 1325 }]);
    expect(d.grossZar).toBe(2000);
    expect(d.topupsSettledZar).toBe(50000);
    expect(d.processingFeeZar).toBe(53 + 1325);
    expect(d.netSettledZar).toBe(2000 + 50000 - 1378);
  });

  it("a top-up with fee_zar NULL makes the fee-dependent figures UNAVAILABLE (REQ-108)", () => {
    const d = rollupDay([CAPPUCCINO_DOUBLE], [{ amountZar: 50000, feeZar: null }]);
    expect(d.processingFeeZar).toBeNull();
    expect(d.netSettledZar).toBeNull();
    expect(d.contributionZar).toBeNull();
  });
});

describe("REQ-158 — outreach_cogs leaves contribution, cogs_zar prints whole", () => {
  const voucher: DayOrder = { ...CAPPUCCINO_DOUBLE, netChargedZar: 0, paymentMode: "free", payment: null, outreachCogsZar: 1352 };

  it("contribution = collected − (cogs − outreach) − fees", () => {
    const d = rollupDay([CAPPUCCINO_DOUBLE, voucher]);
    expect(d.cogs.cogsZar).toBe(2704);
    expect(d.outreachCogsZar).toBe(1352);
    expect(d.contributionZar).toBe(2000 - (2704 - 1352) - 53);
  });

  it("an order whose voucher line COGS is not recorded makes outreach and contribution UNAVAILABLE, never 0", () => {
    const d = rollupDay([CAPPUCCINO_DOUBLE, { ...voucher, outreachCogsZar: null }]);
    expect(d.outreachCogsZar).toBeNull();
    expect(d.contributionZar).toBeNull();
    expect(d.cogs.cogsZar).toBe(2704);
  });
});

describe("§10.6 / migration 0051 — the mode production now writes", () => {
  it("a chargeable order is written 'yoco' (never NULL); a deferred or fund tender is kept", () => {
    expect(chargeableMode(null)).toBe("yoco");
    expect(chargeableMode("free")).toBe("yoco");
    expect(chargeableMode("yoco")).toBe("yoco");
    expect(chargeableMode("yoco_deferred")).toBe("yoco_deferred");
    expect(chargeableMode("donor_fund")).toBe("donor_fund");
  });

  it("FIXTURE-A's single cappuccino written as production writes it ('yoco') is card gross; written NULL it is refused", () => {
    const written: DayOrder = { ...CAPPUCCINO_DOUBLE, paymentMode: chargeableMode(null) };
    const d = rollupDay([written]);
    expect(d.cardGrossZar).toBe(2000);
    expect(d.contributionZar).toBe(2000 - 1352 - 53);
    expect(() => rollupDay([{ ...written, paymentMode: null }])).toThrow(UnknownPaymentModeError);
  });
});
