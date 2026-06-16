"use server";

// Operating hours server actions — G22
// getOperatingHours: public (display-only, L04 — system never rejects orders on time)
// setOperatingHours: admin+ upsert, audit-logged
// Docs: docs/API.md · BUSINESS_RULES.md L04

import { asc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { operatingHours } from "@db/schema";
import { authorize } from "@/server/auth/guard";
import { writeAudit } from "@/server/audit";
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

const setHoursSchema = z.object({
  dayOfWeek: z.number().int().min(0).max(6),
  openTime: z.string().regex(/^\d{2}:\d{2}$/, "openTime must be HH:MM"),
  closeTime: z.string().regex(/^\d{2}:\d{2}$/, "closeTime must be HH:MM"),
  isClosed: z.boolean().optional().default(false),
  note: z.string().max(200).nullish(),
});

export type SetOperatingHoursInput = z.input<typeof setHoursSchema>;

/**
 * Upsert a single day's operating hours. Requires admin or owner.
 * L04: operating hours are DISPLAY-ONLY — this action never gates orders.
 */
export async function setOperatingHours(
  input: SetOperatingHoursInput
): Promise<ActionResult<OperatingHour>> {
  const auth = await authorize("admin", "owner");
  if (!auth.ok) return auth;
  const session = auth.session;

  const parsed = setHoursSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, code: "VALIDATION", message: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const data = parsed.data;

  const [existing] = await db
    .select({ id: operatingHours.id })
    .from(operatingHours)
    .where(eq(operatingHours.dayOfWeek, data.dayOfWeek));

  let row: typeof operatingHours.$inferSelect;

  if (existing) {
    const [updated] = await db
      .update(operatingHours)
      .set({ openTime: data.openTime, closeTime: data.closeTime, isClosed: data.isClosed, note: data.note ?? null })
      .where(eq(operatingHours.id, existing.id))
      .returning();
    row = updated!;
  } else {
    const [inserted] = await db
      .insert(operatingHours)
      .values({ dayOfWeek: data.dayOfWeek, openTime: data.openTime, closeTime: data.closeTime, isClosed: data.isClosed, note: data.note ?? null })
      .returning();
    row = inserted!;
  }

  await writeAudit({
    actorId: session.id,
    actorRole: session.role,
    action: "operating_hours.set",
    entityKind: "operating_hours",
    entityId: String(row.id),
    after: { dayOfWeek: data.dayOfWeek, openTime: data.openTime, closeTime: data.closeTime, isClosed: data.isClosed },
  });

  return {
    ok: true,
    data: {
      dayOfWeek: row.dayOfWeek,
      opensAt: row.openTime,
      closesAt: row.closeTime,
      isClosed: row.isClosed,
    },
  };
}
