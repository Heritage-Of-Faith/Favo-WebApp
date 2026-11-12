// DEC-17 / REQ-120: clearing a tip variance on T10.
//
// The import lists a Yoco row carrying a tip as a `tip` exception and WITHHOLDS
// that payment's fee and receipt (./t10.ts). Clearing is the Admin's record —
// an audit row, action t10_tip_cleared, actor = the Admin, with a reason — that
// the variance was reviewed; only after that row is written, in the same
// transaction, are the withheld fee_zar / receipt_no written, and only where
// still NULL, through the import store's one annotation path. Never
// payments.status, and the tip amount is stored nowhere (DEC-17, read
// strictly: not on the payment, not on any audit row). The payment row is
// locked and the day's import read inside the same transaction.

import type { AuditInput } from "@/server/audit";
import { PAYMENT_ANNOTATED_ACTION, type ImportSummary, type ImportTx } from "./import";

/** audit_log actions (entity_kind 'payment', entity_id = the FAVO payment id). */
export const T10_TIP_CLEARED_ACTION = "t10_tip_cleared";
export const T10_TIP_CLEAR_REFUSED_ACTION = "t10_tip_clear_refused";

export interface TipClearTx {
  /** Row lock on the payment (no write): concurrent clears queue here. */
  lockPayment(paymentId: string): Promise<void>;
  /** The day's latest import summary, read inside this transaction, after the lock. */
  latestImport(revenueDay: string): Promise<ImportSummary | null>;
  tipAlreadyCleared(paymentId: string): Promise<boolean>;
  annotatePayment: ImportTx["annotatePayment"];
  audit(row: AuditInput): Promise<void>;
}

export interface TipClearStore {
  transaction<T>(fn: (tx: TipClearTx) => Promise<T>): Promise<T>;
}

export type TipClearResult =
  | { ok: true; data: { paymentId: string; written: boolean } }
  | { ok: false; code: "NOT_FOUND" | "ALREADY_CLEARED"; message: string };

export async function clearTipVariance(
  store: TipClearStore,
  input: {
    paymentId: string;
    revenueDay: string;
    reason: string;
    actor: { actorId: string; actorRole: string };
  }
): Promise<TipClearResult> {
  const { paymentId, revenueDay, reason, actor } = input;

  return store.transaction(async (tx): Promise<TipClearResult> => {
    await tx.lockPayment(paymentId);
    const summary = await tx.latestImport(revenueDay);
    const tip = summary?.exceptions.find((e) => e.kind === "tip" && e.paymentId === paymentId) ?? null;
    const refuse = async (why: string, code: "NOT_FOUND" | "ALREADY_CLEARED", message: string): Promise<TipClearResult> => {
      await tx.audit({ entityKind: "payment", entityId: paymentId, action: T10_TIP_CLEAR_REFUSED_ACTION, ...actor, reason: why, after: { revenueDay } });
      return { ok: false, code, message };
    };
    if (!tip) return refuse("not_a_tip_variance_on_that_day", "NOT_FOUND", "That payment has no tip row on this day's import.");
    if (!tip.withheld) {
      return refuse("withheld_figures_not_recorded", "NOT_FOUND", "This import predates tip clearing. Upload the day's export again, then clear the tip.");
    }
    if (await tx.tipAlreadyCleared(paymentId)) return refuse("already_cleared", "ALREADY_CLEARED", "This tip has already been cleared.");

    const { feeZar, receiptNo } = tip.withheld;
    // The Admin's review is recorded first; the withheld figures follow it.
    await tx.audit({
      entityKind: "payment",
      entityId: paymentId,
      action: T10_TIP_CLEARED_ACTION,
      ...actor,
      reason,
      // DEC-17: no tip figure, here or anywhere.
      after: { revenueDay, yocoPaymentId: tip.yocoPaymentId, line: tip.line, feeZar, receiptNo },
    });
    const patch: { feeZar: number; receiptNo?: string } = { feeZar };
    if (receiptNo !== null) patch.receiptNo = receiptNo;
    const written = await tx.annotatePayment(paymentId, patch);
    if (written) {
      await tx.audit({
        entityKind: "payment",
        entityId: paymentId,
        action: PAYMENT_ANNOTATED_ACTION,
        ...actor,
        after: { ...patch, revenueDay, yocoPaymentId: tip.yocoPaymentId, line: tip.line, via: T10_TIP_CLEARED_ACTION },
      });
    }
    return { ok: true, data: { paymentId, written } };
  });
}
