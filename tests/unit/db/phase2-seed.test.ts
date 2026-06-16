// Phase 2 seed unit tests — task G8
// Asserts on the seed DATA shapes; no DB connection required.
// Mirrors the pattern in tests/unit/db/seed.test.ts.

import { describe, it, expect } from "vitest";
import { INVENTORY_ITEMS } from "@db/seed/inventory";
import { INVENTORY_LOTS } from "@db/seed/lots";
import { RECIPES } from "@db/seed/recipes";
import { ALERT_RECIPIENTS } from "@db/seed/alert-recipients";

// ── Inventory items ───────────────────────────────────────────────────────────

describe("seed: inventory items", () => {
  it("has exactly 8 items", () => {
    expect(INVENTORY_ITEMS).toHaveLength(8);
  });

  it("IDs are unique", () => {
    const ids = INVENTORY_ITEMS.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("includes the 4 expected item kinds", () => {
    const kinds = new Set(INVENTORY_ITEMS.map((i) => i.kind));
    expect(kinds.has("bean")).toBe(true);
    expect(kinds.has("milk")).toBe(true);
    expect(kinds.has("packaging")).toBe(true);
    expect(kinds.has("other")).toBe(true);
  });

  it("low_stock_threshold is a positive integer for every item", () => {
    for (const item of INVENTORY_ITEMS) {
      expect(Number.isInteger(item.lowStockThreshold)).toBe(true);
      expect(item.lowStockThreshold).toBeGreaterThan(0);
    }
  });

  it("contains espresso_beans, whole_milk, cup_8oz, lid", () => {
    const ids = new Set(INVENTORY_ITEMS.map((i) => i.id));
    expect(ids.has("inv_item_espresso_beans")).toBe(true);
    expect(ids.has("inv_item_whole_milk")).toBe(true);
    expect(ids.has("inv_item_cup_8oz")).toBe(true);
    expect(ids.has("inv_item_lid")).toBe(true);
  });
});

// ── Inventory lots ────────────────────────────────────────────────────────────

describe("seed: inventory lots", () => {
  const itemIds = new Set(INVENTORY_ITEMS.map((i) => i.id));

  it("exactly one lot per inventory item", () => {
    expect(INVENTORY_LOTS).toHaveLength(INVENTORY_ITEMS.length);
  });

  it("lot IDs are unique", () => {
    const ids = INVENTORY_LOTS.map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every lot references a known inventory item", () => {
    for (const lot of INVENTORY_LOTS) {
      expect(itemIds.has(lot.inventoryItemId)).toBe(true);
    }
  });

  it("packaging items (unit=unit) have a non-zero integer unit_cost_zar", () => {
    const packagingItems = INVENTORY_ITEMS.filter((i) => i.kind === "packaging");
    for (const item of packagingItems) {
      const lot = INVENTORY_LOTS.find((l) => l.inventoryItemId === item.id);
      expect(lot).toBeDefined();
      const cost = parseFloat(lot!.unitCostZar);
      expect(cost).toBeGreaterThan(0);
    }
  });

  it("all lot unit costs are non-negative numeric strings", () => {
    for (const lot of INVENTORY_LOTS) {
      const cost = parseFloat(lot.unitCostZar);
      expect(Number.isFinite(cost)).toBe(true);
      expect(cost).toBeGreaterThanOrEqual(0);
    }
  });

  it("opening delta matches quantity_received for each lot", () => {
    for (const lot of INVENTORY_LOTS) {
      expect(lot.openingDelta).toBe(parseFloat(lot.quantityReceived));
    }
  });

  it("espresso beans lot has a meaningful cost (R450/kg → 0.45 ¢/g)", () => {
    const lot = INVENTORY_LOTS.find(
      (l) => l.inventoryItemId === "inv_item_espresso_beans"
    );
    expect(lot).toBeDefined();
    const cost = parseFloat(lot!.unitCostZar);
    // Tolerance band: R300–R600/kg (0.30–0.60 ¢/g) for SA specialty beans
    expect(cost).toBeGreaterThanOrEqual(0.30);
    expect(cost).toBeLessThanOrEqual(0.60);
  });
});

// ── Recipes ───────────────────────────────────────────────────────────────────

describe("seed: recipes", () => {
  it("every recipe has a unique id", () => {
    const ids = RECIPES.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every recipe references a known menu item ID prefix (menu_*)", () => {
    for (const recipe of RECIPES) {
      expect(recipe.menuItemId).toMatch(/^menu_/);
    }
  });

  it("every recipe has at least one ingredient", () => {
    for (const recipe of RECIPES) {
      expect(recipe.ingredients.length).toBeGreaterThanOrEqual(1);
    }
  });

  it("cappuccino recipe has beans + milk + cup + lid", () => {
    const cappuccino = RECIPES.find((r) => r.menuItemId === "menu_cappuccino");
    expect(cappuccino).toBeDefined();
    const itemIds = cappuccino!.ingredients.map((i) => i.inventoryItemId);
    expect(itemIds).toContain("inv_item_espresso_beans");
    expect(itemIds).toContain("inv_item_whole_milk");
    expect(itemIds).toContain("inv_item_cup_8oz");
    expect(itemIds).toContain("inv_item_lid");
  });

  it("cappuccino uses 7g beans (plan spec)", () => {
    const cappuccino = RECIPES.find((r) => r.menuItemId === "menu_cappuccino");
    const beans = cappuccino!.ingredients.find(
      (i) => i.inventoryItemId === "inv_item_espresso_beans"
    );
    expect(beans?.quantity).toBe(7);
    expect(beans?.unit).toBe("g");
  });

  it("cappuccino uses 150ml milk (plan spec)", () => {
    const cappuccino = RECIPES.find((r) => r.menuItemId === "menu_cappuccino");
    const milk = cappuccino!.ingredients.find(
      (i) => i.inventoryItemId === "inv_item_whole_milk"
    );
    expect(milk?.quantity).toBe(150);
    expect(milk?.unit).toBe("ml");
  });

  it("mocha recipe includes hot_choc_powder", () => {
    const mocha = RECIPES.find((r) => r.menuItemId === "menu_mocha");
    expect(mocha).toBeDefined();
    const hasChoc = mocha!.ingredients.some(
      (i) => i.inventoryItemId === "inv_item_hot_choc_powder"
    );
    expect(hasChoc).toBe(true);
  });

  it("all ingredient quantities are positive integers", () => {
    for (const recipe of RECIPES) {
      for (const ing of recipe.ingredients) {
        expect(Number.isInteger(ing.quantity)).toBe(true);
        expect(ing.quantity).toBeGreaterThan(0);
      }
    }
  });

  it("tolerance_pct is non-negative for every ingredient", () => {
    for (const recipe of RECIPES) {
      for (const ing of recipe.ingredients) {
        expect(ing.tolerancePct).toBeGreaterThanOrEqual(0);
      }
    }
  });
});

// ── Alert recipients ──────────────────────────────────────────────────────────

describe("seed: stock alert recipients", () => {
  it("has at least one global recipient (inventoryItemId = null)", () => {
    const globals = ALERT_RECIPIENTS.filter((r) => r.inventoryItemId === null);
    expect(globals.length).toBeGreaterThanOrEqual(1);
  });

  it("global recipient references the seeded barista", () => {
    const global = ALERT_RECIPIENTS.find((r) => r.inventoryItemId === null);
    expect(global?.staffId).toBe("staff_barista_sam");
  });

  it("recipient IDs are unique", () => {
    const ids = ALERT_RECIPIENTS.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
