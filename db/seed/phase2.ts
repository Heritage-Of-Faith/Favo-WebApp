// Phase 2 seed runner — task G8
// Runs additively — safe to execute after Phase 1 seed (bun db:seed).
// Use: bun db:seed:phase2 (requires DATABASE_URL in .env.local)
//
// Order matters:
//   1. inventory items  (referenced by lots + recipes)
//   2. lots             (referenced by opening stock_movements)
//   3. recipes          (references menu_items from Phase 1)
//   4. alert recipients (references staff from Phase 1)

import { seedInventoryItems } from "./inventory";
import { seedLots } from "./lots";
import { seedRecipes } from "./recipes";
import { seedAlertRecipients } from "./alert-recipients";

async function main() {
  console.log("Seeding Phase 2 data...");
  await seedInventoryItems();
  await seedLots();
  await seedRecipes();
  await seedAlertRecipients();
  console.log("Phase 2 seed complete.");
  process.exit(0);
}

main().catch((err) => {
  console.error("Phase 2 seed failed:", err);
  process.exit(1);
});
