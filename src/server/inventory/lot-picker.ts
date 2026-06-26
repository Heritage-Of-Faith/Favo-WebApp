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

// ─── lotRunningStock ──────────────────────────────────────────────────────────

/** Running stock for a single lot = SUM(stock_movements.delta). */
async function lotRunningStock(lotId: string, tx: DB): Promise<number> {
  const [row] = await tx
    .select({ total: sql<number>`COALESCE(SUM(${stockMovements.delta}), 0)::int` })
    .from(stockMovements)
    .where(eq(stockMovements.inventoryLotId, lotId));
  return row?.total ?? 0;
}

// ─── pickOpenContainer ────────────────────────────────────────────────────────

/**
 * Container model (milk & beans): returns the currently-OPEN container for
 * `inventoryItemId` with cups remaining ≥ 1, opening the FIFO-oldest sealed
 * container if none is open or the open one is empty.
 *
 * No-delay guarantee: an empty/absent open container does not block the order —
 * the next sealed bottle/bag is opened automatically inside the same transaction.
 *
 * Concurrency: a per-item transaction advisory lock serialises the open-container
 * resolution so two simultaneous orders can't each open a fresh container (the
 * partial unique index `uq_one_open_lot_per_item` is the hard backstop). The lock
 * is released automatically when the transaction ends.
 *
 * Throws `DeductionError('OUT_OF_STOCK', ...)` only when no sealed container
 * remains to open.
 */
export async function pickOpenContainer(
  inventoryItemId: string,
  tx: DB
): Promise<ActiveLot> {
  // Serialise open-container resolution for this item across concurrent txns.
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtext(${"open_container:" + inventoryItemId}))`
  );

  // 1. Is there an open container? Lock it for the duration of the txn.
  const openRows = await tx
    .select({ id: inventoryLots.id })
    .from(inventoryLots)
    .where(
      and(
        eq(inventoryLots.inventoryItemId, inventoryItemId),
        eq(inventoryLots.state, "open")
      )
    )
    .limit(1)
    .for("update");

  if (openRows.length > 0) {
    const openId = openRows[0].id;
    const stock = await lotRunningStock(openId, tx);
    if (stock >= 1) {
      return { id: openId, currentStock: stock };
    }
    // Open container is empty — retire it, then open the next sealed one.
    await tx
      .update(inventoryLots)
      .set({ state: "closed", closedAt: sql`now()` })
      .where(eq(inventoryLots.id, openId));
  }

  // 2. Open the FIFO-oldest sealed (active) container.
  const sealed = await tx
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

  if (sealed.length === 0) {
    throw new DeductionError(
      "OUT_OF_STOCK",
      `No sealed container left to open for inventory item ${inventoryItemId}`
    );
  }

  const newId = sealed[0].id;
  await tx
    .update(inventoryLots)
    .set({ state: "open", openedAt: sql`now()` })
    .where(eq(inventoryLots.id, newId));

  const stock = await lotRunningStock(newId, tx);
  return { id: newId, currentStock: stock };
}
