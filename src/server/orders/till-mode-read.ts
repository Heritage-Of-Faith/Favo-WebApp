// Reads the mode and event switches in force at an instant (src/lib/till-mode.ts).
// Server only. Two plain reads, no lock: the day's opening_sessions rows, then
// — only if one of them is an event session — the windows they are bound to.

import { eq, inArray } from "drizzle-orm";
import { eventWindows, openingSessions } from "@db/schema";
import type { DB } from "@/lib/db";
import { writeAudit } from "@/server/audit";
import { resolveTillMode, offMenuScopeMessage, type TillEvent, type TillMode, type TillSessionRow } from "@/lib/till-mode";
import type { EventSwitches } from "@/lib/session-mode";

type WindowRow = EventSwitches & { id: string; name: string; startsAt: Date; endsAt: Date; createdAt?: Date | null };

/** The mode(s) and event in force at `at` on revenue day `day` (YYYY-MM-DD, SAST). */
export async function readTillMode(client: Pick<DB, "select">, day: string, at: Date): Promise<TillMode> {
  const sessions = await client
    .select({
      sessionDate: openingSessions.sessionDate, mode: openingSessions.mode,
      eventWindowId: openingSessions.eventWindowId,
      // DEC-28 (a): a bound event applies from the session's own opening.
      opensAt: openingSessions.opensAt,
    })
    .from(openingSessions)
    .where(eq(openingSessions.sessionDate, day));
  const windowIds = [
    ...new Set(sessions.filter((s) => s.mode === "event" && s.eventWindowId).map((s) => s.eventWindowId as string)),
  ];
  const windows: WindowRow[] = windowIds.length
    ? ((await client
        .select({
          id: eventWindows.id, name: eventWindows.name, startsAt: eventWindows.startsAt, endsAt: eventWindows.endsAt,
          menuScope: eventWindows.menuScope, paymentPosture: eventWindows.paymentPosture,
          consumesCupLid: eventWindows.consumesCupLid, audience: eventWindows.audience,
          extraShotSurcharge: eventWindows.extraShotSurcharge, voucherKinds: eventWindows.voucherKinds,
          createdAt: eventWindows.createdAt, // DEC-28 (c): newest window wins
        })
        .from(eventWindows)
        .where(inArray(eventWindows.id, windowIds))) as WindowRow[])
    : [];
  const byId = new Map(windows.map((w) => [w.id, w]));
  const rows: TillSessionRow[] = sessions.map((s) => ({
    sessionDate: s.sessionDate ?? day,
    mode: s.mode,
    opensAt: s.opensAt ?? null,
    window: s.eventWindowId ? byId.get(s.eventWindowId) ?? null : null,
  }));
  return resolveTillMode(rows, at);
}

/**
 * §6.0.8 / S1: an item outside the event's menu scope is refused with
 * MODE_FORBIDDEN and its named reason. §10.3.2: the denial is audited
 * (action='reject'), written on its own so no rollback can discard it.
 */
export async function refuseOffMenuScope(
  orderId: string,
  actor: { id: string; role: string },
  event: TillEvent,
  menuItemIds: string[]
): Promise<{ ok: false; code: "MODE_FORBIDDEN"; message: string }> {
  await writeAudit({
    entityKind: "order", entityId: orderId, action: "reject",
    actorId: actor.id, actorRole: actor.role,
    after: {
      attempted: "create", code: "MODE_FORBIDDEN", why: "off_menu_scope",
      eventWindowId: event.windowId, menuScope: event.menuScope, menuItemIds,
    },
    reason: "MODE_FORBIDDEN",
  });
  return { ok: false, code: "MODE_FORBIDDEN", message: offMenuScopeMessage(event.name) };
}
