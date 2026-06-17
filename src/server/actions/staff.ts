"use server";

// Staff management actions — task G-staff (Gian)
// Auth: admin and owner only for all mutations.
// Docs: docs/API.md · docs/DATA_MODEL.md → staff

import { z } from "zod";
import { eq, asc } from "drizzle-orm";
import { db } from "@/lib/db";
import { staff } from "@db/schema";
import { authorize } from "@/server/auth/guard";
import { writeAudit } from "@/server/audit";
import { hashPin, isValidPinFormat } from "@/server/auth/pin";
import type { ActionResult, Staff, StaffRole } from "@/lib/types";

// ─── Schemas ─────────────────────────────────────────────────────────────────

const createStaffSchema = z.object({
  name: z.string().min(2).max(100),
  role: z.enum(["barista", "admin"]),
  pin: z.string().regex(/^\d{4,6}$/, "PIN must be 4–6 digits"),
});

const setPinSchema = z.object({
  staffId: z.string().min(1),
  newPin: z.string().regex(/^\d{4,6}$/, "PIN must be 4–6 digits"),
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

function toStaff(row: typeof staff.$inferSelect): Staff {
  return {
    id: row.id,
    name: row.name,
    role: row.role as StaffRole,
    active: row.active,
  };
}

// ─── Actions ─────────────────────────────────────────────────────────────────

/**
 * List all staff members (active and inactive), ordered by name.
 * Auth: admin, finance, owner.
 */
export async function listStaff(): Promise<ActionResult<Staff[]>> {
  const auth = await authorize("admin");
  if (!auth.ok) return auth;

  const rows = await db
    .select()
    .from(staff)
    .orderBy(asc(staff.name));

  return { ok: true, data: rows.map(toStaff) };
}

/**
 * Create a new staff member with a hashed PIN.
 * Auth: admin, owner only.
 */
export async function createStaff(input: {
  name: string;
  role: StaffRole;
  pin: string;
}): Promise<ActionResult<Staff>> {
  const auth = await authorize("admin");
  if (!auth.ok) return auth;

  const parsed = createStaffSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      code: "INVALID_INPUT",
      message: parsed.error.issues[0]?.message ?? "Invalid input.",
    };
  }

  if (!isValidPinFormat(parsed.data.pin)) {
    return { ok: false, code: "INVALID_PIN", message: "PIN must be 4–6 digits." };
  }

  const pinHash = await hashPin(parsed.data.pin);

  const [row] = await db
    .insert(staff)
    .values({
      name: parsed.data.name,
      role: parsed.data.role,
      pinHash,
      active: true,
    })
    .returning();

  if (!row) {
    return { ok: false, code: "DB_ERROR", message: "Failed to create staff member." };
  }

  await writeAudit({
    entityKind: "staff",
    entityId: row.id,
    action: "create",
    actorId: auth.session.id,
    actorRole: auth.session.role,
    after: { name: row.name, role: row.role, active: true },
  });

  return { ok: true, data: toStaff(row) };
}

/**
 * Reset a staff member's PIN.
 * Auth: admin, owner only.
 * The new PIN is never stored in plain text — only the bcrypt hash.
 */
export async function setStaffPin(input: {
  staffId: string;
  newPin: string;
}): Promise<ActionResult> {
  const auth = await authorize("admin");
  if (!auth.ok) return auth;

  const parsed = setPinSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      code: "INVALID_INPUT",
      message: parsed.error.issues[0]?.message ?? "Invalid input.",
    };
  }

  const [existing] = await db
    .select({ id: staff.id, name: staff.name })
    .from(staff)
    .where(eq(staff.id, parsed.data.staffId));

  if (!existing) {
    return { ok: false, code: "NOT_FOUND", message: "Staff member not found." };
  }

  const pinHash = await hashPin(parsed.data.newPin);

  await db
    .update(staff)
    .set({ pinHash })
    .where(eq(staff.id, parsed.data.staffId));

  await writeAudit({
    entityKind: "staff",
    entityId: parsed.data.staffId,
    action: "reset_pin",
    actorId: auth.session.id,
    actorRole: auth.session.role,
    // Never log the PIN itself — only that it was reset.
    after: { pinReset: true },
  });

  return { ok: true, data: undefined };
}

/**
 * Deactivate a staff member (soft delete — never hard delete, rule L13).
 * A deactivated staff member cannot log in but their audit trail is preserved.
 * Auth: admin, owner only.
 */
export async function deactivateStaff(staffId: string): Promise<ActionResult> {
  const auth = await authorize("admin");
  if (!auth.ok) return auth;

  const [existing] = await db
    .select({ id: staff.id, name: staff.name, active: staff.active })
    .from(staff)
    .where(eq(staff.id, staffId));

  if (!existing) {
    return { ok: false, code: "NOT_FOUND", message: "Staff member not found." };
  }

  if (!existing.active) {
    return { ok: false, code: "ALREADY_INACTIVE", message: "Staff member is already inactive." };
  }

  // Prevent self-deactivation.
  if (staffId === auth.session.id) {
    return { ok: false, code: "SELF_DEACTIVATE", message: "You cannot deactivate your own account." };
  }

  await db
    .update(staff)
    .set({ active: false })
    .where(eq(staff.id, staffId));

  await writeAudit({
    entityKind: "staff",
    entityId: staffId,
    action: "deactivate",
    actorId: auth.session.id,
    actorRole: auth.session.role,
    before: { active: true },
    after: { active: false },
  });

  return { ok: true, data: undefined };
}

/**
 * Reactivate a previously deactivated staff member.
 * Auth: admin, owner only.
 */
export async function reactivateStaff(staffId: string): Promise<ActionResult> {
  const auth = await authorize("admin");
  if (!auth.ok) return auth;

  const [existing] = await db
    .select({ id: staff.id, active: staff.active })
    .from(staff)
    .where(eq(staff.id, staffId));

  if (!existing) {
    return { ok: false, code: "NOT_FOUND", message: "Staff member not found." };
  }

  if (existing.active) {
    return { ok: false, code: "ALREADY_ACTIVE", message: "Staff member is already active." };
  }

  await db
    .update(staff)
    .set({ active: true })
    .where(eq(staff.id, staffId));

  await writeAudit({
    entityKind: "staff",
    entityId: staffId,
    action: "reactivate",
    actorId: auth.session.id,
    actorRole: auth.session.role,
    before: { active: false },
    after: { active: true },
  });

  return { ok: true, data: undefined };
}
