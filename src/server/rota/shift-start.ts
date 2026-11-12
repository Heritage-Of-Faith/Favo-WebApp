// The shift-start push (PRD §6.3 "a shift-start push to whoever is on duty",
// §6.11.1 COL-23 "§6.3's shift-start push fires per session", §10.3
// barista_shifts `session_id, or shift_date + slot`).
//
// Called once, by the opening action, when a NEW session row is created. It is
// the fallback for §9.6.2 job 10's timed reminder (src/server/jobs/shift-
// reminder.ts, DEC-29): both claim notified_at, so a barista is pushed once. It:
//   1. reads the session's slot from the day's audited session creates
//      (./slot.ts), so a deleted morning session never lowers the evening's slot;
//   2. attaches the rota rows planned for (date, slot) to the session;
//   3. for each rostered, active barista with a saved subscription: claims
//      notified_at with a conditional update (so a second call never re-sends),
//      sends, and — if the push did not arrive (VAPID missing, gave up after
//      retries, subscription gone) — puts notified_at back to NULL and audits
//      `shift_start_push_failed`. One barista's failure never skips the next.
// Every rostered barista's outcome is audited. Nobody rostered → nothing: no
// push, no audit, no fallback recipient.

import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import type { DB } from "@/lib/db";
import { baristaShifts, staff } from "@db/schema";
import { writeAudit } from "@/server/audit";
import { sendShiftStartPush, type PushOutcome } from "@/server/push/send";
import { isValidPushSubscription } from "@/server/push/payload";
import { slotOfSession } from "./slot";

export type OpenedSession = { sessionId: string; sessionDate: string; opensAt: string };
type Actor = { id: string; role: string };

const FAILED_WHY: Record<Exclude<PushOutcome, "sent">, string> = {
  failed: "send_failed",
  gone: "subscription_gone",
};

export async function notifyShiftStart(
  s: OpenedSession,
  actor: Actor,
  dbc: DB = db
): Promise<{ slot: number | null; pushed: string[] }> {
  const slot = await slotOfSession(dbc, s.sessionId, s.sessionDate);
  if (slot === null) {
    console.error("[push] shift-start: session has no audited create row", { sessionId: s.sessionId });
    return { slot: null, pushed: [] };
  }

  await dbc
    .update(baristaShifts)
    .set({ sessionId: s.sessionId })
    .where(and(eq(baristaShifts.shiftDate, s.sessionDate), eq(baristaShifts.slot, slot), isNull(baristaShifts.sessionId)));

  const due = await dbc
    .select({
      id: baristaShifts.id, staffId: baristaShifts.staffId,
      active: staff.active, pushSubscription: staff.pushSubscription,
    })
    .from(baristaShifts)
    .innerJoin(staff, eq(baristaShifts.staffId, staff.id))
    .where(and(eq(baristaShifts.sessionId, s.sessionId), isNull(baristaShifts.notifiedAt)));

  const pushed: string[] = [];
  for (const shift of due) {
    const audit = (action: string, after: Record<string, unknown>) =>
      writeAudit(
        {
          entityKind: "barista_shift", entityId: shift.id, action,
          actorId: actor.id, actorRole: actor.role,
          after: { sessionId: s.sessionId, staffId: shift.staffId, sessionDate: s.sessionDate, slot, ...after },
        },
        dbc
      );

    try {
      if (!shift.active) { await audit("shift_start_push", { pushed: false, why: "inactive" }); continue; }
      const sub = shift.pushSubscription;
      if (!isValidPushSubscription(sub)) { await audit("shift_start_push", { pushed: false, why: "no_subscription" }); continue; }

      const [claimed] = await dbc
        .update(baristaShifts)
        .set({ notifiedAt: new Date() })
        .where(and(eq(baristaShifts.id, shift.id), isNull(baristaShifts.notifiedAt)))
        .returning({ id: baristaShifts.id });
      if (!claimed) continue; // another open already sent it

      let why: string | null;
      try {
        const outcome = await sendShiftStartPush(sub, s.opensAt);
        why = outcome === "sent" ? null : FAILED_WHY[outcome];
      } catch (err) {
        console.error("[push] shift-start send threw", { shiftId: shift.id }, err);
        why = "send_error";
      }

      if (why === null) {
        await audit("shift_start_push", { pushed: true });
        pushed.push(shift.staffId);
        continue;
      }
      // Not delivered: release the claim, so the shift does not read as notified.
      await dbc
        .update(baristaShifts)
        .set({ notifiedAt: null })
        .where(eq(baristaShifts.id, claimed.id));
      await audit("shift_start_push_failed", { pushed: false, why });
    } catch (err) {
      console.error("[push] shift-start failed for one barista", { shiftId: shift.id }, err);
    }
  }
  return { slot, pushed };
}

/** Fire-and-forget: a push failure never fails the open that triggered it. */
export function fireShiftStart(s: OpenedSession, actor: Actor): void {
  notifyShiftStart(s, actor).catch((err: unknown) =>
    console.error("[push] shift-start push failed", { sessionId: s.sessionId }, err)
  );
}
