"use client";

// Recipe editor — task A11.
// Edit ingredient quantity / tolerance in place (updateRecipeIngredient — a
// correction, no version bump) or clone to a new version (bumpRecipeVersion).
// Future orders use the active recipe (menu_items.recipe_id).

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { updateRecipeIngredient, bumpRecipeVersion } from "@/server/actions/recipes";
import type { RecipeDetail, RecipeIngredientDetail, InventoryUnit } from "@/lib/types";

const UNITS: InventoryUnit[] = ["g", "kg", "ml", "l", "unit", "bag"];

export interface RecipeEditorProps {
  initialRecipe: RecipeDetail;
}

export default function RecipeEditor({ initialRecipe }: RecipeEditorProps) {
  const router = useRouter();
  const [recipe, setRecipe] = useState<RecipeDetail>(initialRecipe);
  const [bumping, setBumping] = useState(false);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <span className="favo-label">
          {recipe.menuItemName} · version {recipe.version}
        </span>
        <button
          type="button"
          onClick={async () => {
            setBumping(true);
            const res = await bumpRecipeVersion(recipe.menuItemId);
            setBumping(false);
            if (res.ok) {
              toast.success("New version created and made live.");
              router.refresh();
            } else {
              toast.error(res.message);
            }
          }}
          disabled={bumping}
          className="min-h-10 rounded-[var(--radius-btn)] border px-3 favo-small disabled:opacity-50"
          style={{ borderColor: "var(--color-border-subtle)", color: "var(--color-text-strong)" }}
        >
          {bumping ? "Creating…" : "New version"}
        </button>
      </div>

      {recipe.ingredients.length === 0 ? (
        <p className="favo-small" style={{ color: "var(--color-text-muted)" }}>
          This recipe has no ingredients.
        </p>
      ) : (
        <ul className="space-y-2">
          {recipe.ingredients.map((ing) => (
            <IngredientRow
              key={ing.id}
              ingredient={ing}
              onSaved={(patch) =>
                setRecipe((prev) => ({
                  ...prev,
                  ingredients: prev.ingredients.map((i) =>
                    i.id === ing.id ? { ...i, ...patch } : i
                  ),
                }))
              }
            />
          ))}
        </ul>
      )}

      <p className="favo-caption" style={{ color: "var(--color-text-muted)", textTransform: "none", letterSpacing: 0 }}>
        Editing a value is a correction and keeps the current version. Use “New version” to supersede
        the recipe for future orders.
      </p>
    </div>
  );

  function IngredientRow({
    ingredient,
    onSaved,
  }: {
    ingredient: RecipeIngredientDetail;
    onSaved: (patch: Partial<RecipeIngredientDetail>) => void;
  }) {
    const [quantity, setQuantity] = useState(String(ingredient.quantity));
    const [unit, setUnit] = useState<InventoryUnit>(ingredient.unit);
    const [tolerance, setTolerance] = useState(String(ingredient.tolerancePct));
    const [saving, setSaving] = useState(false);

    const dirty =
      quantity !== String(ingredient.quantity) ||
      unit !== ingredient.unit ||
      tolerance !== String(ingredient.tolerancePct);

    async function save() {
      const q = Number(quantity);
      const t = Number(tolerance);
      if (!Number.isInteger(q) || q < 0) {
        toast.error("Quantity must be a whole number ≥ 0.");
        return;
      }
      if (!Number.isInteger(t) || t < 0 || t > 100) {
        toast.error("Tolerance must be 0–100%.");
        return;
      }
      setSaving(true);
      const res = await updateRecipeIngredient(ingredient.id, {
        quantity: q,
        unit,
        tolerancePct: t,
      });
      setSaving(false);
      if (res.ok) {
        toast.success(`${ingredient.inventoryItemName} updated.`);
        onSaved({ quantity: q, unit, tolerancePct: t });
      } else {
        toast.error(res.message);
      }
    }

    const inputStyle = {
      background: "var(--color-surface)",
      color: "var(--color-text-strong)",
      borderColor: "var(--color-border-subtle)",
    } as const;

    return (
      <li
        className="flex flex-wrap items-end gap-3 rounded-[var(--radius-card)] border p-3"
        style={{ borderColor: "var(--color-border-subtle)" }}
      >
        <span className="favo-small flex-1 min-w-[8rem]" style={{ color: "var(--color-text-strong)", fontWeight: 600 }}>
          {ingredient.inventoryItemName}
        </span>

        <label className="flex flex-col gap-1">
          <span className="favo-caption" style={{ color: "var(--color-text-muted)" }}>
            Quantity
          </span>
          <input
            type="number"
            min={0}
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            className="h-10 w-24 rounded-[var(--radius-btn)] border px-2 favo-small"
            style={inputStyle}
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="favo-caption" style={{ color: "var(--color-text-muted)" }}>
            Unit
          </span>
          <select
            value={unit}
            onChange={(e) => setUnit(e.target.value as InventoryUnit)}
            className="h-10 rounded-[var(--radius-btn)] border px-2 favo-small"
            style={inputStyle}
          >
            {UNITS.map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="favo-caption" style={{ color: "var(--color-text-muted)" }}>
            Tolerance %
          </span>
          <input
            type="number"
            min={0}
            max={100}
            value={tolerance}
            onChange={(e) => setTolerance(e.target.value)}
            className="h-10 w-20 rounded-[var(--radius-btn)] border px-2 favo-small"
            style={inputStyle}
          />
        </label>

        <button
          type="button"
          onClick={save}
          disabled={!dirty || saving}
          className="min-h-10 rounded-[var(--radius-btn)] px-3 favo-cta disabled:opacity-40"
          style={{ background: "var(--color-accent)", color: "var(--color-text-inverse)" }}
        >
          {saving ? "…" : "Save"}
        </button>
      </li>
    );
  }
}
