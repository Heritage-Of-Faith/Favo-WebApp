// Customer seed — task G3
// "Louis" is the Phase 1 acceptance-test customer (searched by "Lou").
// Docs: docs/PLANNING.md → Phase 1 verification

import { db } from "../index";
import { customers } from "../schema";

export type SeedCustomer = {
  id: string;
  name: string;
  phone: string;
  email: string;
  loyaltyPoints: number;
};

export const CUSTOMERS_SEED: SeedCustomer[] = [
  {
    id: "cust_louis",
    name: "Louis",
    phone: "0821234567",
    email: "louis@example.com",
    loyaltyPoints: 50,
  },
  {
    id: "cust_naledi",
    name: "Naledi Khumalo",
    phone: "0739876543",
    email: "naledi@example.com",
    loyaltyPoints: 120,
  },
];

export async function seedCustomers() {
  console.log(`  → customers (${CUSTOMERS_SEED.length})`);
  await db.insert(customers).values(CUSTOMERS_SEED).onConflictDoNothing();
}
