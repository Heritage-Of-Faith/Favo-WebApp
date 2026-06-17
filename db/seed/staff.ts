// Staff seed — task G3
// PINs are hashed with bcrypt before insert — plain PINs are NEVER stored.
// Test barista PIN is "1234" (used by the Phase 1 acceptance test).
// Docs: docs/DATA_MODEL.md · docs/BUSINESS_RULES.md

import bcrypt from "bcryptjs";
import { db } from "../index";
import { staff } from "../schema";

type StaffRole = "barista" | "admin";

export type SeedStaff = {
  id: string;
  name: string;
  role: StaffRole;
  pin: string; // plain PIN — hashed at seed time, never persisted as-is
};

const BCRYPT_ROUNDS = 10;

export const STAFF_SEED: SeedStaff[] = [
  { id: "staff_barista_sam", name: "Sam Barista", role: "barista", pin: "1234" },
  { id: "staff_barista_thandi", name: "Thandi Barista", role: "barista", pin: "2345" },
  { id: "staff_manager_mia", name: "Mia Manager", role: "admin", pin: "4321" },
  { id: "staff_owner_olivia", name: "Olivia Owner", role: "admin", pin: "1111" },
];

export async function seedStaff() {
  console.log(`  → staff (${STAFF_SEED.length})`);
  const rows = await Promise.all(
    STAFF_SEED.map(async (s) => ({
      id: s.id,
      name: s.name,
      role: s.role,
      pinHash: await bcrypt.hash(s.pin, BCRYPT_ROUNDS),
      active: true,
    }))
  );
  await db.insert(staff).values(rows).onConflictDoNothing();
}
