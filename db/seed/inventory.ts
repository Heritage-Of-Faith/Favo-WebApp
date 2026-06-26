// Inventory items seed — task G8 (Phase 2)
// 8 trackable ingredients/supplies used in FAVO drinks.
// IDs are stable so recipes and lots can reference them across seeds.
// Docs: DATA_MODEL.md · BUSINESS_RULES.md T04 (low_stock_threshold defaults)

import { db } from "../index";
import { inventoryItems } from "../schema";

export type SeedInventoryItem = {
  id: string;
  name: string;
  kind: "bean" | "milk" | "syrup" | "packaging" | "equipment" | "other";
  unit: "g" | "kg" | "ml" | "l" | "unit" | "bag" | "cup";
  lowStockThreshold: number; // in the item's own unit
};

// T04 defaults: beans 500g, milks 1–2 L, packaging 50–100 units, powder 200g.
export const INVENTORY_ITEMS: SeedInventoryItem[] = [
  {
    id: "inv_item_espresso_beans",
    name: "Espresso Beans",
    kind: "bean",
    unit: "g",
    lowStockThreshold: 500, // 500g → alert when < 0.5 kg in hopper
  },
  {
    id: "inv_item_whole_milk",
    name: "Full-Cream Milk",
    kind: "milk",
    unit: "ml",
    lowStockThreshold: 2000, // 2 L
  },
  {
    id: "inv_item_oat_milk",
    name: "Oat Milk",
    kind: "milk",
    unit: "ml",
    lowStockThreshold: 1000, // 1 L
  },
  {
    id: "inv_item_macadamia_milk",
    name: "Macadamia Milk",
    kind: "milk",
    unit: "ml",
    lowStockThreshold: 500, // 0.5 L
  },
  {
    id: "inv_item_cup_8oz",
    name: "8 oz Cup",
    kind: "packaging",
    unit: "unit",
    lowStockThreshold: 50,
  },
  {
    id: "inv_item_cup_12oz",
    name: "12 oz Cup",
    kind: "packaging",
    unit: "unit",
    lowStockThreshold: 50,
  },
  {
    id: "inv_item_lid",
    name: "Cup Lid",
    kind: "packaging",
    unit: "unit",
    lowStockThreshold: 100,
  },
  {
    id: "inv_item_hot_choc_powder",
    name: "Hot Chocolate Powder",
    kind: "other",
    unit: "g",
    lowStockThreshold: 200, // 200g
  },
  // ── Container model (milk & beans) ──────────────────────────────────────────
  // Tracked in cups produced, not g/ml. A lot = one physical bag/carton; it is
  // opened on the POS and every coffee made deducts one cup. Threshold is in
  // total cups remaining across all containers (sealed + open).
  {
    id: "inv_item_beans_cups",
    name: "Espresso Beans (bag)",
    kind: "bean",
    unit: "cup",
    lowStockThreshold: 60, // re-order when < ~half a bag of cups left
  },
  {
    id: "inv_item_whole_milk_cups",
    name: "Full-Cream Milk (carton)",
    kind: "milk",
    unit: "cup",
    lowStockThreshold: 20, // re-order when < ~2 cartons of cups left
  },
];

export async function seedInventoryItems() {
  console.log(`  → inventory items (${INVENTORY_ITEMS.length})`);
  await db.insert(inventoryItems).values(INVENTORY_ITEMS).onConflictDoNothing();
}
