// Operating hours seed — task G3
// Mon–Fri 09:00–17:00 · Sun 07:00–15:00 · Sat closed.

import { db } from "../index";
import { operatingHours } from "../schema";

export async function seedHours() {
  // TODO (G3): insert 7 rows (dayOfWeek 0–6)
  // Sunday (0): 07:00–15:00 · Mon–Fri (1–5): 09:00–17:00 · Sat (6): isClosed=true
  console.log("  → operating hours (TODO G3)");
  void db;
  void operatingHours;
}
