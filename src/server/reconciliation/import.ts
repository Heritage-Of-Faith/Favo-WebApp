// §11.2 importYocoTransactions(revenue_day) — PRD v7.0 §6.8.3, §9.6.2 job 6.
//
// "Yoco's own transaction export for that revenue day, uploaded by an Admin at
// /admin/reports. There is no automatic fetch … Ingests one revenue day and
// writes payments.fee_zar and receipt_no … idempotent on (revenue_day, yoco
// payment id). Matches on yoco_payment_id, falling back to client_reference;
// ambiguous or unmatched rows go to T10's exception list and are never guessed
// at. Writes an audit_log row with actor_kind='system'. It never writes
// payments.status."
//
// Run when an Admin uploads the export — NOT on a timer. The 06:00 run, the
// startup catch-up and REQ-067's 09:00 push are scheduled jobs and are not
// built here (owner-gated).
//
// ImportTx is deliberately narrow: the only write to `payments` it can express
// is annotatePayment(fee_zar, receipt_no), and that fills a NULL only — so a
// re-import of the same day writes nothing a second time, and a figure already
// held is never overwritten (a disagreement is listed on T10 instead).

import type { AuditInput } from "@/server/audit";
import { parseYocoExport, type YocoField } from "./yoco-export";
import { reconcile, type FavoPayment, type SettlementRef, type T10Exception, type T10Info, type MissingFromYoco } from "./t10";

/** audit_log entity_kind / action of one import (entity_id = the revenue day). */
export const YOCO_IMPORT_ENTITY = "yoco_import";
export const YOCO_IMPORT_ACTION = "yoco_import";
export const YOCO_IMPORT_REFUSED_ACTION = "yoco_import_refused";
/** audit_log action (entity_kind 'payment') of one fee/receipt annotation. */
export const PAYMENT_ANNOTATED_ACTION = "payment.yoco_import_annotated";

export interface ImportTx {
  paymentsByKeys(yocoPaymentIds: string[], clientReferences: string[]): Promise<FavoPayment[]>;
  successfulPaymentsOfDay(revenueDay: string): Promise<FavoPayment[]>;
  ordersBySettlementRefs(refs: string[]): Promise<SettlementRef[]>;
  menuItemNames(): Promise<string[]>;
  /** Sets fee_zar / receipt_no only where they are still NULL. True if a row changed. */
  annotatePayment(paymentId: string, patch: { feeZar?: number; receiptNo?: string }): Promise<boolean>;
  audit(row: AuditInput): Promise<void>;
}

export interface ImportStore {
  transaction<T>(fn: (tx: ImportTx) => Promise<T>): Promise<T>;
}

/** What one import records on its audit row, and what T10 reads back. */
export type ImportSummary = {
  version: 1;
  revenueDay: string;
  importedAt: string;
  uploadedByStaffId: string;
  columns: YocoField[];
  notes: string[];
  totalRows: number;
  matchedRows: number;
  unmatchedRows: number;
  yocoGrossZar: number;
  yocoFeeZar: number;
  annotatedPayments: number;
  exceptions: T10Exception[];
  info: T10Info[];
  missingFromYoco: MissingFromYoco[];
  rowKeys: string[];
};

export type ImportResult =
  | { ok: true; summary: ImportSummary }
  | { ok: false; code: "INVALID_EXPORT"; message: string };

const SYSTEM = { actorRole: "system" } as const;

export async function importYocoTransactions(
  store: ImportStore,
  input: { revenueDay: string; csvText: string; uploadedByStaffId: string; now: Date }
): Promise<ImportResult> {
  const { revenueDay, csvText, uploadedByStaffId, now } = input;
  const parsed = parseYocoExport(csvText);
  if (!parsed.ok) {
    // A refused file is audited too (CLAUDE.md §5): who tried, which day, why.
    await store.transaction((tx) =>
      tx.audit({
        entityKind: YOCO_IMPORT_ENTITY,
        entityId: revenueDay,
        action: YOCO_IMPORT_REFUSED_ACTION,
        ...SYSTEM,
        reason: "invalid_export",
        after: { revenueDay, uploadedByStaffId, message: parsed.reason },
      })
    );
    return { ok: false, code: "INVALID_EXPORT", message: parsed.reason };
  }

  const summary = await store.transaction(async (tx): Promise<ImportSummary> => {
    const ids = [...new Set(parsed.rows.map((r) => r.yocoPaymentId))];
    const refs = [...new Set(parsed.rows.flatMap((r) => (r.clientReference ? [r.clientReference] : [])))];
    const slipKeys = [...new Set([...ids, ...parsed.rows.flatMap((r) => (r.receiptNo ? [r.receiptNo] : []))])];
    const [candidates, dayPayments, settlementRefs, menuNames] = await Promise.all([
      tx.paymentsByKeys(ids, refs),
      tx.successfulPaymentsOfDay(revenueDay),
      tx.ordersBySettlementRefs(slipKeys),
      tx.menuItemNames(),
    ]);
    const plan = reconcile({ revenueDay, rows: parsed.rows, rejected: parsed.rejected, candidates, dayPayments, settlementRefs, menuNames });

    let annotated = 0;
    for (const a of plan.annotations) {
      const changed = await tx.annotatePayment(a.paymentId, a.patch);
      if (!changed) continue; // already filled by a concurrent import: nothing written, nothing audited
      annotated++;
      await tx.audit({
        entityKind: "payment",
        entityId: a.paymentId,
        action: PAYMENT_ANNOTATED_ACTION,
        ...SYSTEM,
        before: a.before,
        after: { ...a.patch, revenueDay, yocoPaymentId: a.yocoPaymentId, line: a.line },
      });
    }

    const s: ImportSummary = {
      version: 1,
      revenueDay,
      importedAt: now.toISOString(),
      uploadedByStaffId,
      columns: parsed.columns,
      notes: parsed.notes,
      totalRows: plan.totalRows,
      matchedRows: plan.matchedRows,
      unmatchedRows: plan.unmatchedRows,
      yocoGrossZar: plan.yocoGrossZar,
      yocoFeeZar: plan.yocoFeeZar,
      annotatedPayments: annotated,
      exceptions: plan.exceptions,
      info: plan.info,
      missingFromYoco: plan.missingFromYoco,
      rowKeys: plan.rowKeys,
    };
    await tx.audit({ entityKind: YOCO_IMPORT_ENTITY, entityId: revenueDay, action: YOCO_IMPORT_ACTION, ...SYSTEM, after: s });
    return s;
  });
  return { ok: true, summary };
}
