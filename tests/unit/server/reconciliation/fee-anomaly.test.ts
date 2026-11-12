// §7.0.4: "`config.expected_fee_rate_bp` (default 265 basis points, observed
// 2026-08-16) is used only to flag anomalies — never to compute a figure. The
// realised rate is computed only on days with at least ten card transactions
// and reported as not applicable otherwise … The band is ±15 bp".
// Pure: no DB. The check never writes or changes a fee. §10.4: the key's
// default is 265, so an absent app_config row checks against 265.

import { describe, it, expect } from "vitest";
import {
  feeRateCheck,
  readExpectedFeeRateBp,
  DEFAULT_EXPECTED_FEE_RATE_BP,
  FEE_RATE_BAND_BP,
  MIN_CARD_TXNS_FOR_RATE,
} from "@/server/reconciliation/fee-anomaly";
import type { SettledCardPayment } from "@/server/reconciliation/payout";

// The grounded Sunday: 13 transactions, R9.27 on R350.00 (§7.0.4 "a steady 2.649%").
const GROSS = [2000, 2000, 2000, 2000, 2000, 4000, 2000, 4000, 4000, 2000, 2000, 5000, 2000];
const FEES = [53, 53, 53, 53, 53, 106, 53, 106, 106, 53, 53, 132, 53];
const grounded = (): SettledCardPayment[] =>
  GROSS.map((g, i) => ({ paymentId: `p${i}`, deviceId: "dev", chargedAmountZar: g, feeZar: FEES[i] }));

describe("the PRD's literal constants", () => {
  it("ten transactions, ±15 bp, default 265 bp (§10.4)", () => {
    expect(MIN_CARD_TXNS_FOR_RATE).toBe(10);
    expect(FEE_RATE_BAND_BP).toBe(15);
    expect(DEFAULT_EXPECTED_FEE_RATE_BP).toBe(265);
  });
});

describe("reading app_config.expected_fee_rate_bp", () => {
  // CHANGED (review): absent was "not configured, show nothing"; §10.4 gives a
  // default of 265, applied the way readFundConfig applies its defaults.
  it("absent → the PRD default, 265 bp", () => {
    expect(readExpectedFeeRateBp(undefined)).toEqual({ state: "configured", bp: 265 });
  });
  it("a whole number of basis points above zero is used", () => {
    expect(readExpectedFeeRateBp(265)).toEqual({ state: "configured", bp: 265 });
  });
  it("anything else is named as unreadable, never guessed", () => {
    for (const v of [0, -5, 2.65, "265", null, {}]) expect(readExpectedFeeRateBp(v)).toEqual({ state: "invalid" });
  });
});

describe("feeRateCheck", () => {
  // CHANGED (review): "not configured → nothing to show" is gone; no row means 265.
  it("no app_config row → checked against the default 265 bp", () => {
    expect(feeRateCheck(readExpectedFeeRateBp(undefined), grounded())).toMatchObject({ state: "within_band", expectedBp: 265 });
  });

  it("the grounded Sunday at 265 bp: within the band (realised 264.9 bp)", () => {
    expect(feeRateCheck({ state: "configured", bp: 265 }, grounded())).toEqual({
      state: "within_band", expectedBp: 265, realisedTenthsBp: 2649, count: 13, grossZar: 35000, feeZar: 927,
    });
  });

  it("more than 15 bp off → an informational anomaly; the fees themselves are untouched", () => {
    const ps = grounded();
    const before = JSON.stringify(ps);
    expect(feeRateCheck({ state: "configured", bp: 245 }, ps)).toMatchObject({ state: "anomaly", expectedBp: 245, realisedTenthsBp: 2649 });
    expect(feeRateCheck({ state: "configured", bp: 285 }, ps)).toMatchObject({ state: "anomaly" });
    expect(JSON.stringify(ps)).toBe(before);
  });

  it("exactly 15 bp off is still inside the band", () => {
    // 10 × R100 at 280 bp = R28.00 against an expected 265 bp.
    const ps = Array.from({ length: 10 }, (_, i) => ({ paymentId: `q${i}`, deviceId: "dev", chargedAmountZar: 10000, feeZar: 280 }));
    expect(feeRateCheck({ state: "configured", bp: 265 }, ps)).toMatchObject({ state: "within_band" });
    ps[0] = { ...ps[0], feeZar: 281 };
    expect(feeRateCheck({ state: "configured", bp: 265 }, ps)).toMatchObject({ state: "anomaly" });
  });

  it("fewer than ten card transactions → not applicable (never 0 ÷ 0 on a weekday)", () => {
    expect(feeRateCheck({ state: "configured", bp: 265 }, grounded().slice(0, 9))).toEqual({ state: "not_applicable", count: 9 });
    expect(feeRateCheck({ state: "configured", bp: 265 }, [])).toEqual({ state: "not_applicable", count: 0 });
  });

  it("a payment without its fee yet → unavailable, naming the count", () => {
    const ps = grounded();
    ps[2] = { ...ps[2], feeZar: null };
    expect(feeRateCheck({ state: "configured", bp: 265 }, ps)).toEqual({ state: "unavailable", missingFee: 1, missingCharged: 0, count: 13 });
  });

  it("an unreadable config value is reported as such", () => {
    expect(feeRateCheck({ state: "invalid" }, grounded())).toEqual({ state: "invalid_config" });
  });
});
