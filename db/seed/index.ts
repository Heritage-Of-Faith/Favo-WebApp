// Seed runner — task G3
// Run: bun db:seed (requires DATABASE_URL in .env.local)

import { seedMenu } from "./menu";
import { seedInventoryItems } from "./inventory";
import { seedCustomisations } from "./customisations";
import { seedStaff } from "./staff";
import { seedCustomers } from "./customers";
import { seedHours } from "./hours";

async function main() {
  console.log("Seeding database...");
  await seedMenu();
  // AT-145: menu_customisations has FK columns into inventory_items
  // (substitutes_inventory_item_id / adds_inventory_item_id) — inventory items
  // are a leaf table with no dependencies, so seed them here rather than
  // waiting for the full Phase 2 seed (bun db:seed:phase2), which also
  // depends on Phase 1's menu/staff already existing and can't run first.
  await seedInventoryItems();
  await seedCustomisations();
  await seedStaff();
  await seedCustomers();
  await seedHours();
  console.log("Seed complete.");
  process.exit(0);
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
