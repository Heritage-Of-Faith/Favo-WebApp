// Operating hours seed — task G3
// Display-only (business rule L04 — system never rejects orders on time).
// Mon–Fri 09:00–17:00 · Sun 07:00–15:00 · Sat closed.
// day_of_week: 0 = Sunday … 6 = Saturday.

import { db } from "../index";
import { operatingHours } from "../schema";

export type SeedHours = {
  dayOfWeek: number;
  openTime: string;
  closeTime: string;
  isClosed: boolean;
  note?: string;
};

export const OPERATING_HOURS_SEED: SeedHours[] = [
  { dayOfWeek: 0, openTime: "07:00", closeTime: "15:00", isClosed: false, note: "Sunday" },
  { dayOfWeek: 1, openTime: "09:00", closeTime: "17:00", isClosed: false },
  { dayOfWeek: 2, openTime: "09:00", closeTime: "17:00", isClosed: false },
  { dayOfWeek: 3, openTime: "09:00", closeTime: "17:00", isClosed: false },
  { dayOfWeek: 4, openTime: "09:00", closeTime: "17:00", isClosed: false },
  { dayOfWeek: 5, openTime: "09:00", closeTime: "17:00", isClosed: false },
  { dayOfWeek: 6, openTime: "00:00", closeTime: "00:00", isClosed: true, note: "Closed Saturdays" },
];

export async function seedHours() {
  console.log(`  → operating hours (${OPERATING_HOURS_SEED.length})`);
  await db.insert(operatingHours).values(OPERATING_HOURS_SEED).onConflictDoNothing();
}
