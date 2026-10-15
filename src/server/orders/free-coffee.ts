// The free weekday cup (L03) — AT-183 / AT-184. Pure decision logic.
//
// PRD L03: one cup per office staff member per weekday. The beneficiary is a
// `customers` row with status='office_staff', never a FAVO staff member.
// "The entitlement is applied automatically when the mode is weekday, the
// matched customer is `office_staff`, and the item is in the eligible-category
// list — the barista taps only to decline it." It "zeroes exactly one unit of
// one eligible line … never a whole line and never a whole order."
// "Weekday requires both mode='weekday' and the date falling Mon–Fri in SAST."
//
// The daily cap itself is UNIQUE(customer_id, day) on staff_entitlement_log;
// this module only decides whether to try, and on which line.

import { isCoffeeCategory, isWeekdayInSAST } from "@/server/orders/discount";

/** Barista-facing copy. ENTITLEMENT_USED, NOT_ELIGIBLE and NO_SESSION are PRD §6.0.1 S1 codes. */
export const FREE_CUP_COPY = {
  applied: "Free cup applied",
  ENTITLEMENT_USED: "Free cup already claimed today",
  NOT_ELIGIBLE: "Not eligible for the free cup",
  NO_SESSION: "Open today's session first",
  // Not PRD copy (no code exists for it): the order has no customer on it.
  noCustomer: "Pick the customer first — the free cup goes to a named office staff member.",
} as const;

export type FreeCupLine = {
  category: string | null | undefined;
  unitPriceZar: number;
  quantity: number;
};

export type FreeCupRefusalReason =
  | "no_customer"
  | "not_office_staff"
  | "no_session"
  | "not_weekday"
  | "no_eligible_item"
  | "already_claimed";

export type FreeCupRefusalCode = "NOT_ELIGIBLE" | "ENTITLEMENT_USED" | "NO_SESSION";

export type FreeCupDecision =
  | { status: "apply"; lineIndex: number; discountZar: number }
  | {
      status: "refused";
      code: FreeCupRefusalCode;
      reason: FreeCupRefusalReason;
      /** Tell the barista? null = nothing worth saying (e.g. a Sunday walk-in). */
      message: string | null;
      /** An office staff member on a weekday was refused — audit it (REQ-025, L03). */
      audit: boolean;
    };

export type FreeCupInput = {
  /** null when no customer is bound to the order, or the id is not a customer. */
  customer: { status: "office_staff" | "church_member" } | null;
  customerBound: boolean;
  /** At least one opening_sessions row exists for today (PRD S1 NO_SESSION). */
  sessionOpen: boolean;
  /** The date alone is Mon–Fri in SAST — checked before NO_SESSION. */
  weekdayDate: boolean;
  /** mode='weekday' AND Mon–Fri in SAST (see isFreeCupWeekday). */
  weekday: boolean;
  lines: FreeCupLine[];
  /** A staff_entitlement_log row already exists for (customer_id, today). */
  alreadyClaimed: boolean;
};

/**
 * The line that carries the free cup: the FIRST line whose category is
 * eligible (T06: coffee only). The PRD does not say which line; first-in-order
 * is deterministic and is what the barista rang up first.
 */
export function pickFreeCupLine(lines: FreeCupLine[]): number | null {
  const i = lines.findIndex((l) => isCoffeeCategory(l.category) && l.quantity >= 1);
  return i === -1 ? null : i;
}

/**
 * "Weekday requires both mode='weekday' and the date falling Mon–Fri in SAST."
 * `modes` are today's opening_sessions.mode values. No session today → no
 * mode can be resolved → not weekday.
 */
export function isFreeCupWeekday(modes: readonly string[], now: Date): boolean {
  return modes.length > 0 && modes.every((m) => m === "weekday") && isWeekdayInSAST(now);
}

export function decideFreeCup(input: FreeCupInput): FreeCupDecision {
  const lineIndex = pickFreeCupLine(input.lines);
  const worthSaying = input.weekday && lineIndex !== null;

  if (!input.customerBound) {
    return {
      status: "refused", code: "NOT_ELIGIBLE", reason: "no_customer",
      message: worthSaying ? FREE_CUP_COPY.noCustomer : null, audit: false,
    };
  }
  if (!input.customer || input.customer.status !== "office_staff") {
    return {
      status: "refused", code: "NOT_ELIGIBLE", reason: "not_office_staff",
      message: worthSaying ? FREE_CUP_COPY.NOT_ELIGIBLE : null, audit: false,
    };
  }
  if (!input.weekdayDate) {
    // A Saturday or Sunday is simply not a free-cup day — say so, rather than
    // asking for a session that would not make it one.
    return {
      status: "refused", code: "NOT_ELIGIBLE", reason: "not_weekday",
      message: FREE_CUP_COPY.NOT_ELIGIBLE, audit: false,
    };
  }
  if (!input.sessionOpen) {
    // PRD S1 NO_SESSION: "No opening_sessions row for today". createOrder is
    // not blocked (out of scope) — the free cup just cannot be resolved.
    return {
      status: "refused", code: "NO_SESSION", reason: "no_session",
      message: FREE_CUP_COPY.NO_SESSION, audit: lineIndex !== null,
    };
  }
  if (!input.weekday) {
    return {
      status: "refused", code: "NOT_ELIGIBLE", reason: "not_weekday",
      message: FREE_CUP_COPY.NOT_ELIGIBLE, audit: false,
    };
  }
  if (lineIndex === null) {
    // L03: "Ineligible-category attempts are rejected … and audited."
    return {
      status: "refused", code: "NOT_ELIGIBLE", reason: "no_eligible_item",
      message: FREE_CUP_COPY.NOT_ELIGIBLE, audit: true,
    };
  }
  if (input.alreadyClaimed) {
    return {
      status: "refused", code: "ENTITLEMENT_USED", reason: "already_claimed",
      message: FREE_CUP_COPY.ENTITLEMENT_USED, audit: true,
    };
  }
  // One unit of one line: that line's snapshotted unit_price_zar, never more.
  // PRD L2837 (line_unit_price incl. priced extras) conflicts with the L2488 CHECK; unit_price_zar only = owner ruling 10 Oct 2026, pending Nikao.
  return { status: "apply", lineIndex, discountZar: input.lines[lineIndex].unitPriceZar };
}
