// The Untracked hot drink voucher (§6.9) — AT-204. Pure decision logic.
//
// PRD §6.9.1: "A voucher discounts exactly one unit of one order line to R0",
// written to order_items.discount_zar with a row in voucher_redemptions.
// §6.9.2a (owner decision, 14 Sep 2026): "A voucher zeroes one whole unit —
// its listed price, its modifications and its extra shots.
// line_discount = line_unit_price." A line may carry up to `quantity`
// redemptions (L41, REQ-151). §11 redeemVoucher rejects: a different discount
// mechanism on the line (L41); `quantity` redemptions already there; a kind
// not in the session's voucher_kinds_active; a line with no net charge.
// REQ-155: weekday mode → VOUCHER_NOT_IN_MODE.

export type VoucherRefusalCode = "VOUCHER_NOT_IN_MODE" | "VALIDATION" | "NO_SESSION";

/**
 * §7.0.2 line_unit_price = unit_price_zar + line_mods_zar + surcharge_zar,
 * all PER UNIT and in integer cents. `surchargeZar` is the extra-shot
 * surcharge the line was charged per unit; absent = 0.
 */
export function lineUnitPriceZar(line: { unitPriceZar: number; modsZar: number; surchargeZar?: number }): number {
  return line.unitPriceZar + line.modsZar + (line.surchargeZar ?? 0);
}

export type VoucherLine = {
  quantity: number;
  unitPriceZar: number;
  modsZar: number;
  /** Per-unit extra-shot surcharge charged on this line; absent = 0. */
  surchargeZar?: number;
  discountZar: number;
  compReason: string | null;
};

export type VoucherSession = { mode: "weekday" | "sunday" | "event"; voucherKindsActive: readonly string[] } | null;

export type RedeemDecision =
  | { status: "apply"; discountZar: number; lineDiscountZar: number }
  | { status: "refused"; code: VoucherRefusalCode; message: string };

/** decideRedeem's own copy for a line already carrying another mechanism (L41). */
export const OTHER_DISCOUNT = "This drink already has a different discount.";
/** decideRedeem's own copy for a line whose every unit already carries a voucher. */
export const TOO_MANY_VOUCHERS = "Every drink on this line already has a voucher.";

const refuse = (code: VoucherRefusalCode, message: string) => ({ status: "refused" as const, code, message });

export function decideRedeem(input: {
  session: VoucherSession;
  kind: string;
  line: VoucherLine;
  /** The line's live (reversed_at IS NULL) voucher_redemptions rows. */
  live: { count: number; discountZar: number };
}): RedeemDecision {
  const { session, kind, line, live } = input;
  if (!session) return refuse("NO_SESSION", "Open the session first.");
  if (session.mode === "weekday" || !session.voucherKindsActive.includes(kind)) {
    return refuse("VOUCHER_NOT_IN_MODE", "Vouchers aren't on in this session.");
  }
  // L41: at most one discount mechanism per line. Any discount not made of
  // this line's live vouchers belongs to the free cup or a comp.
  if (line.compReason !== null || line.discountZar !== live.discountZar) {
    return refuse("VALIDATION", OTHER_DISCOUNT);
  }
  if (live.count >= line.quantity) {
    return refuse("VALIDATION", TOO_MANY_VOUCHERS);
  }
  const unit = lineUnitPriceZar(line);
  if (unit <= 0) return refuse("VALIDATION", "This drink is already free.");
  const lineDiscountZar = line.discountZar + unit;
  // DEF-A's floor (the DB CHECK): never past the line's own value.
  if (lineDiscountZar > line.quantity * unit) {
    return refuse("VALIDATION", TOO_MANY_VOUCHERS);
  }
  return { status: "apply", discountZar: unit, lineDiscountZar };
}

// createOrder charges no extra-shot surcharge today: there is no
// extra_shot_zar in app_config and no surcharge on the order_items line, so
// what the line was charged per unit is unit_price_zar + mods_zar. A voucher
// can only take off what the line was charged. (Moved from actions/vouchers.ts.)
export const LINE_SURCHARGE_CHARGED_ZAR = 0;

export type LineVoucherPlan =
  | { status: "apply"; perVoucherZar: number[]; lineDiscountZar: number }
  | { status: "refused"; code: VoucherRefusalCode; message: string };

/**
 * `count` vouchers on one new line at createOrder — decideRedeem applied
 * `count` times in a row, so placement and redeemVoucher share one rule.
 * `line.discountZar` is any other mechanism's discount already on the line
 * (e.g. the free cup); non-zero means L41 refuses.
 */
export function planLineVouchers(input: {
  session: VoucherSession;
  kind: string;
  line: VoucherLine;
  count: number;
}): LineVoucherPlan {
  const { session, kind, count } = input;
  if (!Number.isInteger(count) || count < 0 || count > input.line.quantity) {
    return refuse("VALIDATION", TOO_MANY_VOUCHERS);
  }
  let line = input.line;
  const perVoucherZar: number[] = [];
  for (let i = 0; i < count; i++) {
    const live = { count: i, discountZar: perVoucherZar.reduce((a, b) => a + b, 0) };
    const d = decideRedeem({ session, kind, line, live });
    if (d.status === "refused") return d;
    perVoucherZar.push(d.discountZar);
    line = { ...line, discountZar: d.lineDiscountZar };
  }
  return { status: "apply", perVoucherZar, lineDiscountZar: line.discountZar };
}

export type RemoveDecision =
  | { status: "apply"; redemptionId: string; lineDiscountZar: number; restoredZar: number }
  | { status: "refused"; code: "VALIDATION"; message: string };

/** The undo: reverses the most recent live redemption on the line (COL-29). */
export function decideRemove(input: {
  line: { discountZar: number };
  live: readonly { id: string; discountZar: number; at: Date | string }[];
}): RemoveDecision {
  if (input.live.length === 0) {
    return { status: "refused", code: "VALIDATION", message: "This drink has no voucher to remove." };
  }
  const latest = [...input.live].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())[0];
  // The line's discount is what its live voucher rows add up to (L41: no other
  // mechanism shares the line) — never derived from the column, which a
  // concurrent caller may have read stale.
  const liveSum = input.live.reduce((sum, r) => sum + r.discountZar, 0);
  return {
    status: "apply",
    redemptionId: latest.id,
    lineDiscountZar: liveSum - latest.discountZar,
    restoredZar: latest.discountZar,
  };
}
