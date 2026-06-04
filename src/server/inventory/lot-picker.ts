// Lot picker — task G9
// Selects the active inventory lot for a given item using FIFO (earliest
// received_at).  Called inside a Drizzle transaction with SELECT … FOR UPDATE
// to prevent the double-spend race described in BUSINESS_RULES.md R5.
//
// Pure helper for unit tests:
//   willDepleteLot(currentStock, needed) → boolean
//   DeductionError                        → typed error for OUT_OF_STOCK

import { eq, and, asc, sql } from "drizzle-orm";
import { inventoryLots, stockMovements } from "@db/schema";
import type { DB } from "@/lib/db";

// ─── Exported pure helpers ────────────────────────────────────────────────────

/**
 * Returns true when deducting `needed` from `currentStock` leaves ≤ 0 units.
 * Pure — safe to unit-test without a DB.
 */
export function willDepleteLot(currentStock: number, needed: number): boolean {
  return currentStock - needed <= 0;
}

// ─── DeductionError ───────────────────────────────────────────────────────────

/**
 * Thrown inside a transaction when stock cannot be fulfilled.
 * The caller catches this, rolls back, and returns a structured ActionResult.
 */
export class DeductionError extends Error {
  constructor(
    public readonly code: "OUT_OF_STOCK" | "NO_ACTIVE_LOT",
    message: string
  ) {
    super(message);
    this.name = "DeductionError";
  }
}

// ─── pickActiveLot ────────────────────────────────────────────────────────────

export type ActiveLot = {
  id: string;
  currentStock: number;
};

/**
 * Finds the FIFO-oldest active lot for `inventoryItemId` and returns its id
 * plus current running stock (SUM of stock_movements.delta).
 *
 * Uses SELECT … FOR UPDATE on the lot row to serialise concurrent transactions
 * and prevent the double-spend race (R5).
 *
 * Must be called inside a `db.transaction()` block — passing the transaction
 * object as `tx` ensures the lock is held for the duration of the txn.
 *
 * Throws `DeductionError('NO_ACTIVE_LOT', ...)` if no active lot exists.
 */
export async function pickActiveLot(
  inventoryItemId: string,
  tx: DB
): Promise<ActiveLot> {
  // FIFO: oldest lot first, locked for update
  const rows = await tx
    .select({ id: inventoryLots.id })
    .from(inventoryLots)
    .where(
      and(
        eq(inventoryLots.inventoryItemId, inventoryItemId),
        eq(inventoryLots.state, "active")
      )
    )
    .orderBy(asc(inventoryLots.receivedAt))
    .limit(1)
    .for("update");

  if (rows.length === 0) {
    throw new DeductionError(
      "NO_ACTIVE_LOT",
      `No active lot for inventory item ${inventoryItemId}`
    );
  }

  const lotId = rows[0].id;

  // Running stock = SUM of all delta movements for this lot
  const [stockRow] = await tx
    .select({
      total: sql<number>`COALESCE(SUM(${stockMovements.delta}), 0)::int`,
    })
    .from(stockMovements)
    .where(eq(stockMovements.inventoryLotId, lotId));

  return {
    id: lotId,
    currentStock: stockRow?.total ?? 0,
  };
}
