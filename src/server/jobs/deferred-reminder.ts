// §9.6.2 job 8 — the deferred-mode reminder (REQ-005, S2a; DEC-29, Mia,
// 12 Nov 2026).
//
// REQ-005: "an Admin push fires within one minute, and again every 30 minutes
// the session stays deferred". The entry push is sent by the request that
// entered deferred mode; the repeat is remindDeferredSessions (#327), which
// this timer runs. Nothing here pushes, reads or writes anything of its own.
//
// Every minute, so a repeat lands within a minute of its 30-minute mark. The
// gate asks whether any OPEN deferred session is due a repeat; if not, the
// firing is not a run — no run row, no audit, no push (job 4's pattern). Age
// is measured from the last push's audit row, so a missed firing delays the
// repeat and never resets or cancels it; a restart cannot re-push, because the
// repeat's audit row is written before the push.
//
// Reads opening_sessions and audit_log; writes audit_log only (through
// remindDeferredSessions). Never touches orders or payments (§9.6.2 rule 2).

import { db } from "@/lib/db";
import { deferredReminderDue } from "@/server/deferred/mode";
import { readDeferredReminderCandidates, remindDeferredSessions } from "@/server/deferred/drizzle-store";

export type DeferredReminderDeps = {
  /** Every open deferred session and the time of its last Admin push. */
  candidates(): Promise<{ sessionId: string; lastPushAt: Date }[]>;
  /** remindDeferredSessions: pushes and audits every due repeat; returns how many. */
  remind(now: Date): Promise<number>;
};

const defaultDeps: DeferredReminderDeps = {
  candidates: async () =>
    (await readDeferredReminderCandidates(db)).map((c) => ({ sessionId: c.session.id, lastPushAt: c.lastPushAt })),
  remind: (now) => remindDeferredSessions(db, now),
};

/** The open deferred sessions due a repeat at `now` (30 minutes since their last push). */
export function dueDeferredSessionIds(candidates: { sessionId: string; lastPushAt: Date }[], now: Date): string[] {
  return candidates.filter((c) => deferredReminderDue(c.lastPushAt, now)).map((c) => c.sessionId);
}

/** The scheduler gate: a run only when an open deferred session is due a repeat. */
export async function shouldRunDeferredReminder(firedAt: Date, deps: DeferredReminderDeps = defaultDeps): Promise<boolean> {
  return dueDeferredSessionIds(await deps.candidates(), firedAt).length > 0;
}

export async function runDeferredReminder(firedAt: Date, deps: DeferredReminderDeps = defaultDeps): Promise<{ reminded: number }> {
  return { reminded: await deps.remind(firedAt) };
}
