// Recipes seed — task G8 (Phase 2)
// One recipe (version 1) per trackable menu item, with recipe_ingredients.
// Food items (croissant, muffin, toastie) and teas are excluded — their COGS
// comes from purchase invoices, not the ingredient-level deduction model.
//
// Quantities are "standard serving" (single-shot small):
//   Espresso dose: 7g beans (single shot per plan spec)
//   Milk steamed:  per-drink spec (cappuccino 150ml, latte 200ml, etc.)
//
// After inserting recipes, updates menu_items.recipe_id so deduction (G9)
// can look up the recipe via the order → menu item → recipe chain.
//
// Docs: DATA_MODEL.md · API.md getRecipe · BUSINESS_RULES.md L01

import { eq } from "drizzle-orm";
import { db } from "../index";
import { recipes, recipeIngredients, menuItems } from "../schema";

type IngredientSpec = {
  inventoryItemId: string;
  quantity: number; // integer, in the item's unit (g, ml, or unit)
  unit: "g" | "kg" | "ml" | "l" | "unit" | "bag";
  tolerancePct: number; // acceptable variance % before flagging
};

type RecipeSpec = {
  id: string;
  menuItemId: string;
  ingredients: IngredientSpec[];
};

// Ingredient shorthand
const BEANS = "inv_item_espresso_beans";
const WHOLE_MILK = "inv_item_whole_milk";
const CUP_8OZ = "inv_item_cup_8oz";
const CUP_12OZ = "inv_item_cup_12oz";
const LID = "inv_item_lid";
const HOT_CHOC = "inv_item_hot_choc_powder";

export const RECIPES: RecipeSpec[] = [
  // ── Espresso ──────────────────────────────────────────────────────────────
  {
    id: "recipe_espresso",
    menuItemId: "menu_espresso",
    ingredients: [
      { inventoryItemId: BEANS, quantity: 7, unit: "g", tolerancePct: 10 },
      { inventoryItemId: CUP_8OZ, quantity: 1, unit: "unit", tolerancePct: 0 },
    ],
  },

  // ── Americano ─────────────────────────────────────────────────────────────
  {
    id: "recipe_americano",
    menuItemId: "menu_americano",
    ingredients: [
      { inventoryItemId: BEANS, quantity: 7, unit: "g", tolerancePct: 10 },
      { inventoryItemId: CUP_8OZ, quantity: 1, unit: "unit", tolerancePct: 0 },
    ],
  },

  // ── Cappuccino ────────────────────────────────────────────────────────────
  {
    id: "recipe_cappuccino",
    menuItemId: "menu_cappuccino",
    ingredients: [
      { inventoryItemId: BEANS, quantity: 7, unit: "g", tolerancePct: 10 },
      { inventoryItemId: WHOLE_MILK, quantity: 150, unit: "ml", tolerancePct: 10 },
      { inventoryItemId: CUP_8OZ, quantity: 1, unit: "unit", tolerancePct: 0 },
      { inventoryItemId: LID, quantity: 1, unit: "unit", tolerancePct: 0 },
    ],
  },

  // ── Flat White ────────────────────────────────────────────────────────────
  {
    id: "recipe_flat_white",
    menuItemId: "menu_flat_white",
    ingredients: [
      { inventoryItemId: BEANS, quantity: 7, unit: "g", tolerancePct: 10 },
      { inventoryItemId: WHOLE_MILK, quantity: 130, unit: "ml", tolerancePct: 10 },
      { inventoryItemId: CUP_8OZ, quantity: 1, unit: "unit", tolerancePct: 0 },
      { inventoryItemId: LID, quantity: 1, unit: "unit", tolerancePct: 0 },
    ],
  },

  // ── Latte ─────────────────────────────────────────────────────────────────
  {
    id: "recipe_latte",
    menuItemId: "menu_latte",
    ingredients: [
      { inventoryItemId: BEANS, quantity: 7, unit: "g", tolerancePct: 10 },
      { inventoryItemId: WHOLE_MILK, quantity: 200, unit: "ml", tolerancePct: 10 },
      { inventoryItemId: CUP_12OZ, quantity: 1, unit: "unit", tolerancePct: 0 },
      { inventoryItemId: LID, quantity: 1, unit: "unit", tolerancePct: 0 },
    ],
  },

  // ── Cortado ───────────────────────────────────────────────────────────────
  {
    id: "recipe_cortado",
    menuItemId: "menu_cortado",
    ingredients: [
      { inventoryItemId: BEANS, quantity: 7, unit: "g", tolerancePct: 10 },
      { inventoryItemId: WHOLE_MILK, quantity: 50, unit: "ml", tolerancePct: 10 },
      { inventoryItemId: CUP_8OZ, quantity: 1, unit: "unit", tolerancePct: 0 },
    ],
  },

  // ── Mocha ─────────────────────────────────────────────────────────────────
  {
    id: "recipe_mocha",
    menuItemId: "menu_mocha",
    ingredients: [
      { inventoryItemId: BEANS, quantity: 7, unit: "g", tolerancePct: 10 },
      { inventoryItemId: HOT_CHOC, quantity: 20, unit: "g", tolerancePct: 10 },
      { inventoryItemId: WHOLE_MILK, quantity: 160, unit: "ml", tolerancePct: 10 },
      { inventoryItemId: CUP_12OZ, quantity: 1, unit: "unit", tolerancePct: 0 },
      { inventoryItemId: LID, quantity: 1, unit: "unit", tolerancePct: 0 },
    ],
  },

  // ── Cold Brew ─────────────────────────────────────────────────────────────
  // Cold brew concentrate uses more beans (coarse grind, 18 h steep)
  {
    id: "recipe_cold_brew",
    menuItemId: "menu_cold_brew",
    ingredients: [
      { inventoryItemId: BEANS, quantity: 25, unit: "g", tolerancePct: 15 },
      { inventoryItemId: CUP_12OZ, quantity: 1, unit: "unit", tolerancePct: 0 },
      { inventoryItemId: LID, quantity: 1, unit: "unit", tolerancePct: 0 },
    ],
  },

  // ── Iced Latte ────────────────────────────────────────────────────────────
  {
    id: "recipe_iced_latte",
    menuItemId: "menu_iced_latte",
    ingredients: [
      { inventoryItemId: BEANS, quantity: 7, unit: "g", tolerancePct: 10 },
      { inventoryItemId: WHOLE_MILK, quantity: 180, unit: "ml", tolerancePct: 10 },
      { inventoryItemId: CUP_12OZ, quantity: 1, unit: "unit", tolerancePct: 0 },
      { inventoryItemId: LID, quantity: 1, unit: "unit", tolerancePct: 0 },
    ],
  },
];

export async function seedRecipes() {
  console.log(`  → recipes (${RECIPES.length})`);

  for (const spec of RECIPES) {
    // Insert recipe header
    await db
      .insert(recipes)
      .values({ id: spec.id, menuItemId: spec.menuItemId, version: 1 })
      .onConflictDoNothing();

    // Insert ingredients with stable IDs
    const ingredientRows = spec.ingredients.map((ing, i) => ({
      id: `ri_${spec.id}_${i}`,
      recipeId: spec.id,
      inventoryItemId: ing.inventoryItemId,
      quantity: ing.quantity,
      unit: ing.unit,
      tolerancePct: ing.tolerancePct,
    }));

    await db.insert(recipeIngredients).values(ingredientRows).onConflictDoNothing();

    // Link menu_item → recipe so G9 deduction can traverse:
    // order → order_items → menu_item → recipe → recipe_ingredients
    await db
      .update(menuItems)
      .set({ recipeId: spec.id })
      .where(eq(menuItems.id, spec.menuItemId));
  }
}
