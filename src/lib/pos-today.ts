// REQ-128 / REQ-129 / REQ-108 — the fee and net lines of the POS Day summary
// (/pos/today, PRD §7.5), as PRD §7.0.2's DAY block writes them:
//
//   processing_fee = Σ COALESCE(payments.fee_zar, 0)
//                    BUT if ANY settled payment in the period has fee_zar IS NULL,
//                    every fee-dependent figure renders UNAVAILABLE, never a number.
//   net_settled    = card_gross_zar + topups_settled − processing_fee   (DEC-17: no tip term)
//
// Pure and client-safe. Integer cents in, integer cents (or NULL) out — no
// rounding happens here; every input is already an integer sum.

export type FeeInputs = {
  /** Σ orders.total_zar WHERE payment_mode IN ('yoco','yoco_deferred'). */
  cardGrossZar: number;
  /** Σ payments.amount_zar of successful fund top-up payments. */
  topupsSettledZar: number;
  /** Σ payments.fee_zar over the day's successful payments (NULLs skipped by SUM). */
  feeSumZar: number;
  /** How many of those successful payments have fee_zar IS NULL. */
  feeUnknownCount: number;
};

/** NULL = UNAVAILABLE: the fee import has not run ("settles overnight", REQ-129). */
export function feeAndNet(i: FeeInputs): { feeZar: number | null; netSettledZar: number | null } {
  if (i.feeUnknownCount > 0) return { feeZar: null, netSettledZar: null };
  return { feeZar: i.feeSumZar, netSettledZar: i.cardGrossZar + i.topupsSettledZar - i.feeSumZar };
}

/** REQ-129 / §7.5: the words a fee-dependent line reads while the import has not run. */
export const SETTLES_OVERNIGHT = "settles overnight";
