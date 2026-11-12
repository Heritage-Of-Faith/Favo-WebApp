// §7.0.4: "`config.expected_fee_rate_bp` … is used only to flag anomalies —
// never to compute a figure. The realised rate is computed only on days with at
// least ten card transactions and reported as not applicable otherwise, because
// every weekday is otherwise 0 ÷ 0. The band is ±15 bp, set provisionally and
// re-derived from the first month's actual figures".
//
// Pure. It reads the day's actual fees and flags; it never writes, estimates or
// replaces a fee. The comparison is integer arithmetic on cents and basis
// points; the realised rate is shown to a tenth of a basis point, for reading.
// An absent app_config row means the §10.4 default, 265 bp.

import type { SettledCardPayment } from "./payout";

export const EXPECTED_FEE_RATE_KEY = "expected_fee_rate_bp";
/** §10.4: expected_fee_rate_bp's default, "observed 2026-08-16" (§7.0.4). */
export const DEFAULT_EXPECTED_FEE_RATE_BP = 265;
export const MIN_CARD_TXNS_FOR_RATE = 10;
export const FEE_RATE_BAND_BP = 15;

export type ExpectedFeeRate = { state: "invalid" } | { state: "configured"; bp: number };

/**
 * The app_config jsonb value (undefined when no row exists). Same rule as
 * readFundConfig: absent → the PRD default; present but not a whole number of
 * basis points above zero → invalid, named on T10, never guessed.
 */
export function readExpectedFeeRateBp(value: unknown): ExpectedFeeRate {
  if (value === undefined) return { state: "configured", bp: DEFAULT_EXPECTED_FEE_RATE_BP };
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? { state: "configured", bp: value } : { state: "invalid" };
}

export type FeeRateCheck =
  | { state: "invalid_config" }
  | { state: "not_applicable"; count: number }
  | { state: "unavailable"; missingFee: number; missingCharged: number; count: number }
  | {
      state: "within_band" | "anomaly";
      expectedBp: number;
      /** Realised rate in tenths of a basis point (2649 = 264.9 bp). Display only. */
      realisedTenthsBp: number;
      count: number;
      grossZar: number;
      feeZar: number;
    };

export function feeRateCheck(expected: ExpectedFeeRate, payments: SettledCardPayment[]): FeeRateCheck {
  if (expected.state === "invalid") return { state: "invalid_config" };
  const count = payments.length;
  if (count < MIN_CARD_TXNS_FOR_RATE) return { state: "not_applicable", count };
  const missingFee = payments.filter((p) => p.feeZar === null).length;
  const missingCharged = payments.filter((p) => p.chargedAmountZar === null).length;
  if (missingFee > 0 || missingCharged > 0) return { state: "unavailable", missingFee, missingCharged, count };
  const grossZar = payments.reduce((n, p) => n + (p.chargedAmountZar as number), 0);
  const feeZar = payments.reduce((n, p) => n + (p.feeZar as number), 0);
  if (grossZar <= 0) return { state: "not_applicable", count };
  // |fee/gross − expected/10000| > band/10000  ⇔  |fee·10000 − expected·gross| > band·gross
  const outside = Math.abs(feeZar * 10_000 - expected.bp * grossZar) > FEE_RATE_BAND_BP * grossZar;
  return {
    state: outside ? "anomaly" : "within_band",
    expectedBp: expected.bp,
    realisedTenthsBp: Math.round((feeZar * 100_000) / grossZar),
    count,
    grossZar,
    feeZar,
  };
}
