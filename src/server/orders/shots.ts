// AT-182 · REQ-137 · DEC-09 · PRD §7.0.2 shot_factor, §10.5(3).
//
// §7.0.2: "shot_factor = order_items.shots for the COFFEE ingredient, 1 for
// every other ingredient" — coffee × shots, same cup, same lid, same milk.
// Read by stock deduction (deduction.ts) and the pre-payment stock gate
// (lot-picker.ts checkRecipeStock); line_cogs reads it in AT-188.
//
// The coffee ingredient is the recipe ingredient of inventory kind 'bean'.
// order_items.shots is NOT NULL DEFAULT 1 with CHECK BETWEEN 1 AND 4, so a
// value below 1 (or absent) only comes from a caller that did not read the
// column — it counts as one shot.

/** The inventory kind that holds the coffee. */
export const COFFEE_KIND = "bean";

export function shotFactor(itemKind: string | null | undefined, shots: number | null | undefined): number {
  if (itemKind !== COFFEE_KIND) return 1;
  return typeof shots === "number" && Number.isInteger(shots) && shots >= 1 ? shots : 1;
}
