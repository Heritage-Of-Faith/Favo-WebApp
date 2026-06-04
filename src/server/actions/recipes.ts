"use server";

// Recipe server actions — Phase 2 (G8 seed / A11 UI)
// getRecipe: no auth (read-only; menu is public-ish).
// updateRecipeIngredient, bumpRecipeVersion: admin+ only.
// Docs: docs/API.md · docs/DATA_MODEL.md · recipes, recipe_ingredients

import type { ActionResult, RecipeDetail, InventoryUnit } from "@/lib/types";

// ─── Fixture data ─────────────────────────────────────────────────────────────

const FIXTURE_RECIPES: RecipeDetail[] = [
  {
    id: "recipe_espresso",
    menuItemId: "menu_espresso",
    menuItemName: "Espresso",
    version: 1,
    ingredients: [
      {
        id: "ri_recipe_espresso_0",
        inventoryItemId: "inv_item_espresso_beans",
        inventoryItemName: "Espresso Beans",
        quantity: 7,
        unit: "g",
        tolerancePct: 10,
      },
      {
        id: "ri_recipe_espresso_1",
        inventoryItemId: "inv_item_cup_8oz",
        inventoryItemName: "8 oz Cup",
        quantity: 1,
        unit: "unit",
        tolerancePct: 0,
      },
    ],
  },
  {
    id: "recipe_cappuccino",
    menuItemId: "menu_cappuccino",
    menuItemName: "Cappuccino",
    version: 1,
    ingredients: [
      {
        id: "ri_recipe_cappuccino_0",
        inventoryItemId: "inv_item_espresso_beans",
        inventoryItemName: "Espresso Beans",
        quantity: 7,
        unit: "g",
        tolerancePct: 10,
      },
      {
        id: "ri_recipe_cappuccino_1",
        inventoryItemId: "inv_item_whole_milk",
        inventoryItemName: "Full-Cream Milk",
        quantity: 150,
        unit: "ml",
        tolerancePct: 10,
      },
      {
        id: "ri_recipe_cappuccino_2",
        inventoryItemId: "inv_item_cup_8oz",
        inventoryItemName: "8 oz Cup",
        quantity: 1,
        unit: "unit",
        tolerancePct: 0,
      },
      {
        id: "ri_recipe_cappuccino_3",
        inventoryItemId: "inv_item_lid",
        inventoryItemName: "Cup Lid",
        quantity: 1,
        unit: "unit",
        tolerancePct: 0,
      },
    ],
  },
  {
    id: "recipe_latte",
    menuItemId: "menu_latte",
    menuItemName: "Latte",
    version: 1,
    ingredients: [
      {
        id: "ri_recipe_latte_0",
        inventoryItemId: "inv_item_espresso_beans",
        inventoryItemName: "Espresso Beans",
        quantity: 7,
        unit: "g",
        tolerancePct: 10,
      },
      {
        id: "ri_recipe_latte_1",
        inventoryItemId: "inv_item_whole_milk",
        inventoryItemName: "Full-Cream Milk",
        quantity: 200,
        unit: "ml",
        tolerancePct: 10,
      },
      {
        id: "ri_recipe_latte_2",
        inventoryItemId: "inv_item_cup_12oz",
        inventoryItemName: "12 oz Cup",
        quantity: 1,
        unit: "unit",
        tolerancePct: 0,
      },
      {
        id: "ri_recipe_latte_3",
        inventoryItemId: "inv_item_lid",
        inventoryItemName: "Cup Lid",
        quantity: 1,
        unit: "unit",
        tolerancePct: 0,
      },
    ],
  },
  {
    id: "recipe_mocha",
    menuItemId: "menu_mocha",
    menuItemName: "Mocha",
    version: 1,
    ingredients: [
      {
        id: "ri_recipe_mocha_0",
        inventoryItemId: "inv_item_espresso_beans",
        inventoryItemName: "Espresso Beans",
        quantity: 7,
        unit: "g",
        tolerancePct: 10,
      },
      {
        id: "ri_recipe_mocha_1",
        inventoryItemId: "inv_item_hot_choc_powder",
        inventoryItemName: "Hot Chocolate Powder",
        quantity: 20,
        unit: "g",
        tolerancePct: 10,
      },
      {
        id: "ri_recipe_mocha_2",
        inventoryItemId: "inv_item_whole_milk",
        inventoryItemName: "Full-Cream Milk",
        quantity: 160,
        unit: "ml",
        tolerancePct: 10,
      },
      {
        id: "ri_recipe_mocha_3",
        inventoryItemId: "inv_item_cup_12oz",
        inventoryItemName: "12 oz Cup",
        quantity: 1,
        unit: "unit",
        tolerancePct: 0,
      },
      {
        id: "ri_recipe_mocha_4",
        inventoryItemId: "inv_item_lid",
        inventoryItemName: "Cup Lid",
        quantity: 1,
        unit: "unit",
        tolerancePct: 0,
      },
    ],
  },
];

// ─── getRecipe ────────────────────────────────────────────────────────────────

/**
 * Returns the latest recipe for a menu item (highest version number).
 * No auth required (read-only; used by G9 deduction and A11 UI).
 * TODO (P2 post-G8): replace fixture with real DB query joining
 *   menu_items → recipes → recipe_ingredients → inventory_items.
 */
export async function getRecipe(
  menuItemId: string
): Promise<ActionResult<{ recipe: RecipeDetail | null }>> {
  const recipe = FIXTURE_RECIPES.find((r) => r.menuItemId === menuItemId) ?? null;
  return { ok: true, data: { recipe } };
}

// ─── listRecipes ──────────────────────────────────────────────────────────────

/**
 * Returns all current recipes (one per active menu item, latest version).
 * No auth required.
 * TODO (P2 post-G8): real DB query.
 */
export async function listRecipes(): Promise<
  ActionResult<{ recipes: RecipeDetail[] }>
> {
  return { ok: true, data: { recipes: FIXTURE_RECIPES } };
}

// ─── updateRecipeIngredient ───────────────────────────────────────────────────

/**
 * Updates a single ingredient's quantity or tolerance (correction, not version
 * bump). Admin+ only. writeAudit on save.
 * TODO (P2 A11 sub-task): real implementation.
 */
export async function updateRecipeIngredient(
  ingredientId: string,
  update: {
    quantity?: number;
    unit?: InventoryUnit;
    tolerancePct?: number;
  }
): Promise<ActionResult> {
  void ingredientId;
  void update;
  throw new Error("Not implemented — Phase 2");
}

// ─── bumpRecipeVersion ────────────────────────────────────────────────────────

/**
 * Clones the recipe at version N to version N+1. Future orders use the new
 * version. The N+1 recipe starts as a draft — admin edits then publishes.
 * Admin+ only. writeAudit on bump.
 * TODO (P2 A11 sub-task): real implementation.
 */
export async function bumpRecipeVersion(
  menuItemId: string
): Promise<ActionResult<{ newRecipeId: string }>> {
  void menuItemId;
  throw new Error("Not implemented — Phase 2");
}
