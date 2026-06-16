// Operating hours seed — task G3
// Display-only (business rule L04 — system never rejects orders on time).
// FAVO is the café at Heritage of Faith Ministries, Reyno Ridge, Emalahleni.
//
// Sun 07:50–09:15 (before morning service). Monthly evening events: 16:00–16:45 & 18:00–19:00.
// Mon–Fri: opens ~30 min after morning prayer (prayer ends ~08:30). Hours are not guaranteed.
// Sat: closed.
//
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
  {
    dayOfWeek: 0,
    openTime: "07:50",
    closeTime: "09:15",
    isClosed: false,
    note: "Before morning service. Monthly evening services: 16:00–16:45 & 18:00–19:00.",
  },
  { dayOfWeek: 1, openTime: "08:40", closeTime: "09:10", isClosed: false, note: "After morning prayer — hours not guaranteed" },
  { dayOfWeek: 2, openTime: "08:40", closeTime: "09:10", isClosed: false, note: "After morning prayer — hours not guaranteed" },
  { dayOfWeek: 3, openTime: "08:40", closeTime: "09:10", isClosed: false, note: "After morning prayer — hours not guaranteed" },
  { dayOfWeek: 4, openTime: "08:40", closeTime: "09:10", isClosed: false, note: "After morning prayer — hours not guaranteed" },
  { dayOfWeek: 5, openTime: "08:40", closeTime: "09:10", isClosed: false, note: "After morning prayer — hours not guaranteed" },
  { dayOfWeek: 6, openTime: "00:00", closeTime: "00:00", isClosed: true, note: "Closed Saturdays" },
];

export async function seedHours() {
  console.log(`  → operating hours (${OPERATING_HOURS_SEED.length})`);
  await db.insert(operatingHours).values(OPERATING_HOURS_SEED).onConflictDoNothing();
}
