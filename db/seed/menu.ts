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
  // Coffee (espresso-based)
  { id: "menu_espresso", name: "Espresso", category: "coffee", currentPriceZar: 2500 },
  { id: "menu_americano", name: "Americano", category: "coffee", currentPriceZar: 3000 },
  { id: "menu_cappuccino", name: "Cappuccino", category: "coffee", currentPriceZar: 3800 },
  { id: "menu_flat_white", name: "Flat White", category: "coffee", currentPriceZar: 4000 },
  { id: "menu_latte", name: "Latte", category: "coffee", currentPriceZar: 4200 },
  { id: "menu_cortado", name: "Cortado", category: "coffee", currentPriceZar: 3500 },
  { id: "menu_mocha", name: "Mocha", category: "coffee", currentPriceZar: 4500 },
  // Cold
  { id: "menu_cold_brew", name: "Cold Brew", category: "cold_brew", currentPriceZar: 4800 },
  { id: "menu_iced_latte", name: "Iced Latte", category: "cold_brew", currentPriceZar: 4500 },
  // Tea
  { id: "menu_rooibos", name: "Rooibos Tea", category: "tea", currentPriceZar: 2800 },
  { id: "menu_english_breakfast", name: "English Breakfast Tea", category: "tea", currentPriceZar: 2800 },
  // Chai (powder + steamed milk — has an ingredient recipe, unlike plain teas)
  { id: "menu_chai", name: "Chai Latte", category: "tea", currentPriceZar: 2500 },
  // Food
  { id: "menu_croissant", name: "Butter Croissant", category: "food", currentPriceZar: 3500 },
  { id: "menu_muffin", name: "Blueberry Muffin", category: "food", currentPriceZar: 3000 },
  { id: "menu_toastie", name: "Cheese & Tomato Toastie", category: "food", currentPriceZar: 5500 },
];

export async function seedMenu() {
  console.log(`  → menu items (${MENU_ITEMS.length})`);
  await db.insert(menuItems).values(MENU_ITEMS).onConflictDoNothing();
}
