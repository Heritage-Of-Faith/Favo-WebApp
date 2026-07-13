// Customisations seed — task G3, extended AT-145
// Per-item modifications: extra shot, milk alternatives, decaf.
// price_delta_zar is integer cents (R10.00 = 1000).
//
// AT-145: customisations that change what actually gets deducted (see
// deductForOrder in src/server/orders/deduction.ts) carry an inventory effect:
//   - substitutesInventoryItemId: replaces the recipe's ingredient of the same
//     kind (e.g. Oat Milk replaces whichever milk the base recipe uses).
//   - addsInventoryItemId + addsQuantity: adds extra units on top of the base
//     recipe, once per selection (Extra Shot ×3 deducts 3× as many beans).
// Americano is locked as black/shot-only (no milk options) — see
// docs/POS_REBUILD_DECISIONS.md. Hot Chocolate has no espresso, so only the
// macadamia toggle applies — no shot stepper, no oat/almond.

import { db } from "../index";
import { menuCustomisations } from "../schema";

export type SeedCustomisation = {
  id: string;
  menuItemId: string;
  name: string;
  priceDeltaZar: number;
  substitutesInventoryItemId?: string;
  addsInventoryItemId?: string;
  addsQuantity?: number;
};

const BEANS = "inv_item_beans_cups";
const OAT_MILK = "inv_item_oat_milk";
const ALMOND_MILK = "inv_item_almond_milk";
const MACADAMIA_MILK = "inv_item_macadamia_milk";

const EXTRA_SHOT = (drinkSlug: string): SeedCustomisation => ({
  id: `mod_${drinkSlug}_extra_shot`,
  menuItemId: `menu_${drinkSlug}`,
  name: "Extra Shot",
  priceDeltaZar: 1000,
  addsInventoryItemId: BEANS,
  addsQuantity: 1,
});

const DECAF = (drinkSlug: string): SeedCustomisation => ({
  id: `mod_${drinkSlug}_decaf`,
  menuItemId: `menu_${drinkSlug}`,
  name: "Decaf",
  priceDeltaZar: 0,
});

const OAT_MILK_OPTION = (drinkSlug: string): SeedCustomisation => ({
  id: `mod_${drinkSlug}_oat_milk`,
  menuItemId: `menu_${drinkSlug}`,
  name: "Oat Milk",
  priceDeltaZar: 800,
  substitutesInventoryItemId: OAT_MILK,
});

const ALMOND_MILK_OPTION = (drinkSlug: string): SeedCustomisation => ({
  id: `mod_${drinkSlug}_almond_milk`,
  menuItemId: `menu_${drinkSlug}`,
  name: "Almond Milk",
  priceDeltaZar: 800,
  substitutesInventoryItemId: ALMOND_MILK,
});

const MACADAMIA_MILK_OPTION = (drinkSlug: string): SeedCustomisation => ({
  id: `mod_${drinkSlug}_macadamia_milk`,
  menuItemId: `menu_${drinkSlug}`,
  name: "Macadamia Milk",
  priceDeltaZar: 0,
  substitutesInventoryItemId: MACADAMIA_MILK,
});

export const CUSTOMISATIONS: SeedCustomisation[] = [
  // Espresso — legacy, inactive item; kept as-is (no inventory effects wired,
  // out of scope since it's not in the locked 5-item menu).
  EXTRA_SHOT("espresso"),
  OAT_MILK_OPTION("espresso"),
  ALMOND_MILK_OPTION("espresso"),
  DECAF("espresso"),

  // Americano — black/shot-only, no milk options (docs/POS_REBUILD_DECISIONS.md).
  EXTRA_SHOT("americano"),
  DECAF("americano"),

  // Cappuccino — shot + macadamia. Oat & almond removed 2026-07-13 (Nikao):
  // macadamia is the only alt-milk the café actually stocks.
  EXTRA_SHOT("cappuccino"),
  MACADAMIA_MILK_OPTION("cappuccino"),
  DECAF("cappuccino"),

  // Mocha — same as Cappuccino (macadamia the only alt-milk).
  EXTRA_SHOT("mocha"),
  MACADAMIA_MILK_OPTION("mocha"),
  DECAF("mocha"),

  // Hot Chocolate — no espresso: macadamia toggle only, per the locked
  // wireframe brief (no shot stepper, no oat/almond).
  MACADAMIA_MILK_OPTION("hot_chocolate"),

  // Chai Latte — like Hot Chocolate: no espresso, macadamia toggle only.
  MACADAMIA_MILK_OPTION("chai"),

  // Legacy inactive espresso drinks — kept as-is (out of scope, not in the
  // locked 5-item menu, no inventory effects wired).
  EXTRA_SHOT("flat_white"),
  OAT_MILK_OPTION("flat_white"),
  ALMOND_MILK_OPTION("flat_white"),
  DECAF("flat_white"),

  EXTRA_SHOT("latte"),
  OAT_MILK_OPTION("latte"),
  ALMOND_MILK_OPTION("latte"),
  DECAF("latte"),

  EXTRA_SHOT("cortado"),
  OAT_MILK_OPTION("cortado"),
  ALMOND_MILK_OPTION("cortado"),
  DECAF("cortado"),
];

export async function seedCustomisations() {
  console.log(`  → customisations (${CUSTOMISATIONS.length})`);
  await db
    .insert(menuCustomisations)
    .values(CUSTOMISATIONS)
    .onConflictDoNothing();
}
