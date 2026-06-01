"use server";

// Operating hours server action — owner: Nikao (task N4)
// Public data — no auth required.

import { db } from "@/lib/db";
import { operatingHours } from "@db/schema";
import { asc } from "drizzle-orm";

export interface OperatingHour {
  dayOfWeek: number;  // 0 = Sun … 6 = Sat
  opensAt: string;    // "09:00"
  closesAt: string;   // "17:00"
  isClosed: boolean;
}

type GetOperatingHoursResult =
  | { ok: true; data: OperatingHour[] }
  | { ok: false; code: string; message: string };

export async function getOperatingHours(): Promise<GetOperatingHoursResult> {
  try {
    const rows = await db
      .select({
        dayOfWeek: operatingHours.dayOfWeek,
        openTime: operatingHours.openTime,
        closeTime: operatingHours.closeTime,
        isClosed: operatingHours.isClosed,
      })
      .from(operatingHours)
      .orderBy(asc(operatingHours.dayOfWeek));

    const data: OperatingHour[] = rows.map((r) => ({
      dayOfWeek: r.dayOfWeek,
      opensAt: r.openTime,
      closesAt: r.closeTime,
      isClosed: r.isClosed,
    }));

    return { ok: true, data };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return { ok: false, code: "DB_ERROR", message };
  }
}
