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
  it("has exactly 11 items (6 base + 5 cup-container items)", () => {
    expect(INVENTORY_ITEMS).toHaveLength(11);
  });

  it("includes cup-container items for beans and all milks (AT-145)", () => {
    const cupItems = INVENTORY_ITEMS.filter((i) => i.unit === "cup");
    expect(cupItems.map((i) => i.id).sort()).toEqual([
      "inv_item_almond_milk",
      "inv_item_beans_cups",
      "inv_item_macadamia_milk",
      "inv_item_oat_milk",
      "inv_item_whole_milk_cups",
    ]);
    // Container items are milk/bean kinds tracked in cups.
    expect(cupItems.every((i) => i.kind === "bean" || i.kind === "milk")).toBe(true);
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

  it("non-container items have exactly one lot; high-volume containers have several", () => {
    // Non-container (g/ml/unit) items: one starter lot each.
    const nonContainerItems = INVENTORY_ITEMS.filter((i) => i.unit !== "cup");
    for (const item of nonContainerItems) {
      const lots = INVENTORY_LOTS.filter((l) => l.inventoryItemId === item.id);
      expect(lots).toHaveLength(1);
    }
    // High-volume containers (beans, dairy milk): multiple bottles/bags,
    // exactly one seeded "open".
    const highVolumeContainerIds = ["inv_item_beans_cups", "inv_item_whole_milk_cups"];
    for (const id of highVolumeContainerIds) {
      const lots = INVENTORY_LOTS.filter((l) => l.inventoryItemId === id);
      expect(lots.length).toBeGreaterThan(1);
      expect(lots.filter((l) => l.state === "open")).toHaveLength(1);
    }
    // AT-145: lower-volume alt-milk containers seed with a single sealed lot —
    // nothing pre-opened, since nothing has used them yet.
    const altMilkIds = ["inv_item_oat_milk", "inv_item_macadamia_milk", "inv_item_almond_milk"];
    for (const id of altMilkIds) {
      const lots = INVENTORY_LOTS.filter((l) => l.inventoryItemId === id);
      expect(lots).toHaveLength(1);
      expect(lots[0]!.state ?? "active").toBe("active");
    }
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

  it("cappuccino recipe has beans + milk (cup containers) + cup + lid", () => {
    const cappuccino = RECIPES.find((r) => r.menuItemId === "menu_cappuccino");
    expect(cappuccino).toBeDefined();
    const itemIds = cappuccino!.ingredients.map((i) => i.inventoryItemId);
    expect(itemIds).toContain("inv_item_beans_cups");
    expect(itemIds).toContain("inv_item_whole_milk_cups");
    expect(itemIds).toContain("inv_item_cup_8oz");
    expect(itemIds).toContain("inv_item_lid");
  });

  it("cappuccino draws 1 cup of beans from the open container", () => {
    const cappuccino = RECIPES.find((r) => r.menuItemId === "menu_cappuccino");
    const beans = cappuccino!.ingredients.find(
      (i) => i.inventoryItemId === "inv_item_beans_cups"
    );
    expect(beans?.quantity).toBe(1);
    expect(beans?.unit).toBe("cup");
  });

  it("cappuccino draws 1 cup of milk from the open container", () => {
    const cappuccino = RECIPES.find((r) => r.menuItemId === "menu_cappuccino");
    const milk = cappuccino!.ingredients.find(
      (i) => i.inventoryItemId === "inv_item_whole_milk_cups"
    );
    expect(milk?.quantity).toBe(1);
    expect(milk?.unit).toBe("cup");
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
