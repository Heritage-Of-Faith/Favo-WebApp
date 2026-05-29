// Seed runner — task G3
// Run: bun db:seed (via `infisical run -- bun db:seed`)

import { seedMenu } from "./menu";
import { seedCustomisations } from "./customisations";
import { seedStaff } from "./staff";
import { seedCustomers } from "./customers";
import { seedHours } from "./hours";

async function main() {
  console.log("Seeding database...");
  await seedMenu();
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
