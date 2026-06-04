"use server";

// Operating hours server action — task G-backend (unblocks N4 OperatingHours component)
// Public — no auth required (hours are display-only; L04 rule: system never
// rejects orders based on time).
// Docs: docs/API.md · docs/DATA_MODEL.md → operating_hours

import { asc } from "drizzle-orm";
import { db } from "@/lib/db";
import { operatingHours } from "@db/schema";
import type { ActionResult, OperatingHour } from "@/lib/types";

/**
 * Returns all operating hours rows ordered by dayOfWeek (0=Sun … 6=Sat).
 * No auth required — used by landing page (N3), OperatingHours component (N4),
 * and customer PWA.
 */
export async function getOperatingHours(): Promise<ActionResult<OperatingHour[]>> {
  const rows = await db
    .select()
    .from(operatingHours)
    .orderBy(asc(operatingHours.dayOfWeek));

  return {
    ok: true,
    data: rows.map((r) => ({
      dayOfWeek: r.dayOfWeek,
      opensAt: r.openTime,
      closesAt: r.closeTime,
      isClosed: r.isClosed,
    })),
  };
}
