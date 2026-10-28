"use server";

// Staff management actions — task G-staff (Gian)
// Auth: admin and owner only for all mutations.
// Docs: docs/API.md · docs/DATA_MODEL.md → staff

import { z } from "zod";
import { eq, asc, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import type { DB } from "@/lib/db";
import { staff } from "@db/schema";
import { authorize } from "@/server/auth/guard";
import { writeAudit } from "@/server/audit";
import { hashPin, isValidPinFormat, verifyPin } from "@/server/auth/pin";
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
  reactivate: z.boolean().optional(),
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

// Login (auth.ts loginWithPin) matches a PIN against every ACTIVE staff row with
// bcrypt, so two active holders of one PIN make login and attribution
// ambiguous. Same comparison here; the message never says whose PIN it is.
const PIN_TAKEN = {
  ok: false as const,
  code: "PIN_TAKEN",
  message: "That PIN can't be used. Choose a different PIN.",
};

/**
 * Serialises every PIN write (create, reset, reactivate) for the rest of the
 * transaction, so a uniqueness check and its write cannot interleave with another.
 */
async function lockPinWrites(client: DB): Promise<void> {
  await client.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${"staff_pin_write"}))`);
}

async function pinHeldByOtherActiveStaff(
  pin: string,
  exceptStaffId?: string,
  client: DB = db
): Promise<boolean> {
  const rows = await client
    .select({ id: staff.id, pinHash: staff.pinHash })
    .from(staff)
    .where(eq(staff.active, true));
  for (const r of rows) {
    if (r.id === exceptStaffId) continue;
    if (await verifyPin(pin, r.pinHash)) return true;
  }
  return false;
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

  const { name, role, pin } = parsed.data;

  return db.transaction(async (tx): Promise<ActionResult<Staff>> => {
    const txDb = tx as unknown as DB;
    await lockPinWrites(txDb);

    if (await pinHeldByOtherActiveStaff(pin, undefined, txDb)) return PIN_TAKEN;

    const pinHash = await hashPin(pin);

    const [row] = await txDb
      .insert(staff)
      .values({ name, role, pinHash, active: true })
      .returning();

    if (!row) {
      return { ok: false, code: "DB_ERROR", message: "Failed to create staff member." };
    }

    await writeAudit(
      {
        entityKind: "staff",
        entityId: row.id,
        action: "create",
        actorId: auth.session.id,
        actorRole: auth.session.role,
        after: { name: row.name, role: row.role, active: true },
      },
      txDb
    );

    return { ok: true, data: toStaff(row) };
  });
}

/**
 * Reset a staff member's PIN.
 * Auth: admin, owner only.
 * The new PIN is never stored in plain text — only the bcrypt hash.
 */
export async function setStaffPin(input: {
  staffId: string;
  newPin: string;
  /** Switch an inactive member back on with this new PIN, so no PIN clash can slip in. */
  reactivate?: boolean;
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

  const { staffId, newPin, reactivate } = parsed.data;

  // The uniqueness check and the write run in one transaction under one
  // advisory lock, so two concurrent resets cannot both pass the check.
  return db.transaction(async (tx) => {
    const txDb = tx as unknown as DB;
    await lockPinWrites(txDb);

    const [existing] = await txDb
      .select({ id: staff.id, name: staff.name, pinHash: staff.pinHash, active: staff.active })
      .from(staff)
      .where(eq(staff.id, staffId));

    if (!existing) {
      return { ok: false, code: "NOT_FOUND", message: "Staff member not found." };
    }

    if (reactivate && existing.active) {
      return { ok: false, code: "ALREADY_ACTIVE", message: "Staff member is already active." };
    }

    // A refusal is audited (it commits: nothing is thrown). Never any PIN material.
    const refuse = async (result: { ok: false; code: string; message: string }) => {
      await writeAudit(
        {
          entityKind: "staff",
          entityId: staffId,
          action: reactivate ? "reactivate_refused" : "set_pin_refused",
          actorId: auth.session.id,
          actorRole: auth.session.role,
          after: { code: result.code },
          reason: result.code,
        },
        txDb
      );
      return result;
    };

    // Switching back on needs a NEW PIN (QA R2-6): the old one may have been shared
    // while they were away. Same generic wording as PIN_TAKEN.
    if (reactivate && (await verifyPin(newPin, existing.pinHash))) {
      return refuse({ ...PIN_TAKEN, code: "PIN_REUSED" });
    }

    if (await pinHeldByOtherActiveStaff(newPin, staffId, txDb)) {
      return refuse(PIN_TAKEN);
    }

    const pinHash = await hashPin(newPin);

    await txDb
      .update(staff)
      .set(reactivate ? { pinHash, active: true } : { pinHash })
      .where(eq(staff.id, staffId));

    await writeAudit(
      {
        entityKind: "staff",
        entityId: staffId,
        action: reactivate ? "reactivate" : "reset_pin",
        actorId: auth.session.id,
        actorRole: auth.session.role,
        // Never log the PIN itself — only that it was reset.
        ...(reactivate ? { before: { active: existing.active } } : {}),
        after: reactivate ? { pinReset: true, active: true } : { pinReset: true },
      },
      txDb
    );

    return { ok: true as const, data: undefined };
  });
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

  // A PIN may have been given to someone else while this person was away, and stored
  // PINs are salted hashes that cannot be compared. So switching back on always sets a
  // new PIN: use setStaffPin({ reactivate: true }).
  void staffId;
  return {
    ok: false,
    code: "PIN_REQUIRED",
    message: "Set a new PIN to switch this staff member back on.",
  };
}
