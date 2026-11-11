"use server";

// AT-207 — the §6.0.5 write-off approval queue (REQ-035).
// "The close then raises an Admin approval item listing every write-off with
// its daily_seq, value, reason and barista, which an Admin clears with a PIN …
// Until cleared, the day's write-offs report as `unapproved`."
//
// One approval per revenue day (the PRD's "item … listing every write-off"),
// never per order. Admin only (§11.3 matrix: "Approve a write-off in the
// §6.0.5 queue" — admin ✔ only), and the Admin re-enters their own PIN, which
// is bcrypt-compared against staff.pin_hash exactly as loginWithPin does.
// A wrong PIN is refused and audited. Approving changes no order and no
// payment: it writes one audit row, and `unapproved` is the absence of it.

import { z } from "zod";
import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import type { DB } from "@/lib/db";
import { staff } from "@db/schema";
import { authorize } from "@/server/auth/guard";
import { writeAudit } from "@/server/audit";
import { isValidPinFormat, verifyPin } from "@/server/auth/pin";
import { checkRateLimit } from "@/server/rate-limit";
import {
  DAILY_CLOSE_ENTITY,
  WRITE_OFF_APPROVAL_REFUSED_ACTION,
  WRITE_OFF_APPROVED_ACTION,
  dayWriteOffStatus,
  listBlockedDailyCloses,
  listUnapprovedWriteOffDays,
  type BlockedClose,
  type QueueDay,
} from "@/server/close/write-offs";
import type { ActionResult } from "@/lib/types";

const daySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "A revenue day is YYYY-MM-DD");

// Same shape as the PIN login limit (auth.ts): 5 tries a minute, per admin.
const APPROVE_LIMIT = 5;
const APPROVE_WINDOW_MS = 60_000;

/** The approval queue: every revenue day with unapproved write-offs. Admin only. */
export async function listWriteOffApprovalQueue(): Promise<ActionResult<QueueDay[]>> {
  const auth = await authorize("admin");
  if (!auth.ok) return auth;
  return { ok: true, data: await listUnapprovedWriteOffDays(db) };
}

/** REQ-036: blocked close records, for the admin in-app alert. Admin only. */
export async function listBlockedCloses(): Promise<ActionResult<BlockedClose[]>> {
  const auth = await authorize("admin");
  if (!auth.ok) return auth;
  return { ok: true, data: await listBlockedDailyCloses(db) };
}

/**
 * Clear one revenue day's write-offs with the Admin's PIN. Refuses a non-admin,
 * a wrong PIN (audited), a day with nothing written off, and a day already
 * approved. Audited with the Admin as actor.
 */
export async function approveDayWriteOffs(
  revenueDay: string,
  pin: string
): Promise<ActionResult<{ revenueDay: string; count: number; totalZar: number }>> {
  const auth = await authorize("admin");
  if (!auth.ok) return auth;
  const adminId = auth.session.id;

  if (!daySchema.safeParse(revenueDay).success) {
    return { ok: false, code: "INVALID_INPUT", message: "A revenue day is YYYY-MM-DD." };
  }
  if (!isValidPinFormat(pin)) {
    return { ok: false, code: "INVALID_PIN_FORMAT", message: "PIN must be 4–6 digits." };
  }
  const rl = checkRateLimit(`writeoff-approve:${adminId}`, APPROVE_LIMIT, APPROVE_WINDOW_MS);
  if (!rl.allowed) {
    return { ok: false, code: "RATE_LIMITED", message: `Too many attempts. Try again in ${rl.retryAfterSecs}s.` };
  }

  const [me] = await db
    .select({ pinHash: staff.pinHash, active: staff.active, role: staff.role })
    .from(staff)
    .where(eq(staff.id, adminId));
  const pinOk = !!me && me.active && me.role === "admin" && (await verifyPin(pin, me.pinHash));
  if (!pinOk) {
    // Never records the attempted PIN.
    await writeAudit({
      entityKind: DAILY_CLOSE_ENTITY,
      entityId: revenueDay,
      action: WRITE_OFF_APPROVAL_REFUSED_ACTION,
      actorId: adminId,
      actorRole: "admin",
      reason: "Incorrect admin PIN",
    });
    return { ok: false, code: "INVALID_CREDENTIALS", message: "Incorrect PIN." };
  }

  return db.transaction(async (tx) => {
    const txDb = tx as unknown as DB;
    // Two Admins approving the same day at once: the second waits, then sees it approved.
    await txDb.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`write_off_approval:${revenueDay}`}))`);
    const day = await dayWriteOffStatus(txDb, revenueDay);
    if (day.count === 0) {
      return { ok: false as const, code: "NOTHING_TO_APPROVE", message: `No write-offs on ${revenueDay}.` };
    }
    if (day.approved) {
      return { ok: false as const, code: "ALREADY_APPROVED", message: `The write-offs of ${revenueDay} are already approved.` };
    }
    await writeAudit(
      {
        entityKind: DAILY_CLOSE_ENTITY,
        entityId: revenueDay,
        action: WRITE_OFF_APPROVED_ACTION,
        actorId: adminId,
        actorRole: "admin",
        after: { revenueDay, count: day.count, totalZar: day.totalZar, orderIds: day.orderIds },
        reason: "Admin PIN",
      },
      txDb
    );
    return { ok: true as const, data: { revenueDay, count: day.count, totalZar: day.totalZar } };
  });
}
