// AT-209 — the L33 comp, decided as a pure function (PRD v7.0 L33, L41, §11.2
// compOrderLine, REQ-059, REQ-152, DEF-A, DEF-B). All money is integer cents;
// nothing here multiplies by 100 or rounds.
//
// L33: "A barista may comp a single order line to R0, with a reason from the
// closed list wrong_drink · wrong_charge · spillage · staff_error · goodwill ·
// donation … at most once per order, and never above
// min(line_gross − discount_zar, (highest live menu price + (T15 − 2) ×
// extra_shot_zar) × quantity)."
//
// The comp takes the line to R0, so its value is the line's REMAINING value,
// line_gross − discount_zar (DEF-B), and the second term is the cap that value
// may not exceed. line_gross = quantity × line_unit_price, where the line unit
// price is the listed price plus the priced modifications (order_items
// unit_price_zar + mods_zar — the same sum the DB CHECK
// order_items_discount_within_line reads). The extra-shot surcharge column is
// not built yet (AT-202); when it lands it joins the unit price here.

/** L33's closed list — the comp_reason enum, "the definition of record". */
export const COMP_REASONS = [
  "wrong_drink",
  "wrong_charge",
  "spillage",
  "staff_error",
  "goodwill",
  "donation",
] as const;
export type CompReason = (typeof COMP_REASONS)[number];

/** L33: "At most two comps per barista per session; a third requires an admin PIN." */
export const COMPS_PER_SESSION_WITHOUT_PIN = 2;

/** PRD §10.4 defaults, used only when app_config holds no value. */
export const DEFAULT_MAX_SHOTS_PER_LINE = 4; // T15
export const DEFAULT_EXTRA_SHOT_ZAR = 1000; // T09, R10

export type CompLine = {
  quantity: number;
  unitPriceZar: number;
  modsZar: number;
  discountZar: number;
  compReason: string | null;
};

export type CompRefusalCode = "COMP_LIMIT" | "VALIDATION";

export type CompDecision =
  | { status: "apply"; valueZar: number; ceilingZar: number }
  | { status: "refused"; code: CompRefusalCode; reason: string; message: string };

export const COMP_COPY = {
  /** PRD §6.0.1 COMP_LIMIT copy, verbatim. */
  COMP_LIMIT: "Comp limit reached — needs an admin",
  already_discounted: "This line already carries a free cup or a voucher — it can't be comped as well.",
  nothing_to_comp: "This line has nothing left to comp.",
  over_ceiling: "This line is worth more than a comp can cover.",
} as const;

/** line_gross = quantity × (listed price + priced modifications), integer cents. */
export function lineGrossZar(line: Pick<CompLine, "quantity" | "unitPriceZar" | "modsZar">): number {
  return line.quantity * (line.unitPriceZar + line.modsZar);
}

/**
 * L33's ceiling: min(line_gross − discount_zar,
 *   (highest live menu price + (T15 − 2) × extra_shot_zar) × quantity).
 */
export function compCeilingZar(input: {
  line: Pick<CompLine, "quantity" | "unitPriceZar" | "modsZar" | "discountZar">;
  highestLivePriceZar: number;
  maxShotsPerLine: number;
  extraShotZar: number;
}): number {
  const remaining = lineGrossZar(input.line) - input.line.discountZar;
  const menuCap =
    (input.highestLivePriceZar + (input.maxShotsPerLine - 2) * input.extraShotZar) * input.line.quantity;
  return Math.min(remaining, menuCap);
}

/**
 * Decide one comp. `orderHasComp` is true when any line on the order already
 * carries a comp ("at most once per order" → COMP_LIMIT, PRD §6.0.1 "L33's
 * per-order … comp ceiling reached"). The per-session count and its admin PIN
 * are the caller's, because they need the database and the PIN.
 */
export function decideComp(input: {
  line: CompLine;
  orderHasComp: boolean;
  highestLivePriceZar: number;
  maxShotsPerLine: number;
  extraShotZar: number;
}): CompDecision {
  const { line } = input;
  if (input.orderHasComp || line.compReason !== null) {
    return { status: "refused", code: "COMP_LIMIT", reason: "order_already_comped", message: COMP_COPY.COMP_LIMIT };
  }
  // L41: one discount mechanism per line. On this line discount_zar is written
  // only by the L03 entitlement or a §6.9 voucher, so any discount refuses.
  if (line.discountZar > 0) {
    return { status: "refused", code: "VALIDATION", reason: "line_already_discounted", message: COMP_COPY.already_discounted };
  }
  const valueZar = lineGrossZar(line) - line.discountZar;
  if (valueZar <= 0) {
    return { status: "refused", code: "VALIDATION", reason: "nothing_to_comp", message: COMP_COPY.nothing_to_comp };
  }
  const ceilingZar = compCeilingZar(input);
  if (valueZar > ceilingZar) {
    return { status: "refused", code: "VALIDATION", reason: "over_ceiling", message: COMP_COPY.over_ceiling };
  }
  return { status: "apply", valueZar, ceilingZar };
}
