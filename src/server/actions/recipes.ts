"use server";

// Recipe server actions — Phase 2 (G8 seed / A11 UI), real DB implementations.
// getRecipe / listRecipes: admin/owner only (admin UI only; deduction uses direct DB helpers).
// updateRecipeIngredient / bumpRecipeVersion: admin/owner only, audited.
//
// Active-recipe model: menu_items.recipe_id points at the live recipe. There is
// no separate draft flag in the schema, so bumpRecipeVersion clones the current
// recipe to version+1 and repoints menu_items.recipe_id (the clone becomes live
// immediately and is then editable in place).
//
// Docs: docs/API.md · docs/DATA_MODEL.md · recipes, recipe_ingredients

import { eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { menuItems, recipes, recipeIngredients, inventoryItems } from "@db/schema";
import { authorize } from "@/server/auth/guard";
import { writeAudit } from "@/server/audit";
import type {
  ActionResult,
  RecipeDetail,
  RecipeIngredientDetail,
  InventoryUnit,
} from "@/lib/types";
import type { DB } from "@/lib/db";

const ADMIN_ROLES = ["admin"] as const;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Load the ingredient detail rows for a set of recipe ids, keyed by recipeId. */
async function ingredientsByRecipe(
  recipeIds: string[]
): Promise<Map<string, RecipeIngredientDetail[]>> {
  const byRecipe = new Map<string, RecipeIngredientDetail[]>();
  if (recipeIds.length === 0) return byRecipe;

  const rows = await db
    .select({
      recipeId: recipeIngredients.recipeId,
      id: recipeIngredients.id,
      inventoryItemId: recipeIngredients.inventoryItemId,
      inventoryItemName: inventoryItems.name,
      quantity: recipeIngredients.quantity,
      unit: recipeIngredients.unit,
      tolerancePct: recipeIngredients.tolerancePct,
    })
    .from(recipeIngredients)
    .leftJoin(inventoryItems, eq(recipeIngredients.inventoryItemId, inventoryItems.id))
    .where(inArray(recipeIngredients.recipeId, recipeIds));

  for (const r of rows) {
    const detail: RecipeIngredientDetail = {
      id: r.id,
      inventoryItemId: r.inventoryItemId,
      inventoryItemName: r.inventoryItemName ?? r.inventoryItemId,
      quantity: r.quantity,
      unit: r.unit as InventoryUnit,
      tolerancePct: r.tolerancePct,
    };
    const list = byRecipe.get(r.recipeId);
    if (list) list.push(detail);
    else byRecipe.set(r.recipeId, [detail]);
  }
  return byRecipe;
}

// ─── getRecipe ────────────────────────────────────────────────────────────────

/**
 * Returns the active recipe for a menu item (via menu_items.recipe_id), with
 * ingredient detail. Returns { recipe: null } for items with no recipe.
 */
export async function getRecipe(
  menuItemId: string
): Promise<ActionResult<{ recipe: RecipeDetail | null }>> {
  const auth = await authorize(...ADMIN_ROLES);
  if (!auth.ok) return auth;

  const [item] = await db
    .select({ id: menuItems.id, name: menuItems.name, recipeId: menuItems.recipeId })
    .from(menuItems)
    .where(eq(menuItems.id, menuItemId));

  if (!item) {
    return { ok: false, code: "NOT_FOUND", message: "Menu item not found." };
  }
  if (!item.recipeId) {
    return { ok: true, data: { recipe: null } };
  }

  const [recipe] = await db
    .select({ id: recipes.id, version: recipes.version })
    .from(recipes)
    .where(eq(recipes.id, item.recipeId));

  if (!recipe) {
    return { ok: true, data: { recipe: null } };
  }

  const ingredients = (await ingredientsByRecipe([recipe.id])).get(recipe.id) ?? [];

  return {
    ok: true,
    data: {
      recipe: {
        id: recipe.id,
        menuItemId: item.id,
        menuItemName: item.name,
        version: recipe.version,
        ingredients,
      },
    },
  };
}

// ─── listRecipes ──────────────────────────────────────────────────────────────

/** Returns the active recipe for every menu item that has one. Admin/owner only. */
export async function listRecipes(): Promise<ActionResult<{ recipes: RecipeDetail[] }>> {
  const auth = await authorize(...ADMIN_ROLES);
  if (!auth.ok) return auth;

  const items = await db
    .select({ id: menuItems.id, name: menuItems.name, recipeId: menuItems.recipeId })
    .from(menuItems);

  const withRecipe = items.filter(
    (i): i is typeof i & { recipeId: string } => Boolean(i.recipeId)
  );
  if (withRecipe.length === 0) return { ok: true, data: { recipes: [] } };

  const recipeRows = await db
    .select({ id: recipes.id, version: recipes.version })
    .from(recipes)
    .where(
      inArray(
        recipes.id,
        withRecipe.map((i) => i.recipeId)
      )
    );
  const versionById = new Map(recipeRows.map((r) => [r.id, r.version]));

  const ingredientsMap = await ingredientsByRecipe(withRecipe.map((i) => i.recipeId));

  const result: RecipeDetail[] = withRecipe.map((i) => ({
    id: i.recipeId,
    menuItemId: i.id,
    menuItemName: i.name,
    version: versionById.get(i.recipeId) ?? 1,
    ingredients: ingredientsMap.get(i.recipeId) ?? [],
  }));

  return { ok: true, data: { recipes: result } };
}

// ─── updateRecipeIngredient ───────────────────────────────────────────────────

/**
 * Updates one ingredient's quantity / unit / tolerance in place (a correction,
 * not a version bump). Admin/owner only; audited.
 */
export async function updateRecipeIngredient(
  ingredientId: string,
  update: { quantity?: number; unit?: InventoryUnit; tolerancePct?: number }
): Promise<ActionResult> {
  const auth = await authorize(...ADMIN_ROLES);
  if (!auth.ok) return auth;

  if (
    update.quantity !== undefined &&
    (!Number.isInteger(update.quantity) || update.quantity < 0)
  ) {
    return { ok: false, code: "INVALID_INPUT", message: "Quantity must be a whole number ≥ 0." };
  }
  if (
    update.tolerancePct !== undefined &&
    (!Number.isInteger(update.tolerancePct) || update.tolerancePct < 0 || update.tolerancePct > 100)
  ) {
    return { ok: false, code: "INVALID_INPUT", message: "Tolerance must be between 0 and 100%." };
  }

  const [existing] = await db
    .select()
    .from(recipeIngredients)
    .where(eq(recipeIngredients.id, ingredientId));
  if (!existing) {
    return { ok: false, code: "NOT_FOUND", message: "Recipe ingredient not found." };
  }

  const patch: Partial<typeof recipeIngredients.$inferInsert> = {};
  if (update.quantity !== undefined) patch.quantity = update.quantity;
  if (update.unit !== undefined) patch.unit = update.unit;
  if (update.tolerancePct !== undefined) patch.tolerancePct = update.tolerancePct;

  if (Object.keys(patch).length === 0) {
    return { ok: true, data: undefined };
  }

  await db.transaction(async (tx) => {
    const txDb = tx as unknown as DB;
    await tx.update(recipeIngredients).set(patch).where(eq(recipeIngredients.id, ingredientId));
    await writeAudit(
      {
        entityKind: "recipe_ingredient",
        entityId: ingredientId,
        action: "update",
        actorId: auth.session.id,
        actorRole: auth.session.role,
        before: {
          quantity: existing.quantity,
          unit: existing.unit,
          tolerancePct: existing.tolerancePct,
        },
        after: patch,
        reason: "recipe_ingredient_correction",
      },
      txDb
    );
  });

  return { ok: true, data: undefined };
}

// ─── bumpRecipeVersion ────────────────────────────────────────────────────────

/**
 * Clones the menu item's active recipe to version+1, copies its ingredients,
 * and repoints menu_items.recipe_id to the clone (which becomes live). Admin/
 * owner only; audited. Returns the new recipe id.
 */
export async function bumpRecipeVersion(
  menuItemId: string
): Promise<ActionResult<{ newRecipeId: string }>> {
  const auth = await authorize(...ADMIN_ROLES);
  if (!auth.ok) return auth;

  const [item] = await db
    .select({ id: menuItems.id, recipeId: menuItems.recipeId })
    .from(menuItems)
    .where(eq(menuItems.id, menuItemId));
  if (!item) {
    return { ok: false, code: "NOT_FOUND", message: "Menu item not found." };
  }
  if (!item.recipeId) {
    return { ok: false, code: "NOT_FOUND", message: "Menu item has no recipe to version." };
  }

  const [current] = await db
    .select({ id: recipes.id, version: recipes.version })
    .from(recipes)
    .where(eq(recipes.id, item.recipeId));
  if (!current) {
    return { ok: false, code: "NOT_FOUND", message: "Active recipe not found." };
  }

  const sourceIngredients = await db
    .select()
    .from(recipeIngredients)
    .where(eq(recipeIngredients.recipeId, current.id));

  const newRecipeId = await db.transaction(async (tx) => {
    const txDb = tx as unknown as DB;
    const [created] = await tx
      .insert(recipes)
      .values({ menuItemId, version: current.version + 1 })
      .returning({ id: recipes.id });

    if (sourceIngredients.length > 0) {
      await tx.insert(recipeIngredients).values(
        sourceIngredients.map((ing) => ({
          recipeId: created.id,
          inventoryItemId: ing.inventoryItemId,
          quantity: ing.quantity,
          unit: ing.unit,
          tolerancePct: ing.tolerancePct,
        }))
      );
    }

    await tx.update(menuItems).set({ recipeId: created.id }).where(eq(menuItems.id, menuItemId));

    await writeAudit(
      {
        entityKind: "recipe",
        entityId: created.id,
        action: "bump_version",
        actorId: auth.session.id,
        actorRole: auth.session.role,
        before: { recipeId: current.id, version: current.version },
        after: { recipeId: created.id, version: current.version + 1 },
        reason: "recipe_version_bump",
      },
      txDb
    );

    return created.id;
  });

  return { ok: true, data: { newRecipeId } };
}
