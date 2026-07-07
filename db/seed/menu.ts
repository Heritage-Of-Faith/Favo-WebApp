// Menu seed — task G3
// Coffee + food items. Prices are integer cents in ZAR (R38.00 = 3800).
// IDs are explicit + stable so customisations and tests can reference them.
// Docs: docs/DATA_MODEL.md

import { db } from "../index";
import { menuItems } from "../schema";

type MenuCategory =
  | "coffee"
  | "tea"
  | "cold_brew"
  | "food"
  | "merchandise"
  | "other";

export type SeedMenuItem = {
  id: string;
  name: string;
  category: MenuCategory;
  currentPriceZar: number;
  // AT-136: defaults to true. Everything outside the locked 5-item menu
  // (docs/POS_REBUILD_DECISIONS.md) is seeded inactive, matching production —
  // kept in the seed for historical order data, never shown live.
  active?: boolean;
};

// Espresso-based coffees get customisations (extra shot, milks) in customisations.ts
export const ESPRESSO_DRINK_IDS = [
  "menu_espresso",
  "menu_americano",
  "menu_cappuccino",
  "menu_flat_white",
  "menu_latte",
  "menu_cortado",
  "menu_mocha",
] as const;

export const MENU_ITEMS: SeedMenuItem[] = [
  // Coffee (espresso-based) — Americano, Cappuccino, Mocha are the only
  // espresso drinks left in the locked 5-item menu; the rest are inactive.
  { id: "menu_espresso", name: "Espresso", category: "coffee", currentPriceZar: 2500, active: false },
  { id: "menu_americano", name: "Americano", category: "coffee", currentPriceZar: 3000 },
  { id: "menu_cappuccino", name: "Cappuccino", category: "coffee", currentPriceZar: 3800 },
  { id: "menu_flat_white", name: "Flat White", category: "coffee", currentPriceZar: 4000, active: false },
  { id: "menu_latte", name: "Latte", category: "coffee", currentPriceZar: 4200, active: false },
  { id: "menu_cortado", name: "Cortado", category: "coffee", currentPriceZar: 3500, active: false },
  { id: "menu_mocha", name: "Mocha", category: "coffee", currentPriceZar: 4500 },
  // Hot Chocolate is new (AT-136/145) — no espresso, macadamia-toggle only.
  { id: "menu_hot_chocolate", name: "Hot Chocolate", category: "coffee", currentPriceZar: 4000 },
  // Cold — inactive, outside the locked 5-item menu.
  { id: "menu_cold_brew", name: "Cold Brew", category: "cold_brew", currentPriceZar: 4800, active: false },
  { id: "menu_iced_latte", name: "Iced Latte", category: "cold_brew", currentPriceZar: 4500, active: false },
  // Tea — inactive.
  { id: "menu_rooibos", name: "Rooibos Tea", category: "tea", currentPriceZar: 2800, active: false },
  { id: "menu_english_breakfast", name: "English Breakfast Tea", category: "tea", currentPriceZar: 2800, active: false },
  // Food — inactive.
  { id: "menu_croissant", name: "Butter Croissant", category: "food", currentPriceZar: 3500, active: false },
  { id: "menu_muffin", name: "Blueberry Muffin", category: "food", currentPriceZar: 3000, active: false },
  { id: "menu_toastie", name: "Cheese & Tomato Toastie", category: "food", currentPriceZar: 5500, active: false },
];

export async function seedMenu() {
  console.log(`  → menu items (${MENU_ITEMS.length})`);
  await db
    .insert(menuItems)
    .values(MENU_ITEMS.map((item) => ({ ...item, active: item.active ?? true })))
    .onConflictDoNothing();
}
