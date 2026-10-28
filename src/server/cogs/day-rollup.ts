// AT-189 · AT-190 · AT-192 — the DAY block of PRD §7.0.2 (L1772–1803), pure.
// REQ-106 (cogs_zar = Σ order_cogs, never re-rounded), REQ-108 (a NULL fee
// makes every fee-dependent figure UNAVAILABLE), REQ-109 (an absent cost input
// makes cogs, gross margin and contribution UNAVAILABLE), REQ-111
// (contribution = collected − cogs − fees).
//
//   card_gross_zar  = Σ order_net_charged WHERE payment_mode IN ('yoco','yoco_deferred')
//   gross_zar       = card_gross_zar + fund_gross_zar
//   net_settled     = card_gross_zar + topups_settled + Σ tip_zar − processing_fee
//   processing_fee  = Σ fee_zar — UNAVAILABLE if any settled payment's fee is NULL
//   cogs_zar        = Σ order_cogs
//   gross_margin    = gross_zar − cogs_zar
//   written_off_zar = Σ order_net_charged WHERE written off
//   collected_zar   = gross_zar − written_off_zar
//   contribution    = collected_zar − ( cogs_zar − outreach_cogs ) − processing_fee
//
// Not modelled on this branch, and therefore 0 here: fund_gross_zar,
// topups_settled and outreach_cogs (no fund, top-up or voucher tables exist
// yet). Those terms are FIXTURE-B's to certify (§15.1, REQ-118).

import { rollupOrderCogs, type CostRollup, type OrderCogsRow } from "@/lib/cost-state";

export type DayOrder = {
  /** orders.total_zar — order_net_charged. */
  netChargedZar: number;
  paymentMode: "yoco" | "yoco_deferred" | "free" | null;
  writtenOff: boolean;
  /** The order's settled card payment, or null when none (e.g. an R0 order). */
  payment: { feeZar: number | null; tipZar: number } | null;
  cogs: OrderCogsRow;
  /** compDiscountZar: order_items.discount_zar on a line whose comp_reason IS NOT NULL (L33). */
  lines: readonly { quantity: number; shots: number; compDiscountZar?: number }[];
};

export type DayRollup = {
  cardGrossZar: number;
  grossZar: number;
  /** NULL = UNAVAILABLE (REQ-108). */
  processingFeeZar: number | null;
  netSettledZar: number | null;
  cogs: CostRollup;
  /** NULL = UNAVAILABLE (REQ-109). */
  grossMarginZar: number | null;
  writtenOffZar: number;
  collectedZar: number;
  /** NULL = UNAVAILABLE when either cogs or fees are (REQ-108, REQ-109). */
  contributionZar: number | null;
  compsZar: number;
  drinks: number;
  doubleShots: number;
};

export function rollupDay(orders: readonly DayOrder[]): DayRollup {
  let cardGrossZar = 0;
  let writtenOffZar = 0;
  let fee = 0;
  let feeUnknown = false;
  let tips = 0;
  let compsZar = 0;
  let drinks = 0;
  let doubleShots = 0;

  for (const o of orders) {
    if (o.paymentMode === "yoco" || o.paymentMode === "yoco_deferred") cardGrossZar += o.netChargedZar;
    if (o.writtenOff) writtenOffZar += o.netChargedZar;
    if (o.payment) {
      if (o.payment.feeZar === null) feeUnknown = true;
      else fee += o.payment.feeZar;
      tips += o.payment.tipZar;
    }
    for (const l of o.lines) {
      drinks += l.quantity;
      compsZar += l.compDiscountZar ?? 0;
      if (l.shots === 2) doubleShots += l.quantity;
    }
  }

  const grossZar = cardGrossZar; // + fund_gross_zar (not modelled; see header)
  const processingFeeZar = feeUnknown ? null : fee;
  const netSettledZar = processingFeeZar === null ? null : cardGrossZar + tips - processingFeeZar;
  const cogs = rollupOrderCogs(orders.map((o) => o.cogs));
  const grossMarginZar = cogs.cogsZar === null ? null : grossZar - cogs.cogsZar;
  const collectedZar = grossZar - writtenOffZar;
  const contributionZar =
    cogs.cogsZar === null || processingFeeZar === null ? null : collectedZar - cogs.cogsZar - processingFeeZar;

  return {
    cardGrossZar,
    grossZar,
    processingFeeZar,
    netSettledZar,
    cogs,
    grossMarginZar,
    writtenOffZar,
    collectedZar,
    contributionZar,
    compsZar,
    drinks,
    doubleShots,
  };
}
