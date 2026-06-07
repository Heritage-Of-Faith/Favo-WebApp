// Unit tests for useStockStatus (M9)

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

const mockListInventoryStatus = vi.fn();
const mockListRecipes = vi.fn();

vi.mock("@/server/actions/inventory", () => ({
  listInventoryStatus: (...a: unknown[]) => mockListInventoryStatus(...a),
}));
vi.mock("@/server/actions/recipes", () => ({
  listRecipes: (...a: unknown[]) => mockListRecipes(...a),
}));

import { useStockStatus } from "@/hooks/useStockStatus";

const STATUS = {
  inv_beans: { id: "inv_beans", name: "Espresso Beans", kind: "bean", unit: "g", lowStockThreshold: 500, currentStock: 0, status: "out" as const },
  inv_milk:  { id: "inv_milk", name: "Whole Milk", kind: "dairy", unit: "ml", lowStockThreshold: 2000, currentStock: 1500, status: "low" as const },
  inv_cup:   { id: "inv_cup", name: "8oz Cup", kind: "packaging", unit: "unit", lowStockThreshold: 50, currentStock: 800, status: "ok" as const },
};

const RECIPES = [
  { id: "r1", menuItemId: "cap", menuItemName: "Cappuccino", version: 1, ingredients: [
    { id: "i1", inventoryItemId: "inv_beans", inventoryItemName: "Espresso Beans", quantity: 7, unit: "g", tolerancePct: 5 },
    { id: "i2", inventoryItemId: "inv_milk", inventoryItemName: "Whole Milk", quantity: 150, unit: "ml", tolerancePct: 5 },
  ]},
  { id: "r2", menuItemId: "latte", menuItemName: "Latte", version: 1, ingredients: [
    { id: "i3", inventoryItemId: "inv_milk", inventoryItemName: "Whole Milk", quantity: 200, unit: "ml", tolerancePct: 5 },
    { id: "i4", inventoryItemId: "inv_cup", inventoryItemName: "8oz Cup", quantity: 1, unit: "unit", tolerancePct: 0 },
  ]},
];

beforeEach(() => {
  vi.clearAllMocks();
  mockListInventoryStatus.mockResolvedValue({ ok: true, data: { statusMap: STATUS } });
  mockListRecipes.mockResolvedValue({ ok: true, data: { recipes: RECIPES } });
});

describe("useStockStatus", () => {
  it("returns 'out' when any ingredient is out of stock", async () => {
    const { result } = renderHook(() => useStockStatus());
    await waitFor(() => expect(result.current.menuItemStock("cap")).toBe("out")); // beans out
  });

  it("returns 'low' when an ingredient is low but none are out", async () => {
    const { result } = renderHook(() => useStockStatus());
    await waitFor(() => expect(result.current.menuItemStock("latte")).toBe("low")); // milk low, cup ok
  });

  it("returns 'ok' for an unknown menu item with no recipe", async () => {
    const { result } = renderHook(() => useStockStatus());
    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.menuItemStock("merch_mug")).toBe("ok");
  });

  it("lists out-of-stock item names for the banner", async () => {
    const { result } = renderHook(() => useStockStatus());
    await waitFor(() => expect(result.current.outOfStockItems).toContain("Espresso Beans"));
  });
});
