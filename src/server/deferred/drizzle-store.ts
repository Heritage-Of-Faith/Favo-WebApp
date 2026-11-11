// The Postgres side of deferred mode (./mode.ts holds every rule). Thin:
//
//   createDrizzleDeferredStore   lockSession = SELECT … FOR UPDATE; audit in the same transaction
//   readOpenSessionDeferred      the open session's deferred state (createOrder, the POS banner)
//   createDeferredAdminNotifier  S2a's immediate push, through alertAdmins
//   createCardMachineAlertStore  REQ-068's incident record (audit_log) and on-duty baristas
//   remindDeferredSessions       REQ-005's 30-minute repeat — NOT REGISTERED with
//                                any scheduler: §9.6.2 lists seven jobs and this
//                                is not one of them (an owner question).

import { and, desc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import type { DB } from "@/lib/db";
import { writeAudit } from "@/server/audit";
import { alertAdmins } from "@/server/push/admin-alert";
import { auditLog, baristaShifts, eventWindows, openingSessions, staff } from "@db/schema";
import {
  CARD_MACHINE_ALERT_ACTION,
  CARD_MACHINE_RECOVERED_ACTION,
  type CardMachineAlertStore,
} from "./card-machine-alert";
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

/**
 * The session's latest card_machine.alert / card_machine.recovered audit row.
 * Ordered by the per-session `seq` written under the session lock, so a
 * recovered row can never sort before the alert it closes, even when both
 * carry the same `at`; then `at`, then id, for rows without a seq.
 */
export async function latestCardMachineRow(client: Pick<DB, "select">, sessionId: string) {
  const [row] = await client
    .select({ action: auditLog.action, after: auditLog.after })
    .from(auditLog)
    .where(and(
      eq(auditLog.entityKind, "opening_session"),
      eq(auditLog.entityId, sessionId),
      inArray(auditLog.action, [CARD_MACHINE_ALERT_ACTION, CARD_MACHINE_RECOVERED_ACTION]),
    ))
    .orderBy(sql`(${auditLog.after}->>'seq')::int DESC NULLS LAST`, desc(auditLog.at), desc(auditLog.id))
    .limit(1);
  if (!row) return null;
  const after = (row.after ?? {}) as { incidentId?: unknown; seq?: unknown; baristaTargetedStaffIds?: unknown };
  return {
    action: row.action,
    incidentId: String(after.incidentId ?? ""),
    seq: typeof after.seq === "number" ? after.seq : 0,
    baristaTargetedStaffIds: Array.isArray(after.baristaTargetedStaffIds) ? after.baristaTargetedStaffIds.map(String) : [],
  };
}

/**
 * The Postgres side of the card-machine alert (./card-machine-alert.ts,
 * REQ-068). The incident's alerted/recovered state is the session's latest
 * card_machine.alert / card_machine.recovered audit row, read and written
 * under a row lock on the opening_sessions row. Writes only audit_log.
 */
export function createCardMachineAlertStore(client: DB): CardMachineAlertStore {
  const lockSession = (tx: DB, sessionId: string) =>
    tx.select({ id: openingSessions.id }).from(openingSessions).where(eq(openingSessions.id, sessionId)).for("update");
  const STAFF_FOR_PUSH = { staffId: staff.id, role: staff.role, active: staff.active, pushSubscription: staff.pushSubscription };

  return {
    async readOnDutyBaristas(sessionId) {
      return client
        .select(STAFF_FOR_PUSH)
        .from(baristaShifts)
        .innerJoin(staff, eq(baristaShifts.staffId, staff.id))
        .where(and(eq(baristaShifts.sessionId, sessionId), eq(staff.active, true)));
    },
    async readStaff(staffIds) {
      if (staffIds.length === 0) return [];
      return client.select(STAFF_FOR_PUSH).from(staff).where(inArray(staff.id, staffIds));
    },
    async claimAlert(row) {
      return client.transaction(async (t) => {
        const tx = t as unknown as DB;
        await lockSession(tx, row.sessionId);
        const last = await latestCardMachineRow(tx, row.sessionId);
        if (last?.action === CARD_MACHINE_ALERT_ACTION) return { claimed: false, incidentId: last.incidentId };
        await writeAudit({
          entityKind: "opening_session",
          entityId: row.sessionId,
          action: CARD_MACHINE_ALERT_ACTION,
          actorRole: "system",
          after: {
            seq: (last?.seq ?? 0) + 1,
            incidentId: row.incidentId,
            firstFailAt: row.firstFailAt.toISOString(),
            recipientKinds: row.recipientKinds,
            rosteredStaffIds: row.rosteredStaffIds,
            runnerStaffId: row.runnerStaffId,
            baristaTargetedStaffIds: row.baristaTargetedStaffIds,
          },
        }, tx);
        return { claimed: true, incidentId: row.incidentId };
      });
    },
    async closeIncident(sessionId, at, alertDelivery) {
      // Every passing check lands here: read without a lock first, and lock
      // only when there is an open incident to close.
      if ((await latestCardMachineRow(client, sessionId))?.action !== CARD_MACHINE_ALERT_ACTION) return null;
      return client.transaction(async (t) => {
        const tx = t as unknown as DB;
        await lockSession(tx, sessionId);
        const last = await latestCardMachineRow(tx, sessionId);
        if (last?.action !== CARD_MACHINE_ALERT_ACTION) return null;
        await writeAudit({
          entityKind: "opening_session",
          entityId: sessionId,
          action: CARD_MACHINE_RECOVERED_ACTION,
          actorRole: "system",
          after: {
            seq: last.seq + 1,
            incidentId: last.incidentId,
            recoveredAt: at.toISOString(),
            // The alert's real per-barista outcome; null when this process did
            // not send it (a restart) or its sends had not yet settled.
            alertDelivery,
            resolutionTargetedStaffIds: last.baristaTargetedStaffIds,
          },
        }, tx);
        return { incidentId: last.incidentId, baristaTargetedStaffIds: last.baristaTargetedStaffIds };
      });
    },
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
