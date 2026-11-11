// The Postgres side of deferred mode (./mode.ts holds every rule). Thin:
//
//   createDrizzleDeferredStore   lockSession = SELECT … FOR UPDATE; audit in the same transaction
//   readOpenSessionDeferred      the open session's deferred state (createOrder, the POS banner)
//   createDeferredAdminNotifier  S2a's immediate push, through alertAdmins
//   remindDeferredSessions       REQ-005's 30-minute repeat — NOT REGISTERED with
//                                any scheduler: §9.6.2 lists seven jobs and this
//                                is not one of them (an owner question).

import { and, desc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import type { DB } from "@/lib/db";
import { writeAudit } from "@/server/audit";
import { alertAdmins } from "@/server/push/admin-alert";
import { auditLog, eventWindows, openingSessions, staff } from "@db/schema";
import {
  DEFERRED_ENTER_ACTION,
  DEFERRED_EXIT_ACTION,
  DEFERRED_REMINDER_ACTION,
  deferredAlert,
  deferredReminderDue,
  sessionTakesPayment,
  type DeferredEnteredBy,
  type DeferredEntryInfo,
  type DeferredStore,
  type DeferredTx,
  type SessionDeferredState,
} from "./mode";
import type { DeviceCheckSession } from "./health-check";

const SESSION_COLUMNS = {
  id: openingSessions.id,
  sessionDate: openingSessions.sessionDate,
  opensAt: openingSessions.opensAt,
  closedAt: openingSessions.closedAt,
  deferredSince: openingSessions.deferredSince,
  deferredReason: openingSessions.deferredReason,
  deferredByStaffId: openingSessions.deferredByStaffId,
  deferredEnteredBy: openingSessions.deferredEnteredBy,
};

function makeTx(tx: DB): DeferredTx {
  return {
    async lockSession(sessionId) {
      const [s] = await tx
        .select({ ...SESSION_COLUMNS, mode: openingSessions.mode, eventWindowId: openingSessions.eventWindowId })
        .from(openingSessions)
        .where(eq(openingSessions.id, sessionId))
        .for("update");
      if (!s) return null;
      let eventPaymentPosture: string | null = null;
      if (s.eventWindowId) {
        const [w] = await tx
          .select({ posture: eventWindows.paymentPosture })
          .from(eventWindows)
          .where(eq(eventWindows.id, s.eventWindowId));
        eventPaymentPosture = w?.posture ?? null;
      }
      const { eventWindowId: _w, ...rest } = s;
      return { ...(rest as SessionDeferredState), eventPaymentPosture };
    },
    async setDeferred(sessionId, patch) {
      await tx.update(openingSessions).set(patch).where(eq(openingSessions.id, sessionId));
    },
    async audit(row) {
      await writeAudit(row, tx);
    },
  };
}

export function createDrizzleDeferredStore(db: DB): DeferredStore {
  return { transaction: (fn) => db.transaction((tx) => fn(makeTx(tx as unknown as DB))) };
}

export type OpenSessionDeferred = {
  sessionId: string;
  /** The session's mode: deferred mode is inert on a weekday (S7a). */
  mode: string | null;
  deferred: boolean;
  enteredBy: DeferredEnteredBy | null;
  since: Date | null;
  reason: string | null;
};

/** The one open session (closed_at IS NULL, §6.11.1) and whether it is deferred; null when none is open. */
export async function readOpenSessionDeferred(client: Pick<DB, "select">): Promise<OpenSessionDeferred | null> {
  const [s] = await client
    .select({
      id: openingSessions.id,
      mode: openingSessions.mode,
      deferredSince: openingSessions.deferredSince,
      deferredEnteredBy: openingSessions.deferredEnteredBy,
      deferredReason: openingSessions.deferredReason,
    })
    .from(openingSessions)
    // At most one row: the opening_sessions_one_open partial unique index.
    .where(isNull(openingSessions.closedAt));
  if (!s) return null;
  return {
    sessionId: s.id,
    mode: s.mode ?? null,
    deferred: s.deferredSince != null,
    enteredBy: s.deferredEnteredBy ?? null,
    since: s.deferredSince ?? null,
    reason: s.deferredReason ?? null,
  };
}

/** The open session as the 60 s device check needs it (./health-check.ts); null when none is open. */
export async function readOpenSessionForDeviceCheck(client: Pick<DB, "select">): Promise<DeviceCheckSession | null> {
  const [s] = await client
    .select({ ...SESSION_COLUMNS, mode: openingSessions.mode, eventWindowId: openingSessions.eventWindowId })
    .from(openingSessions)
    .where(isNull(openingSessions.closedAt));
  if (!s) return null;
  let eventPaymentPosture: string | null = null;
  if (s.eventWindowId) {
    const [w] = await client
      .select({ posture: eventWindows.paymentPosture })
      .from(eventWindows)
      .where(eq(eventWindows.id, s.eventWindowId));
    eventPaymentPosture = w?.posture ?? null;
  }
  const [changes] = await client
    .select({ n: sql<number>`count(*)::int` })
    .from(auditLog)
    .where(and(
      eq(auditLog.entityKind, "opening_session"),
      eq(auditLog.entityId, s.id),
      inArray(auditLog.action, [DEFERRED_ENTER_ACTION, DEFERRED_EXIT_ACTION]),
    ));
  return {
    sessionId: s.id,
    takesPayment: sessionTakesPayment({ sessionDate: s.sessionDate, mode: s.mode ?? null, eventPaymentPosture }),
    deferred: s.deferredSince != null,
    enteredBy: s.deferredEnteredBy ?? null,
    deferredChanges: Number(changes?.n ?? 0),
  };
}

async function staffName(client: Pick<DB, "select">, staffId: string | null): Promise<string | null> {
  if (!staffId) return null;
  const [r] = await client.select({ name: staff.name }).from(staff).where(eq(staff.id, staffId));
  return r?.name ?? null;
}

/** S2a's immediate Admin push (REQ-005: "within one minute" — it is sent on the request that entered). */
export function createDeferredAdminNotifier(client: DB): (info: DeferredEntryInfo) => Promise<void> {
  return async (info) => {
    const a = deferredAlert(info, await staffName(client, info.byStaffId));
    await alertAdmins(a.title, a.body, a.data);
  };
}

/**
 * REQ-005's repeat: for every OPEN deferred session whose last push (the entry
 * audit row, or the last repeat's) is 30 minutes old, push again and audit the
 * repeat. Reads sessions and audit rows; writes only audit_log. Never touches
 * orders or payments.
 *
 * NOT REGISTERED: nothing calls this. §9.6.2 says "A job absent from this
 * table does not exist, and adding one means adding a row", and the register
 * has no row for it. Wiring it needs that row (owner decision).
 */
export async function remindDeferredSessions(
  client: DB,
  now: Date,
  send: (title: string, body: string, data: Record<string, unknown>) => Promise<void> = alertAdmins
): Promise<number> {
  const sessions = await client
    .select(SESSION_COLUMNS)
    .from(openingSessions)
    .where(and(isNull(openingSessions.closedAt), isNotNull(openingSessions.deferredSince)));
  let sent = 0;
  for (const s of sessions as SessionDeferredState[]) {
    const [last] = await client
      .select({ at: auditLog.at })
      .from(auditLog)
      .where(and(
        eq(auditLog.entityKind, "opening_session"),
        eq(auditLog.entityId, s.id),
        inArray(auditLog.action, [DEFERRED_ENTER_ACTION, DEFERRED_REMINDER_ACTION]),
      ))
      .orderBy(desc(auditLog.at))
      .limit(1);
    const lastPushAt = last?.at ?? (s.deferredSince as Date);
    if (!deferredReminderDue(lastPushAt, now)) continue;
    const since = s.deferredSince as Date;
    const minutes = Math.floor((now.getTime() - since.getTime()) / 60_000);
    const a = deferredAlert(
      { sessionId: s.id, sessionDate: s.sessionDate, opensAt: s.opensAt, reason: s.deferredReason ?? "", enteredBy: s.deferredEnteredBy ?? "manual", since },
      await staffName(client, s.deferredByStaffId),
      minutes
    );
    await writeAudit({
      entityKind: "opening_session",
      entityId: s.id,
      action: DEFERRED_REMINDER_ACTION,
      actorRole: "system",
      after: { minutes, deferredSince: since.toISOString() },
    }, client);
    await send(a.title, a.body, a.data);
    sent += 1;
  }
  return sent;
}
