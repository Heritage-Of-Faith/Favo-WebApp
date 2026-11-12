// §9.6.2 job 10 — the timed shift-start reminder (§6.3 "a shift-start push to
// whoever is on duty", COL-23; DEC-29, Mia, 12 Nov 2026).
//
// SHIFT_REMINDER_LEAD_MINUTES before the day's opening time, push the barista
// rostered for the day's FIRST session (barista_shifts slot 1) once.
//
// The time source, and why only slot 1: a rota row carries a date and a slot
// and no time, and an opening_sessions row is created only when a session
// opens — there is no "planned, not yet open" session (actions/opening.ts). The
// only configured opening time is operating_hours (the Admin's /admin/hours,
// display-only under L04; reading it here gates nothing). It holds one opening
// time per weekday, so it can only honestly stand for the first session. A
// later session (a Sunday evening, slot 2) has no time source and is left to
// the on-open push. A day with no operating_hours row, or marked closed, gets
// no reminder.
//
// No double push: the reminder claims barista_shifts.notified_at with the same
// conditional update as the on-open push (src/server/rota/shift-start.ts), so
// whichever runs first sends and the other finds the claim taken. A failed send
// releases the claim, so the on-open push stays the fallback. If the session
// opened while the claim was held, its on-open push already passed this shift
// by — so after releasing, the job re-runs the on-open push for that one shift
// (same claim, same payload, audited `shift_start_push` with
// via='reminder_fallback'). A failed reminder is audited and not retried. An inactive barista, or one with no
// saved subscription, is left to the on-open push, which audits them.
//
// Every minute; the gate makes a firing a run only inside the window and only
// when a reminder is owed, so a quiet minute writes nothing. Missed run: skip —
// the window is the whole lead time, so a missed minute delays the push and the
// on-open push catches anything the window missed. Writes barista_shifts.
// notified_at and audit_log only; never orders or payments (§9.6.2 rule 2).

import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { auditLog, baristaShifts, openingSessions, operatingHours, staff } from "@db/schema";
import { writeAudit } from "@/server/audit";
import { buildShiftReminderPayload, isValidPushSubscription, type PushSubscriptionShape } from "@/server/push/payload";
import { sendShiftReminderPush, sendShiftStartPush, type PushOutcome } from "@/server/push/send";
import { sastDate, sastParts } from "./schedule";

/** The PRD gives no lead time: the author's default, awaiting owner confirmation (DEC-29). */
export const SHIFT_REMINDER_LEAD_MINUTES = 60;
export const SHIFT_REMINDER_ACTION = "shift_reminder_push";
export const SHIFT_REMINDER_FAILED_ACTION = "shift_reminder_push_failed";
/** The on-open push's own audit actions (src/server/rota/shift-start.ts). */
export const SHIFT_START_PUSH_ACTION = "shift_start_push";
export const SHIFT_START_PUSH_FAILED_ACTION = "shift_start_push_failed";
/** The rota slot the opening time stands for: the day's first session. */
const FIRST_SLOT = 1;

export type OpeningHour = { openTime: string; isClosed: boolean } | null;
export type RotaShift = { id: string; staffId: string; active: boolean; pushSubscription: unknown };

export type ShiftReminderDeps = {
  /** operating_hours for a weekday (0 = Sunday), or null if none is configured. */
  openingHour(dow: number): Promise<OpeningHour>;
  /** Slot-1 rota rows for `date` with no session attached and notified_at NULL. */
  unnotifiedFirstSlotShifts(date: string): Promise<RotaShift[]>;
  /** Shifts whose reminder already failed (an audit row), so it is not retried. */
  alreadyAttempted(shiftIds: string[]): Promise<Set<string>>;
  /** notified_at = at WHERE notified_at IS NULL; true if this call took the claim. */
  claim(shiftId: string, at: Date): Promise<boolean>;
  release(shiftId: string): Promise<void>;
  send(subscription: PushSubscriptionShape, payload: string): Promise<PushOutcome>;
  /** The session the shift has been attached to since (the on-open push ran), or null. */
  openedSessionOf(shiftId: string): Promise<{ sessionId: string; opensAt: string } | null>;
  /** The on-open push itself (sendShiftStartPush). */
  sendOnOpen(subscription: PushSubscriptionShape, opensAt: string): Promise<PushOutcome>;
  audit(shiftId: string, action: string, after: Record<string, unknown>): Promise<void>;
};

const defaultDeps: ShiftReminderDeps = {
  async openingHour(dow) {
    const [r] = await db
      .select({ openTime: operatingHours.openTime, isClosed: operatingHours.isClosed })
      .from(operatingHours)
      .where(eq(operatingHours.dayOfWeek, dow))
      .orderBy(asc(operatingHours.id))
      .limit(1);
    return r ?? null;
  },
  async unnotifiedFirstSlotShifts(date) {
    return db
      .select({ id: baristaShifts.id, staffId: baristaShifts.staffId, active: staff.active, pushSubscription: staff.pushSubscription })
      .from(baristaShifts)
      .innerJoin(staff, eq(baristaShifts.staffId, staff.id))
      .where(and(
        eq(baristaShifts.shiftDate, date),
        eq(baristaShifts.slot, FIRST_SLOT),
        isNull(baristaShifts.sessionId),
        isNull(baristaShifts.notifiedAt),
      ));
  },
  async alreadyAttempted(shiftIds) {
    if (shiftIds.length === 0) return new Set();
    const rows = await db
      .select({ id: auditLog.entityId })
      .from(auditLog)
      .where(and(
        eq(auditLog.entityKind, "barista_shift"),
        eq(auditLog.action, SHIFT_REMINDER_FAILED_ACTION),
        inArray(auditLog.entityId, shiftIds),
      ));
    return new Set(rows.map((r) => r.id));
  },
  async claim(shiftId, at) {
    const r = await db
      .update(baristaShifts)
      .set({ notifiedAt: at })
      .where(and(eq(baristaShifts.id, shiftId), isNull(baristaShifts.notifiedAt)))
      .returning({ id: baristaShifts.id });
    return r.length > 0;
  },
  async release(shiftId) {
    await db.update(baristaShifts).set({ notifiedAt: null }).where(eq(baristaShifts.id, shiftId));
  },
  send: sendShiftReminderPush,
  async openedSessionOf(shiftId) {
    const [r] = await db
      .select({ sessionId: openingSessions.id, opensAt: openingSessions.opensAt })
      .from(baristaShifts)
      .innerJoin(openingSessions, eq(baristaShifts.sessionId, openingSessions.id))
      .where(eq(baristaShifts.id, shiftId));
    return r ?? null;
  },
  sendOnOpen: sendShiftStartPush,
  async audit(shiftId, action, after) {
    await writeAudit({ entityKind: "barista_shift", entityId: shiftId, action, actorRole: "system", after });
  },
};

const minutesOf = (hhmm: string) => {
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

/** The pure decision: `now` (SAST) is within the lead time before the opening, not at or after it. */
export function shiftReminderDue(now: Date, hour: OpeningHour, leadMinutes = SHIFT_REMINDER_LEAD_MINUTES): boolean {
  if (!hour || hour.isClosed) return false;
  const open = minutesOf(hour.openTime);
  if (open === null) return false;
  const p = sastParts(now);
  const nowMin = p.hour * 60 + p.minute;
  return nowMin >= open - leadMinutes && nowMin < open;
}

async function plan(now: Date, deps: ShiftReminderDeps): Promise<{ openTime: string; shifts: RotaShift[] } | null> {
  const hour = await deps.openingHour(sastParts(now).dow);
  if (!hour || !shiftReminderDue(now, hour)) return null;
  const rows = (await deps.unnotifiedFirstSlotShifts(sastDate(now))).filter(
    (s) => s.active && isValidPushSubscription(s.pushSubscription),
  );
  if (rows.length === 0) return null;
  const attempted = await deps.alreadyAttempted(rows.map((s) => s.id));
  const shifts = rows.filter((s) => !attempted.has(s.id));
  return shifts.length > 0 ? { openTime: hour.openTime, shifts } : null;
}

/** The scheduler gate: a run only inside the window and when a reminder is owed. */
export async function shouldRunShiftReminder(firedAt: Date, deps: ShiftReminderDeps = defaultDeps): Promise<boolean> {
  return (await plan(firedAt, deps)) !== null;
}

export async function runShiftReminders(
  firedAt: Date,
  deps: ShiftReminderDeps = defaultDeps,
): Promise<{ pushed: string[]; failed: string[] }> {
  const p = await plan(firedAt, deps);
  const pushed: string[] = [];
  const failed: string[] = [];
  if (!p) return { pushed, failed };
  const date = sastDate(firedAt);
  for (const s of p.shifts) {
    if (!(await deps.claim(s.id, firedAt))) continue; // the on-open push already sent it
    const base = { staffId: s.staffId, shiftDate: date, slot: FIRST_SLOT, openTime: p.openTime, leadMinutes: SHIFT_REMINDER_LEAD_MINUTES };
    const sub = s.pushSubscription as PushSubscriptionShape;
    const why = await attempt(() => deps.send(sub, buildShiftReminderPayload(p.openTime)));
    if (why === null) {
      await deps.audit(s.id, SHIFT_REMINDER_ACTION, { ...base, pushed: true });
      pushed.push(s.staffId);
      continue;
    }
    // Not delivered: give the claim back, so the on-open push is still the fallback.
    await deps.release(s.id);
    await deps.audit(s.id, SHIFT_REMINDER_FAILED_ACTION, { ...base, pushed: false, why });

    // The session may have opened while the claim was held: its on-open push
    // then passed this shift by. Re-run that push for this shift only.
    const opened = await deps.openedSessionOf(s.id);
    if (opened && (await deps.claim(s.id, firedAt))) {
      const fb = { staffId: s.staffId, sessionId: opened.sessionId, sessionDate: date, slot: FIRST_SLOT, via: "reminder_fallback" };
      const whyOpen = await attempt(() => deps.sendOnOpen(sub, opened.opensAt));
      if (whyOpen === null) {
        await deps.audit(s.id, SHIFT_START_PUSH_ACTION, { ...fb, pushed: true });
        pushed.push(s.staffId);
        continue;
      }
      await deps.release(s.id);
      await deps.audit(s.id, SHIFT_START_PUSH_FAILED_ACTION, { ...fb, pushed: false, why: whyOpen });
    }
    failed.push(s.staffId);
  }
  return { pushed, failed };
}

/** Send once; null when delivered, else why not. */
async function attempt(send: () => Promise<PushOutcome>): Promise<string | null> {
  try {
    const outcome = await send();
    return outcome === "sent" ? null : outcome === "gone" ? "subscription_gone" : "send_failed";
  } catch {
    return "send_error";
  }
}
