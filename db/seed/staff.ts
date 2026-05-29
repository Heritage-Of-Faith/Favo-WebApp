// Staff seed — task G3
// Baristas + managers. PIN: "1234" for test barista. Docs: docs/DATA_MODEL.md

import { db } from "../index";
import { staff } from "../schema";

export async function seedStaff() {
  // TODO (G3): insert test barista (PIN: 1234 hashed), admin manager
  // Use bcrypt.hash("1234", 10) for pin_hash — NEVER store plain text
  console.log("  → staff (TODO G3)");
  void db;
  void staff;
}
