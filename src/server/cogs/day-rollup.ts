// AT-189 · AT-190 · AT-192 — the DAY block of PRD §7.0.2 (L1772–1822), pure.
// REQ-106 (cogs_zar = Σ order_cogs, never re-rounded), REQ-108 (a NULL fee
// makes every fee-dependent figure UNAVAILABLE), REQ-109 (an absent cost input
// makes cogs, gross margin and contribution UNAVAILABLE), REQ-111
// (contribution = collected − cogs − fees), REQ-134 (an unknown payment mode
// fails loudly), REQ-158 (outreach_cogs leaves contribution, cogs_zar prints whole).
//
//   card_gross_zar  = Σ order_net_charged WHERE payment_mode IN ('yoco','yoco_deferred')
//   fund_gross_zar  = Σ order_net_charged WHERE payment_mode = 'donor_fund'
//   gross_zar       = card_gross_zar + fund_gross_zar
//   topups_settled  = Σ payments.amount_zar WHERE fund_topup_id IS NOT NULL AND status='successful'
//   net_settled     = card_gross_zar + topups_settled + Σ tip_zar − processing_fee
//                     (DEC-17 drops the tip term and payments has no tip column;
//                     tipZar is left as it was, outside this change)
//   processing_fee  = Σ fee_zar — UNAVAILABLE if any settled payment's fee is NULL
//   cogs_zar        = Σ order_cogs
//   gross_margin    = gross_zar − cogs_zar
//   written_off_zar = Σ order_net_charged WHERE written off
//   collected_zar   = gross_zar − written_off_zar
//   contribution    = collected_zar − ( cogs_zar − outreach_cogs ) − processing_fee
//
// payment_mode is read through assertPaymentMode: 'free' is neither card nor
// fund gross, and NULL or any other value throws UnknownPaymentModeError —
// never skipped, never defaulted (§10.6).
//
// outreach_cogs: an order's share of order_cogs carried by its live-voucher
// lines, supplied by the caller (outreachCogsZar). Undefined = the order has
// no live voucher line (0). NULL = it has one but its line COGS is not
// recorded, so outreach_cogs and contribution are UNAVAILABLE, never 0.

import { rollupOrderCogs, type CostRollup, type OrderCogsRow } from "@/lib/cost-state";
import { assertPaymentMode } from "@/lib/payment-mode";

export type DayOrder = {
  /** orders.total_zar — order_net_charged. */
  netChargedZar: number;
  /** orders.payment_mode as read. Anything but the four enum values throws. */
  paymentMode: string | null;
  writtenOff: boolean;
  /** orders.settled_at IS NOT NULL (§10.3). Absent reads as false. */
  settled?: boolean;
  /** The order's settled card payment, or null when none (e.g. an R0 order). */
  payment: { feeZar: number | null; tipZar: number } | null;
  cogs: OrderCogsRow;
  /** compDiscountZar: order_items.discount_zar on a line whose comp_reason IS NOT NULL (L33). */
  lines: readonly { quantity: number; shots: number; compDiscountZar?: number }[];
  /**
   * The order's outreach_cogs (§7.0.2 L1820, REQ-158). Undefined = no live
   * voucher line; NULL = a live voucher line whose COGS is not recorded.
   */
  outreachCogsZar?: number | null;
};

/** A successful fund top-up payment on the day (§7.0.2 topups_settled). */
export type DayTopup = { amountZar: number; feeZar: number | null };

export type DayRollup = {
  cardGrossZar: number;
  fundGrossZar: number;
  grossZar: number;
  topupsSettledZar: number;
  /** NULL = UNAVAILABLE (REQ-108). */
  processingFeeZar: number | null;
  netSettledZar: number | null;
  cogs: CostRollup;
  /** NULL = UNAVAILABLE (REQ-109). */
  grossMarginZar: number | null;
  writtenOffZar: number;
  collectedZar: number;
  /** NULL = UNAVAILABLE: a live voucher line's COGS is not recorded. */
  outreachCogsZar: number | null;
  /** NULL = UNAVAILABLE when cogs, fees or outreach_cogs are (REQ-108, REQ-109). */
  contributionZar: number | null;
  compsZar: number;
  drinks: number;
  doubleShots: number;
  /**
   * REQ-133 / §10.3.3: `yoco_deferred` split by settled_at and written_off_at —
   * the mode records how the order was taken, not how it ended. Σ
   * order_net_charged of the day's deferred orders, integer cents; the three
   * sum to the deferred part of card_gross_zar. §7.5 "Deferred: open · settled
   * · written off".
   */
  deferred: { openZar: number; settledZar: number; writtenOffZar: number };
};

export function rollupDay(orders: readonly DayOrder[], topups: readonly DayTopup[] = []): DayRollup {
  let cardGrossZar = 0;
  let fundGrossZar = 0;
  let writtenOffZar = 0;
  let fee = 0;
  let feeUnknown = false;
  let tips = 0;
  let compsZar = 0;
  let drinks = 0;
  let doubleShots = 0;
  let outreach = 0;
  let outreachUnknown = false;
  const deferred = { openZar: 0, settledZar: 0, writtenOffZar: 0 };

  for (const o of orders) {
    const mode = assertPaymentMode(o.paymentMode);
    if (mode === "yoco" || mode === "yoco_deferred") cardGrossZar += o.netChargedZar;
    if (mode === "yoco_deferred") {
      if (o.writtenOff) deferred.writtenOffZar += o.netChargedZar;
      else if (o.settled === true) deferred.settledZar += o.netChargedZar;
      else deferred.openZar += o.netChargedZar;
    }
    else if (mode === "donor_fund") fundGrossZar += o.netChargedZar;
    if (o.writtenOff) writtenOffZar += o.netChargedZar;
    if (o.payment) {
      if (o.payment.feeZar === null) feeUnknown = true;
      else fee += o.payment.feeZar;
      tips += o.payment.tipZar;
    }
    if (o.outreachCogsZar === null) outreachUnknown = true;
    else outreach += o.outreachCogsZar ?? 0;
    for (const l of o.lines) {
      drinks += l.quantity;
      compsZar += l.compDiscountZar ?? 0;
      if (l.shots === 2) doubleShots += l.quantity;
    }
  }

  let topupsSettledZar = 0;
  for (const t of topups) {
    topupsSettledZar += t.amountZar;
    if (t.feeZar === null) feeUnknown = true;
    else fee += t.feeZar;
  }

  const grossZar = cardGrossZar + fundGrossZar;
  const processingFeeZar = feeUnknown ? null : fee;
  const netSettledZar = processingFeeZar === null ? null : cardGrossZar + topupsSettledZar + tips - processingFeeZar;
  const cogs = rollupOrderCogs(orders.map((o) => o.cogs));
  const grossMarginZar = cogs.cogsZar === null ? null : grossZar - cogs.cogsZar;
  const collectedZar = grossZar - writtenOffZar;
  const outreachCogsZar = outreachUnknown ? null : outreach;
  const contributionZar =
    cogs.cogsZar === null || processingFeeZar === null || outreachCogsZar === null
      ? null
      : collectedZar - (cogs.cogsZar - outreachCogsZar) - processingFeeZar;

  return {
    cardGrossZar,
    fundGrossZar,
    grossZar,
    topupsSettledZar,
    processingFeeZar,
    netSettledZar,
    cogs,
    grossMarginZar,
    writtenOffZar,
    collectedZar,
    outreachCogsZar,
    contributionZar,
    compsZar,
    drinks,
    doubleShots,
    deferred,
  };
}
