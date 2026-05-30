// Customisations seed — task G3
// Per-item modifications: extra shot, milk alternatives, decaf.
// Each espresso-based drink gets the same standard set of customisations.
// price_delta_zar is integer cents (R12.00 = 1200).

import { db } from "../index";
import { menuCustomisations } from "../schema";
import { ESPRESSO_DRINK_IDS } from "./menu";

export type SeedCustomisation = {
  id: string;
  menuItemId: string;
  name: string;
  priceDeltaZar: number;
};

// Standard modifications offered on every espresso-based drink.
const STANDARD_MODS: { suffix: string; name: string; priceDeltaZar: number }[] = [
  { suffix: "extra_shot", name: "Extra Shot", priceDeltaZar: 1200 },
  { suffix: "oat_milk", name: "Oat Milk", priceDeltaZar: 800 },
  { suffix: "almond_milk", name: "Almond Milk", priceDeltaZar: 800 },
  { suffix: "decaf", name: "Decaf", priceDeltaZar: 0 },
];

// Build one customisation row per (drink × standard mod).
export const CUSTOMISATIONS: SeedCustomisation[] = ESPRESSO_DRINK_IDS.flatMap(
  (drinkId) =>
    STANDARD_MODS.map((mod) => ({
      id: `mod_${drinkId.replace("menu_", "")}_${mod.suffix}`,
      menuItemId: drinkId,
      name: mod.name,
      priceDeltaZar: mod.priceDeltaZar,
    }))
);

export async function seedCustomisations() {
  console.log(`  → customisations (${CUSTOMISATIONS.length})`);
  await db
    .insert(menuCustomisations)
    .values(CUSTOMISATIONS)
    .onConflictDoNothing();
}
