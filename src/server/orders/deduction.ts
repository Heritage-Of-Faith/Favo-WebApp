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

import { eq, sql, inArray } from "drizzle-orm";
import {
  orderItems,
  menuItems,
  menuCustomisations,
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
 * AT-145: an order line's chosen customisations (orderItems.modifications) can
 * change what actually gets deducted, via two effect fields on
 * menu_customisations (mutually exclusive per row):
 *   - substitutesInventoryItemId: replaces whichever base recipe ingredient
 *     shares its inventory `kind` (e.g. Oat Milk replaces the recipe's milk
 *     ingredient, whatever that is) — a recipe has at most one ingredient per
 *     kind, so this is unambiguous.
 *   - addsInventoryItemId + addsQuantity: deducts extra units on top of the
 *     base recipe, once per occurrence in `modifications` (so 3 Extra Shot
 *     selections deduct 3×addsQuantity, not 1×).
 * A customisation with neither field (e.g. Decaf) has no deduction effect.
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
      modifications: orderItems.modifications,
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

    const mods = (line.modifications as OrderModification[] | null) ?? [];
    const modIds = mods.map((m) => m.id);

    // 2. Resolve the chosen customisations' inventory effects (substitution
    //    target kind + addition target/quantity), if any were selected.
    const modRows = modIds.length
      ? await tx
          .select({
            id: menuCustomisations.id,
            substitutesInventoryItemId: menuCustomisations.substitutesInventoryItemId,
            addsInventoryItemId: menuCustomisations.addsInventoryItemId,
            addsQuantity: menuCustomisations.addsQuantity,
          })
          .from(menuCustomisations)
          .where(inArray(menuCustomisations.id, modIds))
      : [];
    const modById = new Map(modRows.map((m) => [m.id, m]));

    const effectInventoryIds = [
      ...modRows.map((m) => m.substitutesInventoryItemId),
      ...modRows.map((m) => m.addsInventoryItemId),
    ].filter((id): id is string => Boolean(id));
    const effectItemRows = effectInventoryIds.length
      ? await tx
          .select({ id: inventoryItems.id, kind: inventoryItems.kind, unit: inventoryItems.unit })
          .from(inventoryItems)
          .where(inArray(inventoryItems.id, effectInventoryIds))
      : [];
    const effectItemById = new Map(effectItemRows.map((r) => [r.id, r]));

    // kind → substitute inventory item id (a recipe has ≤1 ingredient per kind)
    const substituteByKind = new Map<string, string>();
    for (const row of modRows) {
      if (!row.substitutesInventoryItemId) continue;
      const kind = effectItemById.get(row.substitutesInventoryItemId)?.kind;
      if (kind) substituteByKind.set(kind, row.substitutesInventoryItemId);
    }

    // 3. Load recipe ingredients for this item, joined to the inventory item so
    //    we know its authoritative unit (cup = container model) and kind.
    const ingredients = await tx
      .select({
        inventoryItemId: recipeIngredients.inventoryItemId,
        quantity: recipeIngredients.quantity,
        itemUnit: inventoryItems.unit,
        itemKind: inventoryItems.kind,
      })
      .from(recipeIngredients)
      .innerJoin(
        inventoryItems,
        eq(recipeIngredients.inventoryItemId, inventoryItems.id)
      )
      .where(eq(recipeIngredients.recipeId, line.recipeId));

    for (const ing of ingredients) {
      const substituteId = substituteByKind.get(ing.itemKind);
      const effectiveInventoryItemId = substituteId ?? ing.inventoryItemId;
      // A substitute can have a DIFFERENT unit than the base ingredient it
      // replaces (e.g. dairy is container-tracked in cups, but Oat/Almond/
      // Macadamia Milk are tracked by volume in ml) — use its own unit, never
      // assume it matches the base.
      const effectiveUnit = substituteId
        ? effectItemById.get(substituteId)?.unit
        : ing.itemUnit;

      if (!effectiveUnit) {
        // Should be unreachable (every id in substituteByKind was resolved
        // from effectItemById above) — fail loudly rather than silently
        // deduct the wrong thing, which is the exact bug this fixes.
        throw new DeductionError(
          "NO_ACTIVE_LOT",
          `Could not resolve unit for substitute inventory item ${effectiveInventoryItemId}.`
        );
      }

      if (effectiveUnit === "cup") {
        // ── Container model (milk & beans): one cup per drink ──────────────────
        await deductCups(effectiveInventoryItemId, line.orderQty, orderId, staffId, tx);
      } else if (!substituteId) {
        // ── Quantity model (cups, lids, powder), no substitution: unchanged ────
        await deductQuantity(
          effectiveInventoryItemId,
          ing.quantity * line.orderQty,
          effectiveUnit,
          orderId,
          staffId,
          tx
        );
      } else {
        // A cup-tracked base ingredient (recipe quantity is meaningless for
        // cups — see container-model note above) substituted with a
        // non-cup-tracked item has no defined per-drink quantity today; a
        // customisation-level quantity would be needed to deduct this
        // correctly instead of guessing. Fail loudly instead of deducting an
        // arbitrary amount.
        throw new DeductionError(
          "NO_ACTIVE_LOT",
          `${effectiveInventoryItemId} substitutes a container-tracked ingredient but isn't itself ` +
            `cup-tracked — no defined per-drink quantity. Needs a customisation-level quantity field.`
        );
      }
    }

    // 4. Additive customisations (e.g. Extra Shot): one deduction per
    //    occurrence in `modifications`, so N selections deduct N times.
    for (const mod of mods) {
      const full = modById.get(mod.id);
      if (!full?.addsInventoryItemId) continue;
      const addItem = effectItemById.get(full.addsInventoryItemId);
      if (!addItem) continue;
      const addQty = (full.addsQuantity ?? 1) * line.orderQty;

      if (addItem.unit === "cup") {
        await deductCups(full.addsInventoryItemId, addQty, orderId, staffId, tx);
      } else {
        await deductQuantity(full.addsInventoryItemId, addQty, addItem.unit, orderId, staffId, tx);
      }
    }
  }

  // 8. Notify POS clients to refresh stock badges (M9 — non-blocking)
  await tx.execute(
    sql`SELECT pg_notify('inventory_changes', ${JSON.stringify({ orderId })})`
  );
}

type OrderModification = { id: string; name: string; priceDeltaZar: number };

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
