// Order pricing — task G5
// All money is integer cents (ZAR). Never floats, never `numeric`.
// These are pure functions so the POS and the server compute identical totals.
// PRD v7.0 §7.0.2: line_unit_price = unit_price_zar + line_mods_zar + surcharge_zar
// (all PER UNIT); line_gross = quantity × line_unit_price.

export type PricedModification = { priceDeltaZar: number };

export type PricedLine = {
  unitPriceZar: number;
  quantity: number;
  modifications: PricedModification[];
  /** AT-202: the extra-shot surcharge for ONE unit (§7.0.2 surcharge_zar). Absent = 0. */
  surchargeZar?: number;
};

/** Unit price including modification deltas (one unit, all mods applied once). */
export function computeUnitPriceZar(
  unitPriceZar: number,
  modifications: PricedModification[]
): number {
  const mods = modifications.reduce((sum, m) => sum + m.priceDeltaZar, 0);
  return unitPriceZar + mods;
}

/** Line total = (unit price + mods + per-unit surcharge) × quantity. */
export function computeLineTotalZar(line: PricedLine): number {
  return (computeUnitPriceZar(line.unitPriceZar, line.modifications) + (line.surchargeZar ?? 0)) * line.quantity;
}

/** Order total = sum of all line totals. Integer cents. */
export function computeOrderTotalZar(lines: PricedLine[]): number {
  return lines.reduce((sum, line) => sum + computeLineTotalZar(line), 0);
}
