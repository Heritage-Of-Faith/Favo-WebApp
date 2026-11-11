// Deferred mode on an opening session — setDeferredMode's rules (PRD v7.0
// §6.0.4 T3, §6.7, S2a, §10.3, the §11.2 catalogue row "setDeferredMode
// (sessionId, on, reason)", the §11.3 access matrix; REQ-005, REQ-006).
//
//   on   a barista or an admin (deferred_entered_by='manual'), or the device
//        check, a system actor ('health_check'). Writes opening_sessions
//        .deferred_*, audits with the reason, and — after the commit — fires
//        S2a's Admin push naming the barista, the session and the reason.
//   off  "A manual entry exits only manually"; a check-triggered entry also
//        exits on passing checks. Matrix: off-when-entered-by-check is admin or
//        system only (REQ-006 — a barista is refused); off-when-entered-
//        manually is barista or admin, never system.
//
// `deferred_since IS NOT NULL` IS the deferred state (§10.3). Session-scoped:
// a closed session cannot be changed, and a new session starts NULL.
//
// Every refusal is audited and RETURNED (never thrown), so its audit row
// commits (CLAUDE.md §5). Nothing here touches payments or orders.
//
// Not a server action and not authenticated: src/server/actions/deferred.ts
// authorises the barista/admin and passes the actor.

import { defaultSessionMode } from "@/lib/session-mode";

export type DeferredEnteredBy = "manual" | "health_check";

export type DeferredActor =
  | { kind: "staff"; staffId: string; role: "barista" | "admin" }
  | { kind: "system" };

export type SessionDeferredState = {
  id: string;
  sessionDate: string;
  opensAt: string;
  /** opening_sessions.mode (weekday | sunday | event). */
  mode?: string | null;
  /** The session's event window's payment posture (free | standard | override), when it has one. */
  eventPaymentPosture?: string | null;
  closedAt: Date | null;
  deferredSince: Date | null;
  deferredReason: string | null;
  deferredByStaffId: string | null;
  deferredEnteredBy: DeferredEnteredBy | null;
};

export type DeferredPatch = {
  deferredSince: Date | null;
  deferredReason: string | null;
  deferredByStaffId: string | null;
  deferredEnteredBy: DeferredEnteredBy | null;
};

export type DeferredAudit = {
  entityKind: "opening_session";
  entityId: string;
  action: string;
  actorId?: string;
  actorRole: string;
  before?: unknown;
  after?: unknown;
  reason?: string;
};

export interface DeferredTx {
  /** SELECT … FOR UPDATE on the session row. */
  lockSession(sessionId: string): Promise<SessionDeferredState | null>;
  setDeferred(sessionId: string, patch: DeferredPatch): Promise<void>;
  audit(row: DeferredAudit): Promise<void>;
}

export interface DeferredStore {
  transaction<T>(fn: (tx: DeferredTx) => Promise<T>): Promise<T>;
}

/** S2a: what the Admin push names. */
export type DeferredEntryInfo = {
  sessionId: string;
  sessionDate: string;
  opensAt: string;
  reason: string;
  enteredBy: DeferredEnteredBy;
  /** NULL for a health_check entry (no barista). */
  byStaffId: string | null;
  since: Date;
};

export type DeferredDeps = {
  store: DeferredStore;
  now: () => Date;
  /** S2a's immediate push. Called after the commit; a failed push never undoes the entry. */
  notifyEntered: (info: DeferredEntryInfo) => Promise<void>;
};

// ─── copy ─────────────────────────────────────────────────────────────────────

/** S1 FORBIDDEN, verbatim: "if reached, 'Needs an admin'". */
export const NEEDS_AN_ADMIN = "Needs an admin";
/** S1 NO_SESSION (same words as src/server/tender/service.ts NO_SESSION_COPY). */
export const NO_OPEN_SESSION = "No session is open today — set the opening time first.";
/** S1 VALIDATION, "a field-level message". Not PRD copy: the PRD gives none for a missing reason. */
export const REASON_REQUIRED = "Give a reason — at least 3 characters.";
/** S1 MODE_FORBIDDEN ("A named reason"). Not PRD copy: the PRD gives none. */
export const NOBODY_PAYS_HERE = "Nobody pays in this session — deferred mode is not needed.";
/** Owner decision: a reason of at least this many non-space characters. */
export const MIN_REASON_CHARS = 3;

/**
 * S7a: deferred mode is inert where nobody pays. Owner decision: the server
 * refuses to switch it on for a weekday session (defaultSessionMode weekday)
 * unless a paying event (posture standard or override) is in force, and for a
 * free-posture event.
 */
export function sessionTakesPayment(s: Pick<SessionDeferredState, "sessionDate" | "mode" | "eventPaymentPosture">): boolean {
  if (s.mode === "event") return s.eventPaymentPosture === "standard" || s.eventPaymentPosture === "override";
  if (s.mode === "weekday") return false;
  return defaultSessionMode(s.sessionDate) !== "weekday";
}
/** §6.0.4 T3's barista copy, verbatim (client-safe, in src/lib). */
export { DEFERRED_BANNER, DEFERRED_ORDER_NOTICE } from "@/lib/deferred-copy";

/** S2a: the push repeats every 30 minutes the session stays deferred (REQ-005). */
export const DEFERRED_REMINDER_MS = 30 * 60_000;

export const DEFERRED_ENTER_ACTION = "deferred_mode.enter";
export const DEFERRED_EXIT_ACTION = "deferred_mode.exit";
export const DEFERRED_REJECT_ACTION = "deferred_mode.reject";
export const DEFERRED_REMINDER_ACTION = "deferred_mode.reminder";

export type DeferredFailure = {
  ok: false;
  code: "FORBIDDEN" | "NO_SESSION" | "VALIDATION" | "MODE_FORBIDDEN";
  message: string;
};

export type SetDeferredOk = {
  ok: true;
  /** false when the session was already in the asked-for state (nothing written, no push). */
  changed: boolean;
  deferred: boolean;
  enteredBy: DeferredEnteredBy | null;
};

export type DeferredDecision =
  | { kind: "enter"; enteredBy: DeferredEnteredBy }
  | { kind: "exit" }
  | { kind: "unchanged" }
  | { kind: "refuse"; code: DeferredFailure["code"]; message: string; reason: string };

/** Pure: what setDeferredMode does for this actor on this session. */
export function decideDeferredChange(
  session: SessionDeferredState | null,
  actor: DeferredActor,
  on: boolean,
  reason: string
): DeferredDecision {
  if (!session || session.closedAt !== null) {
    return { kind: "refuse", code: "NO_SESSION", message: NO_OPEN_SESSION, reason: "no_open_session" };
  }
  const deferred = session.deferredSince !== null;
  if (on) {
    if (deferred) return { kind: "unchanged" };
    if (!sessionTakesPayment(session)) {
      return { kind: "refuse", code: "MODE_FORBIDDEN", message: NOBODY_PAYS_HERE, reason: "no_payment_in_session" };
    }
    if (reason.replace(/\s/g, "").length < MIN_REASON_CHARS) {
      return { kind: "refuse", code: "VALIDATION", message: REASON_REQUIRED, reason: "reason_required" };
    }
    return { kind: "enter", enteredBy: actor.kind === "system" ? "health_check" : "manual" };
  }
  if (!deferred) return { kind: "unchanged" };
  if (session.deferredEnteredBy === "health_check") {
    // REQ-006: only an Admin or a passing check may clear a check-triggered entry.
    if (actor.kind === "staff" && actor.role !== "admin") {
      return { kind: "refuse", code: "FORBIDDEN", message: NEEDS_AN_ADMIN, reason: "health_check_entry_needs_admin" };
    }
    return { kind: "exit" };
  }
  // T3 step 4: "A manual entry exits only manually" — never by the device check.
  if (actor.kind === "system") {
    return { kind: "refuse", code: "FORBIDDEN", message: NEEDS_AN_ADMIN, reason: "manual_entry_exits_only_manually" };
  }
  return { kind: "exit" };
}

function actorFields(actor: DeferredActor): { actorId?: string; actorRole: string } {
  return actor.kind === "staff" ? { actorId: actor.staffId, actorRole: actor.role } : { actorRole: "system" };
}

function snapshot(s: SessionDeferredState) {
  return {
    deferredSince: s.deferredSince?.toISOString() ?? null,
    deferredReason: s.deferredReason,
    deferredByStaffId: s.deferredByStaffId,
    deferredEnteredBy: s.deferredEnteredBy,
  };
}

/**
 * setDeferredMode's rules, in one locked transaction. The S2a push runs after
 * the commit, only on an actual entry (REQ-005: "Given a session not in
 * deferred mode · When setDeferredMode(on) succeeds").
 */
export async function applyDeferredMode(
  deps: DeferredDeps,
  actor: DeferredActor,
  sessionId: string,
  on: boolean,
  reason: string
): Promise<SetDeferredOk | DeferredFailure> {
  const at = deps.now();
  const trimmed = reason.trim().replace(/\s+/g, " ");
  let entered: DeferredEntryInfo | null = null;

  const out = await deps.store.transaction(async (tx): Promise<SetDeferredOk | DeferredFailure> => {
    const session = await tx.lockSession(sessionId);
    const decision = decideDeferredChange(session, actor, on, trimmed);

    if (decision.kind === "refuse") {
      await tx.audit({
        entityKind: "opening_session",
        entityId: sessionId,
        action: DEFERRED_REJECT_ACTION,
        ...actorFields(actor),
        reason: decision.reason,
        before: session ? snapshot(session) : null,
        after: { code: decision.code, on, requestedReason: trimmed || null },
      });
      return { ok: false, code: decision.code, message: decision.message };
    }
    const s = session as SessionDeferredState;
    if (decision.kind === "unchanged") {
      return { ok: true, changed: false, deferred: s.deferredSince !== null, enteredBy: s.deferredEnteredBy };
    }
    if (decision.kind === "enter") {
      const patch: DeferredPatch = {
        deferredSince: at,
        deferredReason: trimmed,
        deferredByStaffId: actor.kind === "staff" ? actor.staffId : null,
        deferredEnteredBy: decision.enteredBy,
      };
      await tx.setDeferred(s.id, patch);
      await tx.audit({
        entityKind: "opening_session",
        entityId: s.id,
        action: DEFERRED_ENTER_ACTION,
        ...actorFields(actor),
        reason: trimmed,
        before: snapshot(s),
        after: { ...snapshot({ ...s, ...patch }) },
      });
      entered = {
        sessionId: s.id,
        sessionDate: s.sessionDate,
        opensAt: s.opensAt,
        reason: trimmed,
        enteredBy: decision.enteredBy,
        byStaffId: patch.deferredByStaffId,
        since: at,
      };
      return { ok: true, changed: true, deferred: true, enteredBy: decision.enteredBy };
    }
    const cleared: DeferredPatch = { deferredSince: null, deferredReason: null, deferredByStaffId: null, deferredEnteredBy: null };
    await tx.setDeferred(s.id, cleared);
    await tx.audit({
      entityKind: "opening_session",
      entityId: s.id,
      action: DEFERRED_EXIT_ACTION,
      ...actorFields(actor),
      reason: trimmed || undefined,
      before: snapshot(s),
      after: snapshot({ ...s, ...cleared }),
    });
    return { ok: true, changed: true, deferred: false, enteredBy: null };
  });

  if (entered) {
    try {
      await deps.notifyEntered(entered);
    } catch (err) {
      // A failed push never undoes the entry; the audit row is the durable record.
      console.error("[deferred] admin push failed", err);
    }
  }
  return out;
}

// ─── the one tap after TERMINAL_UNREACHABLE (§6.0.2, §6.7, §6.8.4) ────────────

/**
 * §6.7 "Detection": "TERMINAL_UNREACHABLE offers deferred mode one tap away";
 * T3 step 1 "One barista tap". §11.2 still audits setDeferredMode "with the
 * reason" and S2a's push names it, so the one tap carries this fixed reason
 * instead of a typed one. Not PRD copy: the PRD gives none.
 */
export const TERMINAL_UNREACHABLE_DEFERRED_REASON = "Card machine unreachable";

/**
 * The one tap: setDeferredMode(open session, on, the fixed reason) for the
 * barista or admin who tapped — deferred_entered_by='manual' (a person
 * declared it), audited, S2a's push on entry. Every rule is applyDeferredMode's:
 * a weekday / free session refuses, an already-deferred session is unchanged.
 * Touches opening_sessions and audit_log only — never orders or payments.
 */
export async function enterDeferredAfterUnreachable(
  deps: DeferredDeps,
  actor: Extract<DeferredActor, { kind: "staff" }>,
  openSessionId: string | null
): Promise<SetDeferredOk | DeferredFailure> {
  if (!openSessionId) return { ok: false, code: "NO_SESSION", message: NO_OPEN_SESSION };
  return applyDeferredMode(deps, actor, openSessionId, true, TERMINAL_UNREACHABLE_DEFERRED_REASON);
}

// ─── S2a's Admin push ─────────────────────────────────────────────────────────

export type DeferredAlert = { title: string; body: string; data: Record<string, unknown> };

/**
 * S2a: "an immediate push to the Admin role naming the barista, the session
 * and the reason". The PRD gives no wording, so this names exactly those three
 * facts and nothing more. `minutes` is set on a repeat.
 */
export function deferredAlert(
  info: Pick<DeferredEntryInfo, "sessionId" | "sessionDate" | "opensAt" | "reason" | "enteredBy" | "since">,
  baristaName: string | null,
  minutes?: number
): DeferredAlert {
  const who = info.enteredBy === "health_check" ? "device check" : (baristaName ?? "unknown barista");
  const still = minutes === undefined ? "" : ` (still on after ${minutes} min)`;
  return {
    title: `Till in deferred mode${still}`,
    body: `Session ${info.sessionDate} ${info.opensAt} · ${who} · reason: ${info.reason}`,
    data: {
      sessionId: info.sessionId,
      sessionDate: info.sessionDate,
      opensAt: info.opensAt,
      reason: info.reason,
      enteredBy: info.enteredBy,
      since: info.since.toISOString(),
      ...(minutes === undefined ? {} : { minutes, repeat: true }),
      url: "/admin/unpaid-orders",
    },
  };
}

/**
 * REQ-005's repeat: due when 30 minutes have passed since the last push for
 * this deferred session (the entry, or the previous repeat).
 */
export function deferredReminderDue(lastPushAt: Date, now: Date): boolean {
  return now.getTime() - lastPushAt.getTime() >= DEFERRED_REMINDER_MS;
}
