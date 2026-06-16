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
  inventoryLots,
  stockMovements,
} from "@db/schema";
import type { DB } from "@/lib/db";
import { writeAudit } from "@/server/audit";
import {
  pickActiveLot,
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
 * Throws `DeductionError` (caught by `transitionOrder`) when:
 *   - An order item's menu item has no recipe (skipped — food items allowed)
 *   - No active lot exists for an ingredient        → code NO_ACTIVE_LOT
 *   - Active lot has insufficient running stock     → code OUT_OF_STOCK
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

    // 2. Load recipe ingredients for this item
    const ingredients = await tx
      .select({
        inventoryItemId: recipeIngredients.inventoryItemId,
        quantity: recipeIngredients.quantity,
        unit: recipeIngredients.unit,
      })
      .from(recipeIngredients)
      .where(eq(recipeIngredients.recipeId, line.recipeId));

    for (const ing of ingredients) {
      const needed = ing.quantity * line.orderQty;

      // 3. Lock the FIFO active lot (SELECT … FOR UPDATE)
      const lot = await pickActiveLot(ing.inventoryItemId, tx);

      // 4. Guard: enough stock in this lot?
      if (lot.currentStock < needed) {
        throw new DeductionError(
          "OUT_OF_STOCK",
          `Insufficient stock for ${ing.inventoryItemId}: ` +
            `need ${needed} ${ing.unit}, have ${lot.currentStock} ${ing.unit} in lot ${lot.id}.`
        );
      }

      // 5. Insert the deduction movement
      await tx.insert(stockMovements).values({
        inventoryLotId: lot.id,
        delta: -needed,
        kind: "deduction",
        relatedOrderId: orderId,
        byStaffId: staffId,
      });

      // 6. Deplete the lot if running stock hits zero
      if (willDepleteLot(lot.currentStock, needed)) {
        await tx
          .update(inventoryLots)
          .set({ state: "depleted" })
          .where(eq(inventoryLots.id, lot.id));
      }

      // 7. Audit every deduction (L08) — inside the transaction so it rolls
      //    back together with the deduction if anything fails downstream.
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
  }

  // 8. Notify POS clients to refresh stock badges (M9 — non-blocking)
  await tx.execute(
    sql`SELECT pg_notify('inventory_changes', ${JSON.stringify({ orderId })})`
  );
}
