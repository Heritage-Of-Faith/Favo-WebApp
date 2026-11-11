// T10's screen model (PRD v7.0 §6.8.3, REQ-032/033/034). Pure.
//
// REQ-034: "Given a write-off with reason `unresolved_at_close` · When the next
// reconciliation runs · Then it stays an open T10 item until Yoco's record
// confirms no payment or produces one — in which case the write-off is
// reversed and the payment attached."
//
// A missing row in an uploaded file is NEVER taken as Yoco confirming there was
// no payment (owner-safe default, review of 11 Nov 2026). The item stays open:
//   - waiting_for_export   no export uploaded for its day yet
//   - yoco_shows_payment   the export holds one of its payments: the Admin uses
//                          "Check with Yoco" (resolveTenderByLookup, the tender
//                          chain's writer 2), which attaches it and reverses the
//                          write-off. The import itself never does.
//   - export_inconclusive  the export cannot rule it out: it has unreadable or
//                          other-day rows, or the order only ever had a client
//                          reference and the file has no reference column
//   - export_no_match      the export has no matching row: Admin to confirm
// It closes only as confirmed_no_payment, after an Admin's confirmNoYocoPayment
// (audit action t10_confirmed_no_payment, with a reason).

import type { ImportSummary } from "./import";

/** audit_log action (entity_kind 'order') of an Admin confirming Yoco holds no payment. */
export const T10_CONFIRMED_NO_PAYMENT_ACTION = "t10_confirmed_no_payment";
export const T10_CONFIRM_REFUSED_ACTION = "t10_confirm_no_payment_refused";
export const MIN_CONFIRM_REASON_LENGTH = 3;

export type OpenWriteOffInput = {
  orderId: string;
  revenueDay: string;
  totalZar: number;
  /** Yoco payment ids of the order's SENT attempts (where FAVO holds one). */
  yocoPaymentIds: string[];
  /** client_reference of every SENT attempt. */
  clientReferences: string[];
  /** An Admin has confirmed (t10_confirmed_no_payment) that Yoco holds no payment. */
  confirmedNoPayment: boolean;
};

export type WriteOffT10Status =
  | "waiting_for_export"
  | "yoco_shows_payment"
  | "export_inconclusive"
  | "export_no_match"
  | "confirmed_no_payment";

export type WriteOffT10Item = OpenWriteOffInput & { status: WriteOffT10Status; open: boolean };

type ImportFacts = Pick<ImportSummary, "rowKeys" | "columns" | "exceptions">;

export function writeOffStatus(w: OpenWriteOffInput, imp: ImportFacts | null): WriteOffT10Status {
  if (imp !== null) {
    const keys = new Set(imp.rowKeys);
    if ([...w.yocoPaymentIds, ...w.clientReferences].some((k) => keys.has(k))) return "yoco_shows_payment";
  }
  if (w.confirmedNoPayment) return "confirmed_no_payment";
  if (imp === null) return "waiting_for_export";
  const incomplete = imp.exceptions.some((e) => e.kind === "malformed" || e.kind === "other_day");
  const refOnlyWithoutRefColumn = w.yocoPaymentIds.length === 0 && !imp.columns.includes("clientReference");
  return incomplete || refOnlyWithoutRefColumn ? "export_inconclusive" : "export_no_match";
}

export function writeOffItems(writeOffs: OpenWriteOffInput[], importsByDay: Map<string, ImportFacts>): WriteOffT10Item[] {
  return writeOffs.map((w) => {
    const status = writeOffStatus(w, importsByDay.get(w.revenueDay) ?? null);
    return { ...w, status, open: status !== "confirmed_no_payment" };
  });
}

/** An import summary read back from audit_log.after (jsonb). Anything unexpected → null, never a guess. */
export function readImportSummary(after: unknown): ImportSummary | null {
  if (typeof after !== "object" || after === null) return null;
  const s = after as Partial<ImportSummary>;
  if (
    s.version !== 1 ||
    typeof s.revenueDay !== "string" ||
    !Array.isArray(s.rowKeys) ||
    !Array.isArray(s.exceptions) ||
    !Array.isArray(s.columns)
  ) {
    return null;
  }
  return s as ImportSummary;
}

export type T10View = {
  revenueDay: string;
  /** The latest import for the day, or null when no export was uploaded. */
  latestImport: ImportSummary | null;
  writeOffs: WriteOffT10Item[];
};
