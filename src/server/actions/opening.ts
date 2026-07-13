"use server";

// Opening sessions — AT-134 (backend).
//
// The barista's opening-time prompt and the admin "Today's Hours" planner both
// read/write the same opening_sessions table: same-day overrides on top of the
// recurring weekly schedule (operating_hours, which stays the fallback).
//
// Notification rules (locked on the ticket, Nikao 2026-07-05):
//  - Push fires on the FIRST submission of the day, or on a genuinely NEW
//    session (a reopening). Re-confirming an existing time never re-sends.
//  - The barista prompt notifies automatically. Admin planning edits are silent
//    by default but can opt in per action via `notify` (resolved 2026-07-13,
//    Nikao: the admin chooses when a change is worth notifying customers).
//  - The barista never records a closing time; closes_at is admin-only.

import { z } from "zod";
import { and, asc, eq, isNotNull } from "drizzle-orm";
import { db } from "@/lib/db";
import type { DB } from "@/lib/db";
import { openingSessions, customers } from "@db/schema";
import { authorize } from "@/server/auth/guard";
import { writeAudit } from "@/server/audit";
import { todaySast } from "@/server/cogs/compute";
import { sendOpeningPush } from "@/server/push/send";
import { isValidPushSubscription } from "@/server/push/payload";
import type { ActionResult } from "@/lib/types";

const POS_ROLES = ["barista", "admin"] as const;

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const timeSchema = z.string().regex(TIME_RE, "Time must be HH:mm (24h).");

export type OpeningSession = {
  id: string;
  sessionDate: string; // YYYY-MM-DD
  opensAt: string;     // "07:30"
  closesAt: string | null;
  viaPos: boolean;
  notified: boolean;
};

function toView(r: {
  id: string; sessionDate: string; opensAt: string; closesAt: string | null;
  viaPos: boolean; notifiedAt: Date | null;
}): OpeningSession {
  return {
    id: r.id, sessionDate: r.sessionDate, opensAt: r.opensAt,
    closesAt: r.closesAt, viaPos: r.viaPos, notified: r.notifiedAt !== null,
  };
}

async function listToday(dbc: DB = db): Promise<OpeningSession[]> {
  const rows = await dbc
    .select({
      id: openingSessions.id, sessionDate: openingSessions.sessionDate,
      opensAt: openingSessions.opensAt, closesAt: openingSessions.closesAt,
      viaPos: openingSessions.viaPos, notifiedAt: openingSessions.notifiedAt,
    })
    .from(openingSessions)
    .where(eq(openingSessions.sessionDate, todaySast()))
    .orderBy(asc(openingSessions.opensAt));
  return rows.map(toView);
}

/** Today's sessions (SAST), earliest first. Barista + admin. */
export async function getTodaySessions(): Promise<ActionResult<{ date: string; sessions: OpeningSession[] }>> {
  const auth = await authorize(...POS_ROLES);
  if (!auth.ok) return auth;
  return { ok: true, data: { date: todaySast(), sessions: await listToday() } };
}

/**
 * Barista prompt submit: "what time are you opening?"
 * - Time already recorded today → no-op confirm, `notified: false`.
 * - Otherwise a new session is appended and every subscribed customer is
 *   pushed ("opening" for the first session, "reopening" for later ones).
 */
export async function submitOpeningTime(
  opensAt: string
): Promise<ActionResult<{ session: OpeningSession; notified: boolean; sessions: OpeningSession[] }>> {
  const auth = await authorize(...POS_ROLES);
  if (!auth.ok) return auth;

  const parsed = timeSchema.safeParse(opensAt);
  if (!parsed.success) {
    return { ok: false, code: "INVALID_INPUT", message: "Enter a time like 07:30." };
  }
  const time = parsed.data;
  const date = todaySast();

  const existing = await listToday();
  const unchanged = existing.find((s) => s.opensAt === time);
  if (unchanged) {
    // Re-confirming an already-recorded time — never re-notifies (ticket rule 1).
    return { ok: true, data: { session: unchanged, notified: false, sessions: existing } };
  }

  const isReopening = existing.length > 0;

  const inserted = await db.transaction(async (tx) => {
    const txDb = tx as unknown as DB;
    const [row] = await tx
      .insert(openingSessions)
      .values({
        sessionDate: date, opensAt: time, viaPos: true,
        createdByStaffId: auth.session.id, notifiedAt: new Date(),
      })
      .onConflictDoNothing({ target: [openingSessions.sessionDate, openingSessions.opensAt] })
      .returning({
        id: openingSessions.id, sessionDate: openingSessions.sessionDate,
        opensAt: openingSessions.opensAt, closesAt: openingSessions.closesAt,
        viaPos: openingSessions.viaPos, notifiedAt: openingSessions.notifiedAt,
      });
    if (row) {
      await writeAudit(
        {
          entityKind: "opening_session", entityId: row.id, action: "create",
          actorId: auth.session.id, actorRole: auth.session.role,
          after: { sessionDate: date, opensAt: time, viaPos: true },
        },
        txDb
      );
    }
    return row ?? null;
  });

  if (!inserted) {
    // Concurrent submit hit the unique constraint — treat as the no-op path.
    const now = await listToday();
    const winner = now.find((s) => s.opensAt === time);
    return winner
      ? { ok: true, data: { session: winner, notified: false, sessions: now } }
      : { ok: false, code: "DB_ERROR", message: "Could not record the opening time." };
  }

  // Fan out to every subscribed customer — fire-and-forget so a push failure
  // never fails the submit.
  fanOutOpeningPush(time, isReopening);

  const sessions = await listToday();
  return { ok: true, data: { session: toView(inserted), notified: true, sessions } };
}

/**
 * Push an opening/reopening notification to every subscribed customer.
 * Fire-and-forget (mirrors the operating-hours notify path) — a push failure
 * must never fail the action that triggered it.
 */
function fanOutOpeningPush(opensAt: string, isReopening: boolean): void {
  db.select({ id: customers.id, pushSubscription: customers.pushSubscription })
    .from(customers)
    .where(isNotNull(customers.pushSubscription))
    .then((subs) => {
      for (const sub of subs) {
        if (!isValidPushSubscription(sub.pushSubscription)) continue;
        sendOpeningPush(sub.pushSubscription, opensAt, isReopening).catch(
          (err) => console.error("[push] sendOpeningPush failed", { customerId: sub.id }, err)
        );
      }
    })
    .catch((err) => console.error("[push] failed to fetch subscriptions for opening notify", err));
}

// AT-134: admin edits do NOT auto-notify (unlike the barista prompt). The admin
// opts in per action via `notify` (default false) — Nikao's decision, 2026-07-13:
// admin planning edits are often quiet corrections, so the push is a deliberate
// per-change choice, not automatic.
const adminSessionSchema = z.object({
  opensAt: timeSchema,
  closesAt: timeSchema.nullable().optional(),
  notify: z.boolean().optional().default(false),
});

/**
 * Admin planner: add a session for today. Silent by default; pushes an
 * opening/reopening notification only when `notify` is true.
 */
export async function addTodaySession(
  input: z.infer<typeof adminSessionSchema>
): Promise<ActionResult<{ sessions: OpeningSession[] }>> {
  const auth = await authorize("admin");
  if (!auth.ok) return auth;
  const parsed = adminSessionSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: "INVALID_INPUT", message: "Times must be HH:mm." };

  const date = todaySast();
  // A reopening if today already has at least one session before this add.
  const isReopening = (await listToday()).length > 0;
  const inserted = await db.transaction(async (tx) => {
    const txDb = tx as unknown as DB;
    const [row] = await tx
      .insert(openingSessions)
      .values({
        sessionDate: date, opensAt: parsed.data.opensAt,
        closesAt: parsed.data.closesAt ?? null, viaPos: false,
        createdByStaffId: auth.session.id,
        notifiedAt: parsed.data.notify ? new Date() : null,
      })
      .onConflictDoNothing({ target: [openingSessions.sessionDate, openingSessions.opensAt] })
      .returning({ id: openingSessions.id });
    if (row) {
      await writeAudit(
        {
          entityKind: "opening_session", entityId: row.id, action: "create",
          actorId: auth.session.id, actorRole: auth.session.role,
          after: { sessionDate: date, ...parsed.data, viaPos: false },
        },
        txDb
      );
    }
    return row ?? null;
  });

  // Opt-in notify: only push when the admin asked AND a new row was created
  // (a duplicate time hits onConflictDoNothing → no row → no push).
  if (inserted && parsed.data.notify) {
    fanOutOpeningPush(parsed.data.opensAt, isReopening);
  }
  return { ok: true, data: { sessions: await listToday() } };
}

/**
 * Admin planner: edit a session's times. Silent by default; pushes only when
 * `notify` is true (opt-in per edit).
 */
export async function updateTodaySession(
  id: string,
  input: z.infer<typeof adminSessionSchema>
): Promise<ActionResult<{ sessions: OpeningSession[] }>> {
  const auth = await authorize("admin");
  if (!auth.ok) return auth;
  const parsed = adminSessionSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: "INVALID_INPUT", message: "Times must be HH:mm." };

  const updated = await db.transaction(async (tx) => {
    const txDb = tx as unknown as DB;
    const [before] = await tx
      .select({ opensAt: openingSessions.opensAt, closesAt: openingSessions.closesAt })
      .from(openingSessions)
      .where(and(eq(openingSessions.id, id), eq(openingSessions.sessionDate, todaySast())));
    if (!before) return false;

    await tx
      .update(openingSessions)
      .set({
        opensAt: parsed.data.opensAt,
        closesAt: parsed.data.closesAt ?? null,
        ...(parsed.data.notify ? { notifiedAt: new Date() } : {}),
      })
      .where(eq(openingSessions.id, id));
    await writeAudit(
      {
        entityKind: "opening_session", entityId: id, action: "update",
        actorId: auth.session.id, actorRole: auth.session.role,
        before, after: parsed.data,
      },
      txDb
    );
    return true;
  });

  if (!updated) return { ok: false, code: "NOT_FOUND", message: "Session not found for today." };
  // Opt-in notify: push the (possibly changed) opening time when the admin asked.
  if (parsed.data.notify) fanOutOpeningPush(parsed.data.opensAt, false);
  return { ok: true, data: { sessions: await listToday() } };
}

/** Admin planner: remove a session. Silent — no customer push. */
export async function deleteTodaySession(
  id: string
): Promise<ActionResult<{ sessions: OpeningSession[] }>> {
  const auth = await authorize("admin");
  if (!auth.ok) return auth;

  const deleted = await db.transaction(async (tx) => {
    const txDb = tx as unknown as DB;
    const [before] = await tx
      .select({ opensAt: openingSessions.opensAt, closesAt: openingSessions.closesAt })
      .from(openingSessions)
      .where(and(eq(openingSessions.id, id), eq(openingSessions.sessionDate, todaySast())));
    if (!before) return false;

    await tx.delete(openingSessions).where(eq(openingSessions.id, id));
    await writeAudit(
      {
        entityKind: "opening_session", entityId: id, action: "delete",
        actorId: auth.session.id, actorRole: auth.session.role,
        before, after: null,
      },
      txDb
    );
    return true;
  });

  if (!deleted) return { ok: false, code: "NOT_FOUND", message: "Session not found for today." };
  return { ok: true, data: { sessions: await listToday() } };
}
