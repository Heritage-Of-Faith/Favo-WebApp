// Recipe editor — task A11.
// Per-menu-item recipe view linked from the menu page. Docs: DATA_MODEL.md
// (recipes, recipe_ingredients).

import Link from "next/link";
import { getRecipe } from "@/server/actions/recipes";
import RecipeEditor from "@/components/admin/RecipeEditor";

export default async function RecipePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const res = await getRecipe(id);

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <header>
        <Link href="/admin/menu" className="favo-caption" style={{ color: "var(--color-accent)" }}>
          ← Menu
        </Link>
        <h1 className="admin-page-title mt-1">
          Recipe
        </h1>
        <p className="mt-1 favo-small" style={{ color: "var(--color-text-muted)" }}>
          Ingredients consumed per drink. Deduction uses the active version on every order.
        </p>
      </header>

      {!res.ok ? (
        <p className="favo-small" style={{ color: "var(--color-error)" }}>
          {res.message}
        </p>
      ) : !res.data.recipe ? (
        <p
          className="rounded-[var(--radius-card)] border p-6 text-center favo-small"
          style={{ borderColor: "var(--color-border-subtle)", color: "var(--color-text-muted)" }}
        >
          This menu item has no recipe (e.g. a food or merchandise item).
        </p>
      ) : (
        <RecipeEditor initialRecipe={res.data.recipe} />
      )}
    </div>
  );
}
