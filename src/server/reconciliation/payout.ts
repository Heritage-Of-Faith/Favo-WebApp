// REQ-120 (PRD v7.0 §7.0.4, T10): "Given a Yoco payout · When it is reconciled
// · Then Σ (gross − fee) over the settled transactions equals the payout, per
// device, and a difference — including any tip the machine let through
// (DEC-17) — is an open T10 item." Pure: reads nothing, writes nothing.
//
// gross = payments.charged_amount_zar (what the machine charged, REQ-030),
// fee = payments.fee_zar (Yoco's own figure, §7.0.4). A settled payment with
// either one missing makes the check UNAVAILABLE, naming the count — never a
// zero (§7.0.2 processing_fee: "SUM() silently skips NULLs"). The payout the
// Admin types is kept on an audit row (entity 'yoco_payout'), never as a payment.

/** audit_log entity_kind / actions of a payout the Admin entered (entity_id = day:device). */
export const YOCO_PAYOUT_ENTITY = "yoco_payout";
export const YOCO_PAYOUT_ACTION = "yoco_payout_recorded";

/** One successful card payment of the revenue day, as the check reads it. */
export type SettledCardPayment = {
  paymentId: string;
  deviceId: string;
  chargedAmountZar: number | null;
  feeZar: number | null;
};

export type PayoutCheck =
  | { state: "ok" | "variance"; deviceId: string; payoutZar: number; expectedZar: number; differenceZar: number; count: number }
  | { state: "unavailable"; deviceId: string; payoutZar: number; missingFee: number; missingCharged: number; count: number };

/** differenceZar = payout − Σ (gross − fee); positive when Yoco paid out more (e.g. a tip). */
export function payoutCheck(payoutZar: number, payments: SettledCardPayment[], deviceId: string): PayoutCheck {
  const mine = payments.filter((p) => p.deviceId === deviceId);
  const missingFee = mine.filter((p) => p.feeZar === null).length;
  const missingCharged = mine.filter((p) => p.chargedAmountZar === null).length;
  if (missingFee > 0 || missingCharged > 0) {
    return { state: "unavailable", deviceId, payoutZar, missingFee, missingCharged, count: mine.length };
  }
  const expectedZar = mine.reduce((n, p) => n + (p.chargedAmountZar as number) - (p.feeZar as number), 0);
  const differenceZar = payoutZar - expectedZar;
  return { state: differenceZar === 0 ? "ok" : "variance", deviceId, payoutZar, expectedZar, differenceZar, count: mine.length };
}

export function payoutEntityId(revenueDay: string, deviceId: string): string {
  return `${revenueDay}:${deviceId}`;
}

export function parsePayoutEntityId(id: string): { revenueDay: string; deviceId: string } | null {
  const m = /^(\d{4}-\d{2}-\d{2}):(.+)$/.exec(id);
  return m ? { revenueDay: m[1], deviceId: m[2] } : null;
}

/** What one entered payout records on its audit row, and what T10 reads back. */
export type PayoutRecord = {
  version: 1;
  revenueDay: string;
  deviceId: string;
  payoutZar: number;
  enteredByStaffId: string;
  /** The check as it stood when entered. T10 re-runs it against today's payments. */
  checkAtEntry: PayoutCheck;
};

export function readPayoutRecord(after: unknown): PayoutRecord | null {
  if (typeof after !== "object" || after === null) return null;
  const r = after as Partial<PayoutRecord>;
  if (
    r.version !== 1 ||
    typeof r.revenueDay !== "string" ||
    typeof r.deviceId !== "string" ||
    typeof r.payoutZar !== "number" ||
    !Number.isInteger(r.payoutZar)
  ) {
    return null;
  }
  return r as PayoutRecord;
}

/** audit_log actions (entity 'yoco_payout', id = day:device) of an Admin closing a payout variance. */
export const YOCO_PAYOUT_VARIANCE_CONFIRMED_ACTION = "yoco_payout_variance_confirmed";
export const YOCO_PAYOUT_VARIANCE_CONFIRM_REFUSED_ACTION = "yoco_payout_variance_confirm_refused";

/** An Admin's confirmPayoutVariance, read back from its audit row. No tip figure is ever part of it. */
export type PayoutConfirmation = { reason: string; payoutZar: number; expectedZar: number; at: string };

/**
 * One device's latest entered payout for the day, re-checked against the
 * payments as they stand now.
 *
 * DEC-17, read strictly: no tip amount is stored anywhere, so a cleared tip
 * cannot explain an exact figure. A positive variance (payout > charges less
 * fees, the direction a tip pushes it) on a device with at least one cleared
 * tip that day is flagged `mayBeClearedTip` — and stays OPEN. A variance line
 * closes only on an Admin's confirmation of exactly these figures, made after
 * this payout was entered; a stale one (figures moved, newer payout) is ignored.
 */
export type PayoutLine = {
  recordedAt: string;
  check: PayoutCheck;
  clearedTipCount: number;
  mayBeClearedTip: boolean;
  confirmation: PayoutConfirmation | null;
  open: boolean;
};

export function payoutLine(recordedAt: string, check: PayoutCheck, clearedTipCount: number, confirmation: PayoutConfirmation | null): PayoutLine {
  const mayBeClearedTip = check.state === "variance" && check.differenceZar > 0 && clearedTipCount >= 1;
  const applies =
    confirmation !== null &&
    check.state === "variance" &&
    confirmation.payoutZar === check.payoutZar &&
    confirmation.expectedZar === check.expectedZar &&
    Date.parse(confirmation.at) >= Date.parse(recordedAt);
  const open = check.state !== "ok" && !applies;
  return { recordedAt, check, clearedTipCount, mayBeClearedTip, confirmation: applies ? confirmation : null, open };
}

export function openPayoutCount(lines: PayoutLine[]): number {
  return lines.filter((l) => l.open).length;
}

/** How many tips were cleared per device, over the day's settled payments only. Counts, never amounts. */
export function clearedTipCountsByDevice(clearedPaymentIds: string[], settled: SettledCardPayment[]): Map<string, number> {
  const deviceOf = new Map(settled.map((p) => [p.paymentId, p.deviceId]));
  const out = new Map<string, number>();
  for (const id of new Set(clearedPaymentIds)) {
    const device = deviceOf.get(id);
    if (device === undefined) continue;
    out.set(device, (out.get(device) ?? 0) + 1);
  }
  return out;
}

export function readPayoutConfirmation(after: unknown, reason: string | null, at: Date): PayoutConfirmation | null {
  if (typeof after !== "object" || after === null || reason === null) return null;
  const a = after as { payoutZar?: unknown; expectedZar?: unknown };
  if (typeof a.payoutZar !== "number" || typeof a.expectedZar !== "number") return null;
  return { reason, payoutZar: a.payoutZar, expectedZar: a.expectedZar, at: at.toISOString() };
}
