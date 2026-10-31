// Admin input rules shared by the admin forms (client) and their server
// actions, so both sides refuse the same values with the same message.
//
// Bounds come from the column types, not from business guesses:
//   integer columns (`*_zar`, thresholds)  → Postgres int4 max
//   inventory_lots.unit_cost_zar           → numeric(10,4) max
//
// Unit cost convention — PRD v7 §7.0.2: unit_cost = lot.cost_zar / lot.yield_units,
// "cents to 4 decimal places, NOT rounded". So R225 for 500 g is
// 22500 c / 500 g = 45.0000 c/g (= R0.45 per g).

import { parseZar } from "@/lib/format";

export const INT4_MAX = 2_147_483_647;
/** Largest value numeric(10,4) can hold (6 integer digits, 4 decimals). */
export const UNIT_COST_MAX = 999_999.9999;
/** Largest value numeric(10,2) can hold (quantity_received, container_size). */
export const QUANTITY_MAX = 99_999_999.99;
/** Max length for a purchase source name (display + storage). */
export const SOURCE_NAME_MAX = 100;

export type Parsed<T> = { ok: true; value: T } | { ok: false; message: string };

/**
 * Cents paid ÷ base units received → cents per base unit, 4 dp string for
 * inventory_lots.unit_cost_zar. Refuses anything that would store 0.0000
 * (an ingredient must never silently become free) or overflow the column.
 */
export function deriveUnitCostCents(totalCents: number, quantity: number): Parsed<string> {
  if (!Number.isFinite(totalCents) || totalCents <= 0) {
    return { ok: false, message: "Enter what you paid (more than R0)." };
  }
  if (!Number.isFinite(quantity) || quantity <= 0) {
    return { ok: false, message: "Quantity must be greater than 0." };
  }
  const perUnit = totalCents / quantity;
  if (perUnit > UNIT_COST_MAX) {
    return { ok: false, message: "Cost per unit is too large. Check the total and the quantity." };
  }
  const value = perUnit.toFixed(4);
  if (Number(value) === 0) {
    return { ok: false, message: "Cost per unit rounds to R0. Check the total and the quantity." };
  }
  return { ok: true, value };
}

/** "45.0000" (cents per unit) → "R0.4500" (rands per unit), for display only. */
export function formatUnitCostRands(centsPerUnit: string): string {
  const n = Number(centsPerUnit);
  if (!Number.isFinite(n)) return "—";
  return `R${(n / 100).toFixed(4)}`;
}

/**
 * Admin recost of a lot. Input is cents per base unit (the column's unit).
 * Accepts "0.45" or "0,45". Refuses empty, 0, values that round to 0.0000,
 * negatives, text and anything numeric(10,4) cannot hold.
 */
export function parseLotUnitCost(input: string): Parsed<string> {
  const s = (input ?? "").trim().replace(",", ".");
  if (s === "") return { ok: false, message: "Enter a cost. An ingredient cannot be free." };
  if (!/^\d+(\.\d+)?$/.test(s)) {
    return { ok: false, message: "Cost must be a number greater than 0." };
  }
  const n = Number(s);
  if (!Number.isFinite(n) || n <= 0) {
    return { ok: false, message: "Cost must be a number greater than 0." };
  }
  if (n > UNIT_COST_MAX) {
    return { ok: false, message: `Cost is too large (max ${UNIT_COST_MAX} c per unit).` };
  }
  const value = n.toFixed(4);
  if (Number(value) === 0) {
    return { ok: false, message: "Cost rounds to 0.0000. An ingredient cannot be free." };
  }
  return { ok: true, value };
}

/** Rands string from a menu form → integer cents, refusing 0, >2 dp and overflow. */
export function parseMenuPriceCents(input: string): Parsed<number> {
  const cents = parseZar(input);
  if (cents === null || cents <= 0) {
    return { ok: false, message: "Enter a price greater than R0, e.g. 42.00." };
  }
  if (cents > INT4_MAX) {
    return { ok: false, message: "Price is too large." };
  }
  return { ok: true, value: cents };
}
