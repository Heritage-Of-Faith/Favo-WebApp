"use server";

// Public server actions — no auth required (customer PWA, landing page)
// Owner: Nikao (task N11 — AT-55)
// Docs: DESIGN.md · BUSINESS_RULES.md L04, L05 · DATA_MODEL.md

import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  menuItems,
  recipes,
  recipeIngredients,
  inventoryLots,
  stockMovements,
} from "@db/schema";
import type { ActionResult, MenuItem, MenuCategory } from "@/lib/types";

// ─── Types ────────────────────────────────────────────────────────────────────

export type MenuItemWithAvailability = MenuItem & {
  available: boolean;
  /** Human-friendly badge text for unavailable items. null when available. */
  unavailableLabel: string | null;
};

// ─── Pure availability logic (exported for unit testing) ─────────────────────

/**
 * Determine if a menu item is available based on ingredient stock.
 *
 * An item is available when ALL of its required ingredients have a net
 * stock total > 0 (SUM of stock_movements.delta across ALL lots).
 * If the item has no recipe (tea, food), it is always considered available.
 *
 * This function is pure / injectable so it can be unit-tested without a DB.
 *
 * @param ingredientStocks  Map of inventoryItemId => net stock (integer base units).
 *                          If an inventoryItemId is absent, it is treated as 0.
 * @param requiredIngredientIds  The inventory item IDs the recipe needs.
 *                               Empty array means no dependencies, so available.
 */
export function computeItemAvailability(
  ingredientStocks: Map<string, number>,
  requiredIngredientIds: string[]
): boolean {
  if (requiredIngredientIds.length === 0) return true;
  return requiredIngredientIds.every(
    (id) => (ingredientStocks.get(id) ?? 0) > 0
  );
}

// ─── DB helpers ───────────────────────────────────────────────────────────────

/**
 * Load the current net stock (SUM delta) for every inventory item that has
 * stock movements. Returns a Map keyed by inventory item ID.
 */
async function loadIngredientStocks(): Promise<Map<string, number>> {
  const rows = await db
    .select({
      inventoryItemId: inventoryLots.inventoryItemId,
      total: sql<number>`COALESCE(SUM(${stockMovements.delta}), 0)::int`,
    })
    .from(stockMovements)
    .innerJoin(inventoryLots, eq(stockMovements.inventoryLotId, inventoryLots.id))
    .groupBy(inventoryLots.inventoryItemId);

  const map = new Map<string, number>();
  for (const row of rows) {
    map.set(row.inventoryItemId, row.total);
  }
  return map;
}

/**
 * Load all active menu items with their recipe ingredient IDs.
 * Items without a recipe (teas, food) return an empty ingredients array.
 */
async function loadMenuWithIngredients(): Promise<
  Array<{
    id: string;
    name: string;
    category: string;
    currentPriceZar: number;
    active: boolean;
    recipeId: string | null;
    ingredientIds: string[];
  }>
> {
  const items = await db
    .select()
    .from(menuItems)
    .where(eq(menuItems.active, true))
    .orderBy(menuItems.category, menuItems.name);

  if (items.length === 0) return [];

  const allIngredients = await db
    .select({
      recipeId: recipeIngredients.recipeId,
      inventoryItemId: recipeIngredients.inventoryItemId,
    })
    .from(recipeIngredients)
    .innerJoin(recipes, eq(recipeIngredients.recipeId, recipes.id));

  const ingredientsByRecipe = new Map<string, string[]>();
  for (const row of allIngredients) {
    const list = ingredientsByRecipe.get(row.recipeId) ?? [];
    list.push(row.inventoryItemId);
    ingredientsByRecipe.set(row.recipeId, list);
  }

  return items.map((item) => ({
    id: item.id,
    name: item.name,
    category: item.category,
    currentPriceZar: item.currentPriceZar,
    active: item.active,
    recipeId: item.recipeId,
    ingredientIds: item.recipeId
      ? (ingredientsByRecipe.get(item.recipeId) ?? [])
      : [],
  }));
}

// ─── getPublicMenu ─────────────────────────────────────────────────────────────

/**
 * Return all active menu items with current availability.
 * Public — no auth required (L05: customer PWA is read-only, display only).
 *
 * Availability rule (AT-55):
 *   - Item has no recipe => always available (teas, food).
 *   - Item has a recipe => available only if ALL recipe ingredients have
 *     net stock > 0 (SUM stockMovements.delta across ALL lots).
 *
 * Badge copy is warm and hospitable.
 * "Back tomorrow" when a tracked ingredient ran out (typical FAVO restock).
 * "Sold out for today" as defensive fallback.
 */
export async function getPublicMenu(): Promise<
  ActionResult<MenuItemWithAvailability[]>
> {
  try {
    const [menuWithIngredients, ingredientStocks] = await Promise.all([
      loadMenuWithIngredients(),
      loadIngredientStocks(),
    ]);

    const data: MenuItemWithAvailability[] = menuWithIngredients.map((item) => {
      const available = computeItemAvailability(
        ingredientStocks,
        item.ingredientIds
      );

      let unavailableLabel: string | null = null;
      if (!available) {
        unavailableLabel =
          item.recipeId !== null ? "Back tomorrow" : "Sold out for today";
      }

      return {
        id: item.id,
        name: item.name,
        category: item.category as MenuCategory,
        currentPriceZar: item.currentPriceZar,
        active: item.active,
        customisations: [],
        available,
        unavailableLabel,
      };
    });

    return { ok: true, data };
  } catch (err) {
    // Never forward raw error text to a public (unauthenticated) caller — it can
    // leak DB/internal details. Log server-side, return a fixed user-safe message.
    console.error("getPublicMenu failed", err);
    return {
      ok: false,
      code: "INTERNAL_ERROR",
      message: "Could not load the menu right now.",
    };
  }
}
