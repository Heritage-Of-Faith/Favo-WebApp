// Stock deduction — task G9
// Deducts ingredients from inventory lots when an order moves to `in_progress`.
// Called inside a db.transaction() so deduction + order state change are atomic.
//
// Business rules enforced:
//   L01 — deduction happens on in_progress, not on order creation
//   L08 — every deduction writes an audit row
//   R5  — SELECT FOR UPDATE prevents concurrent double-spend
//
// Docs: docs/API.md → transitionOrder · docs/BUSINESS_RULES.md L01 L08 R5

import { eq, sql } from "drizzle-orm";
import {
  orderItems,
  menuItems,
  recipeIngredients,
  inventoryItems,
  inventoryLots,
  stockMovements,
} from "@db/schema";
import type { DB } from "@/lib/db";
import { writeAudit } from "@/server/audit";
import {
  pickActiveLot,
  pickOpenContainer,
  willDepleteLot,
  DeductionError,
} from "@/server/inventory/lot-picker";

// Re-export so callers only need one import
export { DeductionError };

// ─── deductForOrder ───────────────────────────────────────────────────────────

/**
 * Deducts inventory for every recipe ingredient in every order item.
 *
 * Must be called inside a `db.transaction()` block.  On any error the
 * transaction rolls back, leaving both the order state and stock unchanged.
 *
 * Two deduction modes, branched per ingredient on the inventory item's unit:
 *   - Container items (unit='cup' → milk & beans): deduct ONE cup per drink from
 *     the OPEN container, auto-opening the next sealed one as needed. The recipe
 *     quantity is ignored — a drink consumes one cup of milk and/or beans.
 *   - All other items (cups, lids, powder): deduct `quantity × orderQty` in the
 *     item's own unit from the FIFO-oldest active lot, as before.
 *
 * Throws `DeductionError` (caught by `transitionOrder`) when:
 *   - An order item's menu item has no recipe (skipped — food items allowed)
 *   - No active lot exists for an ingredient        → code NO_ACTIVE_LOT
 *   - Lot/container has insufficient stock          → code OUT_OF_STOCK
 */
export async function deductForOrder(
  orderId: string,
  tx: DB,
  staffId: string
): Promise<void> {
  // 1. Load order items joined to menu_items for the recipe_id
  const lines = await tx
    .select({
      orderItemId: orderItems.id,
      menuItemId: orderItems.menuItemId,
      orderQty: orderItems.quantity,
      recipeId: menuItems.recipeId,
    })
    .from(orderItems)
    .innerJoin(menuItems, eq(orderItems.menuItemId, menuItems.id))
    .where(eq(orderItems.orderId, orderId));

  if (lines.length === 0) return; // Nothing to deduct (should not happen in practice)

  for (const line of lines) {
    if (!line.recipeId) {
      // Food / merchandise items have no recipe — no inventory to deduct.
      continue;
    }

    // 2. Load recipe ingredients for this item, joined to the inventory item so
    //    we know its authoritative unit (cup = container model) and kind.
    const ingredients = await tx
      .select({
        inventoryItemId: recipeIngredients.inventoryItemId,
        quantity: recipeIngredients.quantity,
        itemUnit: inventoryItems.unit,
      })
      .from(recipeIngredients)
      .innerJoin(
        inventoryItems,
        eq(recipeIngredients.inventoryItemId, inventoryItems.id)
      )
      .where(eq(recipeIngredients.recipeId, line.recipeId));

    for (const ing of ingredients) {
      if (ing.itemUnit === "cup") {
        // ── Container model (milk & beans): one cup per drink ──────────────────
        await deductCups(ing.inventoryItemId, line.orderQty, orderId, staffId, tx);
      } else {
        // ── Quantity model (cups, lids, powder): unchanged ─────────────────────
        await deductQuantity(
          ing.inventoryItemId,
          ing.quantity * line.orderQty,
          ing.itemUnit,
          orderId,
          staffId,
          tx
        );
      }
    }
  }

  // 8. Notify POS clients to refresh stock badges (M9 — non-blocking)
  await tx.execute(
    sql`SELECT pg_notify('inventory_changes', ${JSON.stringify({ orderId })})`
  );
}

// ─── deductCups (container model) ──────────────────────────────────────────────

/**
 * Deducts `cups` (one per drink) from the open container for `inventoryItemId`,
 * spanning into the next container if the open one runs out mid-order. Closes a
 * container the moment it empties so the POS never shows an empty open container.
 */
async function deductCups(
  inventoryItemId: string,
  cups: number,
  orderId: string,
  staffId: string,
  tx: DB
): Promise<void> {
  let remaining = cups;
  while (remaining > 0) {
    // Open container with ≥1 cup (opens the next sealed one as needed, or throws).
    const lot = await pickOpenContainer(inventoryItemId, tx);
    const take = Math.min(remaining, lot.currentStock);

    await tx.insert(stockMovements).values({
      inventoryLotId: lot.id,
      delta: -take,
      kind: "deduction",
      relatedOrderId: orderId,
      byStaffId: staffId,
    });

    const emptied = willDepleteLot(lot.currentStock, take);
    if (emptied) {
      await tx
        .update(inventoryLots)
        .set({ state: "closed", closedAt: sql`now()` })
        .where(eq(inventoryLots.id, lot.id));
    }

    await writeAudit(
      {
        entityKind: "inventory_lot",
        entityId: lot.id,
        action: "deduction",
        actorId: staffId,
        before: { cups: lot.currentStock },
        after: { cups: lot.currentStock - take, closed: emptied },
        reason: `order_deduction · order:${orderId}`,
      },
      tx
    );

    remaining -= take;
  }
}

// ─── deductQuantity (quantity model — cups, lids, powder) ───────────────────────

/** Deducts `needed` units from the FIFO-oldest active lot (the pre-container path). */
async function deductQuantity(
  inventoryItemId: string,
  needed: number,
  unit: string,
  orderId: string,
  staffId: string,
  tx: DB
): Promise<void> {
  const lot = await pickActiveLot(inventoryItemId, tx);

  if (lot.currentStock < needed) {
    throw new DeductionError(
      "OUT_OF_STOCK",
      `Insufficient stock for ${inventoryItemId}: ` +
        `need ${needed} ${unit}, have ${lot.currentStock} ${unit} in lot ${lot.id}.`
    );
  }

  await tx.insert(stockMovements).values({
    inventoryLotId: lot.id,
    delta: -needed,
    kind: "deduction",
    relatedOrderId: orderId,
    byStaffId: staffId,
  });

  if (willDepleteLot(lot.currentStock, needed)) {
    await tx
      .update(inventoryLots)
      .set({ state: "depleted" })
      .where(eq(inventoryLots.id, lot.id));
  }

  await writeAudit(
    {
      entityKind: "inventory_lot",
      entityId: lot.id,
      action: "deduction",
      actorId: staffId,
      before: { stock: lot.currentStock },
      after: {
        stock: lot.currentStock - needed,
        depleted: willDepleteLot(lot.currentStock, needed),
      },
      reason: `order_deduction · order:${orderId}`,
    },
    tx
  );
}
