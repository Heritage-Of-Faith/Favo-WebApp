// The Untracked hot drink voucher on the POS (§6.9.3) — AT-204 Wave 2 UI.
// Shared by the server read (getVoucherContext) and the POS draft display.
// The draft figures here are display only: createOrder prices the order from
// the DB and its returned totalZar is the amount owed (never trust the client).

import type { SessionMode } from "@/lib/session-mode";

/** Whether the voucher chip renders (L48 / REQ-146), and which kind it redeems. */
export type VoucherContext = { available: boolean; kind: string | null; kinds: string[] };

export const NO_VOUCHERS: VoucherContext = { available: false, kind: null, kinds: [] };

/** Window event the opening step dispatches after a session opens or closes. */
export const SESSION_CHANGED_EVENT = "favo:session-changed";

/**
 * L48 / REQ-146: no open session, a weekday session, or a session with no
 * voucher kinds active → the chip does not exist. With more than one kind
 * active there is no single kind for the one-tap chip to redeem, so it is
 * not rendered either (createOrder's own default needs exactly one).
 */
export function voucherContextFor(
  session: { mode: SessionMode; voucherKindsActive: readonly string[] } | null
): VoucherContext {
  if (!session || session.mode === "weekday") return NO_VOUCHERS;
  const kinds = [...session.voucherKindsActive];
  if (kinds.length !== 1) return { available: false, kind: null, kinds };
  return { available: true, kind: kinds[0], kinds };
}

type DraftLine = {
  unitPriceZar: number;
  quantity: number;
  modifications: { priceDeltaZar: number }[];
  voucherCount?: number;
  /** AT-202: the per-unit extra-shot surcharge the POS priced the line with. Absent = 0. */
  surchargeZar?: number;
};

/** §6.9.2a: one voucher zeroes one whole unit — listed price plus its modifications. */
export function draftUnitZar(line: DraftLine): number {
  return line.unitPriceZar + line.modifications.reduce((s, m) => s + m.priceDeltaZar, 0);
}

/**
 * AT-202 part 1, interim: a line carrying an extra-shot surcharge takes no
 * voucher (the server refuses VOUCHER_NOT_ON_EXTRA_SHOTS), so the POS offers
 * no voucher control on it and never counts one.
 */
export function draftLineTakesVoucher(line: Pick<DraftLine, "surchargeZar">): boolean {
  return (line.surchargeZar ?? 0) === 0;
}

/** The line's gross: quantity × (unit + mods + the per-unit surcharge, which stays owed). */
export function draftLineGrossZar(line: DraftLine): number {
  return (draftUnitZar(line) + (line.surchargeZar ?? 0)) * line.quantity;
}

/** REQ-147: the line's remaining price after its m vouchers. The surcharge is never vouchered. */
export function draftLineNetZar(line: DraftLine): number {
  const m = draftLineTakesVoucher(line) ? Math.min(Math.max(line.voucherCount ?? 0, 0), line.quantity) : 0;
  return draftUnitZar(line) * (line.quantity - m) + (line.surchargeZar ?? 0) * line.quantity;
}

export function draftNetZar(lines: DraftLine[]): number {
  return lines.reduce((s, l) => s + draftLineNetZar(l), 0);
}

/**
 * The chip's one tap (§6.9.3): adds a voucher to the next unit; on a fully
 * vouchered line the same tap removes them all — on a quantity-1 line that is
 * exactly "tapping it again removes it".
 */
export function nextVoucherCount(line: { quantity: number; voucherCount?: number }): number {
  const m = line.voucherCount ?? 0;
  return m >= line.quantity ? 0 : m + 1;
}
