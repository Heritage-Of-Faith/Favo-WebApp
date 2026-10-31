// RecipeEditor — QA r1-admin P2f: cup-stocked beans/milk rendered as "1 g"
// because the unit dropdown had no "cup"; editing the quantity would then
// risk saving the wrong unit.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import RecipeEditor from "@/components/admin/RecipeEditor";
import type { RecipeDetail } from "@/lib/types";

vi.mock("@/server/actions/recipes", () => ({
  updateRecipeIngredient: vi.fn().mockResolvedValue({ ok: true, data: undefined }),
  bumpRecipeVersion: vi.fn().mockResolvedValue({ ok: true, data: {} }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const MOCHA: RecipeDetail = {
  id: "r1",
  menuItemId: "m1",
  menuItemName: "Mocha",
  version: 1,
  ingredients: [
    { id: "i1", inventoryItemId: "inv_item_beans_cups", inventoryItemName: "Espresso Beans (bag)", quantity: 1, unit: "cup", tolerancePct: 10 },
  ],
};

beforeEach(() => vi.clearAllMocks());

describe("RecipeEditor", () => {
  it("shows 'cup' for a cup-stocked ingredient, not 'g'", () => {
    render(<RecipeEditor initialRecipe={MOCHA} />);
    const select = screen.getByRole("combobox") as HTMLSelectElement;
    expect(select.value).toBe("cup");
    expect(select.selectedOptions[0]?.textContent).toBe("cup");
  });

  it("keeps the unit 'cup' when only the quantity is edited", async () => {
    const { updateRecipeIngredient } = await import("@/server/actions/recipes");
    render(<RecipeEditor initialRecipe={MOCHA} />);
    fireEvent.change(screen.getByRole("spinbutton", { name: "Quantity" }), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(updateRecipeIngredient).toHaveBeenCalledWith("i1", { quantity: 2, unit: "cup", tolerancePct: 10 })
    );
  });
});
