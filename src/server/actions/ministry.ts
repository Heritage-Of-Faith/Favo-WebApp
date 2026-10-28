"use server";

// AT-205 — PRD §11.2 getMinistryRollup(from, to): admin only (role matrix
// L2691). Weekday cost + Sunday revenue and cost + event, netted (§7.2,
// §7.0.2 ROLLUP). Cache-free: every call reads the one figure path.

import { z } from "zod";
import { authorize } from "@/server/auth/guard";
import { readMinistryRollup } from "@/server/cogs/ministry-rollup";
import type { MinistryRollup } from "@/lib/ministry-rollup";
import type { ActionResult } from "@/lib/types";

const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "dates must be YYYY-MM-DD")
  .refine((d) => {
    const t = new Date(`${d}T00:00:00Z`);
    return !Number.isNaN(t.getTime()) && t.toISOString().slice(0, 10) === d;
  }, "not a real date");

const rangeSchema = z
  .object({ from: day, to: day })
  .refine((r) => r.from <= r.to, "from must not be after to");

export async function getMinistryRollup(
  from: string,
  to: string
): Promise<ActionResult<MinistryRollup & { from: string; to: string }>> {
  const auth = await authorize("admin");
  if (!auth.ok) return auth;

  const parsed = rangeSchema.safeParse({ from, to });
  if (!parsed.success) {
    return { ok: false, code: "VALIDATION", message: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  try {
    return { ok: true, data: await readMinistryRollup(parsed.data.from, parsed.data.to) };
  } catch {
    return { ok: false, code: "DB_ERROR", message: "Could not load the ministry rollup." };
  }
}
