// AT-188 · REQ-101 · REQ-105 · REQ-106 · REQ-107 · PRD §7.0.2 L1754–1770,
// L1791–1795, L1852, L1856.
//
//   unit_cost   = lot.cost / lot.yield   -- 4 dp, NOT rounded (numeric(10,4))
//   line_cogs   = quantity × Σ( recipe_qty × unit_cost × shot_factor )
//   order_cogs  = round_half_up( Σ line_cogs )   -- THE ONE ROUNDING POINT
//
// The seed recipes already list the cup and the lid as ingredients, so the
// formula's `+ cup_cost + lid_cost` is those ingredient rows, counted once.
// Weekday orders draw no cup or lid (cup-lid.ts, REQ-125), so none is costed.
//
// Arithmetic is exact: every unit cost is held as an integer number of
// ten-thousandths of a cent (bigint), so the sum is exact and the single
// half-up rounding cannot be pushed the wrong way by a float landing on
// x.4999… (REQ-101: never a float).
//
// Refusal rule (§7.0.2 L1791–1795; owner: the "unavailable" state is only for a
// missing cost (NULL or 0)): when any consumed ingredient's lot cost is NULL or
// 0.0000, cogs_zar is NULL and the item is named — never a smaller number.
//
// Frozen at the sale (owner, 22 Oct 2026): the row is written once, in the
// deduction's transaction, from the cost of the lots actually drawn, and is
// never rewritten — ON CONFLICT DO NOTHING, and no update path exists.

import { inArray } from "drizzle-orm";
import { inventoryLots, orderCogs } from "@db/schema";
import type { DB } from "@/lib/db";

/** One lot a deduction drew from, in draw order. */
export type LotDraw = { lotId: string; units: number };

/**
 * One ingredient (or additive customisation) consumed by one order line.
 * `costUnits` is what §7.0.2 prices: quantity × recipe_qty × shot_factor
 * (container items — milk & beans — are one cup per drink, L17). `draws` are
 * the lots deductForOrder actually took stock from for it.
 */
export type Consumption = {
  inventoryItemId: string;
  costUnits: number;
  draws: LotDraw[];
};

/** A Consumption whose draws carry their lot's unit_cost_zar at the sale. */
export type CostedConsumption = {
  inventoryItemId: string;
  costUnits: number;
  draws: { units: number; unitCostZar: string | null }[];
};

export type OrderCogsResult = { cogsZar: number | null; absentItemIds: string[] };

/**
 * §7.0.2 L1760: shot_factor = order_items.shots for the COFFEE ingredient
 * (inventory kind 'bean'), 1 for every other ingredient.
 *
 * Local stand-in, on purpose: open PR #267 adds `shotFactor(kind, shots)` in
 * src/server/orders/shots.ts with the same rule. Named differently to avoid a
 * merge conflict; once #267 lands, replace this with an import of shotFactor.
 */
export function costShotFactor(
  itemKind: string | null | undefined,
  shots: number | null | undefined
): number {
  if (itemKind !== "bean") return 1;
  return typeof shots === "number" && Number.isInteger(shots) && shots >= 1 ? shots : 1;
}

const SCALE = 10000n; // ten-thousandths of a cent per cent

/** "529.4118" → 5294118n (ten-thousandths of a cent). Exact; never a float. */
export function parseUnitCost(value: string): bigint {
  const m = /^(\d+)(?:\.(\d{1,4}))?$/.exec(value.trim());
  if (!m) throw new Error(`order_cogs: unparseable unit_cost_zar "${value}"`);
  const frac = (m[2] ?? "").padEnd(4, "0");
  return BigInt(m[1]) * SCALE + BigInt(frac);
}

/**
 * Pure. Σ line_cogs in exact decimal, rounded once, half-up, to integer cents.
 *
 * DEF-G (§7.0.2 L1766–1769): each consumption's units are costed at the lot
 * each unit was drawn from, in draw order. Units beyond what was drawn (a
 * multi-shot line while deduction still takes one bean cup — fixed by PR #267)
 * are costed at the last lot drawn, the lot the next unit would come from.
 */
export function computeOrderCogs(items: readonly CostedConsumption[]): OrderCogsResult {
  let total = 0n;
  const absent = new Set<string>();

  for (const item of items) {
    let remaining = item.costUnits;
    if (remaining <= 0) continue;
    if (item.draws.length === 0) {
      absent.add(item.inventoryItemId); // consumed but no lot to cost it at
      continue;
    }
    item.draws.forEach((draw, i) => {
      const isLast = i === item.draws.length - 1;
      const take = isLast ? remaining : Math.min(remaining, draw.units);
      if (take <= 0) return;
      remaining -= take;
      const cost = draw.unitCostZar === null ? 0n : parseUnitCost(draw.unitCostZar);
      if (cost === 0n) {
        absent.add(item.inventoryItemId);
        return;
      }
      total += BigInt(take) * cost;
    });
  }

  if (absent.size > 0) return { cogsZar: null, absentItemIds: [...absent].sort() };
  // Half-up on a non-negative exact value: add one half, truncate.
  return { cogsZar: Number((total + SCALE / 2n) / SCALE), absentItemIds: [] };
}

/**
 * Writes the order's order_cogs row. Call inside the transaction that ran
 * deductForOrder, right after it succeeds, with what it returned: if the
 * deduction throws, this never runs and the rollback leaves no row.
 *
 * The lot costs are read now, in the same transaction, from the lots just
 * drawn (pickActiveLot / pickOpenContainer hold them FOR UPDATE), so the
 * figure is the cost in force at the sale. A second call for the same order
 * (a retried transition) writes nothing and never rewrites the first row.
 */
export async function writeOrderCogs(
  orderId: string,
  consumed: readonly Consumption[],
  tx: DB
): Promise<void> {
  const lotIds = [...new Set(consumed.flatMap((c) => c.draws.map((d) => d.lotId)))];
  const lots = lotIds.length
    ? await tx
        .select({ id: inventoryLots.id, unitCostZar: inventoryLots.unitCostZar })
        .from(inventoryLots)
        .where(inArray(inventoryLots.id, lotIds))
    : [];
  const costByLot = new Map(lots.map((l) => [l.id, l.unitCostZar]));

  const { cogsZar, absentItemIds } = computeOrderCogs(
    consumed.map((c) => ({
      inventoryItemId: c.inventoryItemId,
      costUnits: c.costUnits,
      draws: c.draws.map((d) => ({ units: d.units, unitCostZar: costByLot.get(d.lotId) ?? null })),
    }))
  );

  await tx
    .insert(orderCogs)
    .values({
      orderId,
      cogsZar,
      absentItemIds,
      // NULL = unknown: inventory_lots.cost_source arrives with AT-191. Never
      // defaulted to true or false (§10.6).
      estimated: null,
    })
    .onConflictDoNothing({ target: orderCogs.orderId });
}
