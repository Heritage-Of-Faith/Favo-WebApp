// Order pricing — task G5
// All money is integer cents (ZAR). Never floats, never `numeric`.
// These are pure functions so the POS and the server compute identical totals.

export type PricedModification = { priceDeltaZar: number };

export type PricedLine = {
  unitPriceZar: number;
  quantity: number;
  modifications: PricedModification[];
};

/** Unit price including modification deltas (one unit, all mods applied once). */
export function computeUnitPriceZar(
  unitPriceZar: number,
  modifications: PricedModification[]
): number {
  const mods = modifications.reduce((sum, m) => sum + m.priceDeltaZar, 0);
  return unitPriceZar + mods;
}

/** Line total = (unit price + mods) × quantity. */
export function computeLineTotalZar(line: PricedLine): number {
  return computeUnitPriceZar(line.unitPriceZar, line.modifications) * line.quantity;
}

/** Order total = sum of all line totals. Integer cents. */
export function computeOrderTotalZar(lines: PricedLine[]): number {
  return lines.reduce((sum, line) => sum + computeLineTotalZar(line), 0);
}
