// T10 — the daily two-directional reconciliation at transaction grain
// (PRD v7.0 §6.8.3, §12.2; REQ-019, REQ-032, REQ-033, REQ-034, REQ-120 (tip),
// DEC-17, S7d). Pure: it reads nothing and writes nothing. It turns one parsed
// Yoco export plus what FAVO holds into a PLAN — the fee/receipt annotations to
// write, and the exception and information lines T10 lists.
//
// The plan can only ever annotate `payments.fee_zar` and `payments.receipt_no`.
// It has no way to express a payment status: importYocoTransactions "annotates
// revenue, it cannot create it" (§9.6.2 job 6). A Yoco payment FAVO has not
// confirmed is listed as `needs_attach`; attaching it is the tender chain's
// lookup (resolveTenderByLookup, writer 2 of §10.2.1), started by a person.

import type { RejectedRow, YocoRow } from "./yoco-export";

/** What T10 needs to know about one FAVO payments row. */
export type FavoPayment = {
  id: string;
  orderId: string | null;
  fundTopupId: string | null;
  attempt: number;
  clientReference: string;
  yocoPaymentId: string | null;
  status: string;
  amountZar: number;
  chargedAmountZar: number | null;
  feeZar: number | null;
  receiptNo: string | null;
  /** The payment's order carries written_off_at. */
  orderWrittenOff: boolean;
};

export type SettlementRef = { orderId: string; settlementRef: string };

export type ExceptionKind =
  | "malformed"
  | "other_day"
  | "duplicate_in_file"
  | "unmatched"
  | "ambiguous"
  | "two_yoco_rows_one_payment"
  | "needs_attach"
  | "status_disagrees"
  | "amount_variance"
  | "tip"
  | "fee_conflict"
  | "receipt_conflict";

export type T10Exception = {
  kind: ExceptionKind;
  line: number | null;
  yocoPaymentId: string | null;
  paymentId: string | null;
  orderId: string | null;
  /** Integer cents: what Yoco's row says, where it says one. */
  amountZar: number | null;
  detail: string;
};

export type T10Info = {
  kind: "retail" | "standalone_machine";
  line: number;
  yocoPaymentId: string;
  amountZar: number;
  // No items text: free-text cells are never kept (it lands on audit_log).
  orderId: string | null;
};

export type MissingFromYoco = {
  paymentId: string;
  orderId: string | null;
  fundTopupId: string | null;
  yocoPaymentId: string | null;
  amountZar: number;
};

export type Annotation = {
  paymentId: string;
  yocoPaymentId: string;
  line: number;
  patch: { feeZar?: number; receiptNo?: string };
  before: { feeZar: number | null; receiptNo: string | null };
};

export type T10Plan = {
  revenueDay: string;
  annotations: Annotation[];
  exceptions: T10Exception[];
  info: T10Info[];
  missingFromYoco: MissingFromYoco[];
  /** Data rows in the file (including rejected ones). */
  totalRows: number;
  /** Rows matched to exactly one FAVO payment. */
  matchedRows: number;
  /** REQ-033's daily unmatched rate: rows matching zero or more than one FAVO payment. */
  unmatchedRows: number;
  /** Σ over this day's completed Yoco rows, integer cents, exactly as Yoco reports them. */
  yocoGrossZar: number;
  yocoFeeZar: number;
  /** Every Yoco payment id and client reference on this day's readable rows (REQ-034 look-ups). */
  rowKeys: string[];
};

export type ReconcileInput = {
  revenueDay: string;
  rows: YocoRow[];
  rejected: RejectedRow[];
  /** FAVO payments whose yoco_payment_id or client_reference appears in the file. */
  candidates: FavoPayment[];
  /** FAVO's successful payments of the revenue day (direction one of REQ-032). */
  dayPayments: FavoPayment[];
  /** Orders whose settlement_ref (§6.7 path B) equals a row's id or receipt number. */
  settlementRefs: SettlementRef[];
  /** Every menu item name FAVO has ever had (S7d). */
  menuNames: string[];
};

function norm(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * S7d / REQ-019: a transaction whose items are ALL non-menu SKUs. Read as: the
 * items cell names no menu item at all. A cell that names any menu item, or a
 * row with no items cell, is never treated as retail (it stays an exception).
 */
export function isAllNonMenu(items: string | null, menuNames: string[]): boolean {
  if (items === null || items.trim() === "") return false;
  // No menu names loaded → nothing can be shown to be non-menu.
  if (!menuNames.some((m) => norm(m) !== "")) return false;
  const cell = norm(items);
  return !menuNames.some((m) => norm(m) !== "" && cell.includes(norm(m)));
}

export function reconcile(input: ReconcileInput): T10Plan {
  const { revenueDay, rows, rejected, candidates, dayPayments, settlementRefs, menuNames } = input;
  const exceptions: T10Exception[] = [];
  const info: T10Info[] = [];
  const annotations: Annotation[] = [];

  const ex = (kind: ExceptionKind, row: Pick<YocoRow, "line" | "yocoPaymentId"> & { amountZar?: number } | null, detail: string, p?: FavoPayment) =>
    exceptions.push({
      kind,
      line: row?.line ?? null,
      yocoPaymentId: row?.yocoPaymentId ?? null,
      paymentId: p?.id ?? null,
      orderId: p?.orderId ?? null,
      amountZar: row?.amountZar ?? null,
      detail,
    });

  for (const r of rejected) {
    exceptions.push({ kind: "malformed", line: r.line, yocoPaymentId: r.yocoPaymentId, paymentId: null, orderId: null, amountZar: null, detail: r.reason });
  }

  // Rows of another day, and an id that appears more than once, are listed and
  // never matched: which copy is right is not FAVO's to guess.
  const counts = new Map<string, number>();
  for (const r of rows) counts.set(r.yocoPaymentId, (counts.get(r.yocoPaymentId) ?? 0) + 1);
  const usable: YocoRow[] = [];
  for (const r of rows) {
    if (r.revenueDay !== revenueDay) {
      ex("other_day", r, `Dated ${r.revenueDay}, not ${revenueDay}. Upload it with its own day.`);
    } else if ((counts.get(r.yocoPaymentId) ?? 0) > 1) {
      ex("duplicate_in_file", r, `This Yoco payment id appears ${counts.get(r.yocoPaymentId)} times in the file.`);
    } else usable.push(r);
  }

  // Candidates per row: by yoco_payment_id, and by client_reference where the
  // FAVO payment holds no Yoco id or the same one. More than one → ambiguous.
  const assigned = new Map<YocoRow, FavoPayment>();
  let unmatchedRows = 0;
  for (const r of usable) {
    const byId = candidates.filter((p) => p.yocoPaymentId === r.yocoPaymentId);
    const byRef = r.clientReference
      ? candidates.filter((p) => p.clientReference === r.clientReference && (p.yocoPaymentId === null || p.yocoPaymentId === r.yocoPaymentId))
      : [];
    const found = [...new Map([...byId, ...byRef].map((p) => [p.id, p])).values()];
    if (found.length === 1) {
      assigned.set(r, found[0]);
      continue;
    }
    if (found.length > 1) {
      unmatchedRows++;
      ex("ambiguous", r, `Matches ${found.length} FAVO payments. Left unmatched — never guessed.`);
      continue;
    }
    // Zero FAVO payments. §6.7 path B and S7d are named information lines.
    const slips = [...new Set(settlementRefs
      .filter((s) => s.settlementRef === r.yocoPaymentId || (r.receiptNo !== null && s.settlementRef === r.receiptNo))
      .map((s) => s.orderId))];
    if (slips.length === 1) {
      info.push({ kind: "standalone_machine", line: r.line, yocoPaymentId: r.yocoPaymentId, amountZar: r.amountZar, orderId: slips[0] });
      continue;
    }
    if (slips.length > 1) {
      unmatchedRows++;
      ex("ambiguous", r, `Matches the standalone-machine reference of ${slips.length} orders. Left unmatched — never guessed.`);
      continue;
    }
    if (isAllNonMenu(r.items, menuNames)) {
      info.push({ kind: "retail", line: r.line, yocoPaymentId: r.yocoPaymentId, amountZar: r.amountZar, orderId: null });
      continue;
    }
    unmatchedRows++;
    ex("unmatched", r, "Yoco holds this payment and FAVO does not.");
  }

  // Two Yoco rows on one FAVO payment: a double charge, never annotated.
  const byPayment = new Map<string, YocoRow[]>();
  for (const [r, p] of assigned) byPayment.set(p.id, [...(byPayment.get(p.id) ?? []), r]);
  for (const [, rs] of byPayment) {
    if (rs.length < 2) continue;
    for (const r of rs) {
      const p = assigned.get(r) as FavoPayment;
      ex("two_yoco_rows_one_payment", r, `${rs.length} Yoco payments (${rs.map((x) => x.yocoPaymentId).join(", ")}) point at one FAVO payment — a possible double charge.`, p);
      assigned.delete(r);
      unmatchedRows++;
    }
  }

  const matchedIds = new Set<string>();
  for (const [r, p] of assigned) {
    matchedIds.add(p.id);
    if (r.status === "failed") {
      if (p.status === "successful") ex("status_disagrees", r, "Yoco shows this payment failed; FAVO holds it as paid.", p);
      continue; // a failed row moved no money: nothing to annotate
    }
    if (p.status !== "successful") {
      // Listed only: nothing is written to a payment FAVO has not confirmed.
      ex(
        "needs_attach",
        r,
        p.orderWrittenOff
          ? "Yoco shows this payment on an order the close wrote off. Use “Check with Yoco” to attach it; this import never marks a payment paid."
          : "Yoco shows this payment; FAVO has not confirmed it. Use “Check with Yoco” to attach it; this import never marks a payment paid.",
        p
      );
      continue;
    }
    const favoAmount = p.chargedAmountZar ?? p.amountZar;
    if (r.amountZar !== favoAmount) {
      ex("amount_variance", r, `Yoco charged ${r.amountZar} cents; FAVO holds ${favoAmount} cents.`, p);
    }
    if (r.tipZar !== 0) {
      // DEC-17: FAVO stores no tip. The row is listed and its fee and receipt
      // are WITHHELD until an Admin clears the tip (no clearing flow is built).
      ex("tip", r, `A tip of ${r.tipZar} cents came through the machine. FAVO takes no tips and stores none; this payment's fee is not written until an Admin clears it.`, p);
      continue;
    }
    const patch: Annotation["patch"] = {};
    if (p.feeZar === null) patch.feeZar = r.feeZar;
    else if (p.feeZar !== r.feeZar) ex("fee_conflict", r, `FAVO already holds a fee of ${p.feeZar} cents; this file says ${r.feeZar} cents. Not overwritten.`, p);
    if (r.receiptNo !== null) {
      if (p.receiptNo === null) patch.receiptNo = r.receiptNo;
      else if (p.receiptNo !== r.receiptNo) ex("receipt_conflict", r, `FAVO already holds receipt ${p.receiptNo}; this file says ${r.receiptNo}. Not overwritten.`, p);
    }
    if (patch.feeZar !== undefined || patch.receiptNo !== undefined) {
      annotations.push({ paymentId: p.id, yocoPaymentId: r.yocoPaymentId, line: r.line, patch, before: { feeZar: p.feeZar, receiptNo: p.receiptNo } });
    }
  }

  // Direction one (REQ-032): payments FAVO holds that Yoco does not.
  const missingFromYoco: MissingFromYoco[] = dayPayments
    .filter((p) => p.status === "successful" && !matchedIds.has(p.id))
    .map((p) => ({ paymentId: p.id, orderId: p.orderId, fundTopupId: p.fundTopupId, yocoPaymentId: p.yocoPaymentId, amountZar: p.chargedAmountZar ?? p.amountZar }));

  const completed = usable.filter((r) => r.status === "successful");
  const rowKeys = [...new Set(rows.filter((r) => r.revenueDay === revenueDay).flatMap((r) => (r.clientReference ? [r.yocoPaymentId, r.clientReference] : [r.yocoPaymentId])))];

  return {
    revenueDay,
    annotations,
    exceptions,
    info,
    missingFromYoco,
    totalRows: rows.length + rejected.length,
    matchedRows: assigned.size,
    unmatchedRows,
    yocoGrossZar: completed.reduce((n, r) => n + r.amountZar, 0),
    yocoFeeZar: completed.reduce((n, r) => n + r.feeZar, 0),
    rowKeys,
  };
}
