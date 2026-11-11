// The 60-second device check (PRD v7.0 §6.7 "Detection", §6.0.4 T3 steps 1
// and 4, §6.8.2 "Look the device up — every 60 s while a session is open";
// REQ-006).
//
//   "A background device check every 60 s is the backstop; three consecutive
//    failures put the till into deferred mode on their own." (§6.7)
//   "A manual entry exits only manually. A check-triggered entry also exits on
//    three consecutive successful checks." (T3 step 4)
//
// NOT a scheduled job: the open till calls it (src/server/actions/deferred.ts
// runDeviceHealthCheck), so it runs only while a till is open. It reads the
// device through the existing YocoWebPosPort and changes deferred mode only
// through applyDeferredMode with the system actor (deferred_entered_by=
// 'health_check'). It never begins, sends, reads or alters a payment.
//
// Off unless the live Web POS port is selected (YOCO_WEBPOS_LIVE=1 and a key):
// the unlinked port answers device_error to every lookup, which would put
// every paying session into deferred mode three minutes after it opened.
//
// The consecutive count lives in the server process (one always-on VM, §9).
// A restart starts the count again from zero — it delays an automatic change,
// it never causes one.

import type { YocoWebPosPort } from "@/server/yoco/webpos-port";
import type { DeferredEnteredBy, DeferredFailure, SetDeferredOk } from "./mode";

/** §6.7 / §6.8.2: the check interval. A check sooner than this after the last counted one is not counted. */
export const DEVICE_CHECK_INTERVAL_MS = 60_000;
/** §6.7: three consecutive failures enter deferred mode. */
export const FAILED_CHECKS_TO_ENTER = 3;
/** T3 step 4: three consecutive successful checks exit a check-triggered entry. */
export const PASSED_CHECKS_TO_EXIT = 3;

/** The audited reason on a check-triggered entry / exit. Not PRD copy: the PRD gives none. */
export const HEALTH_CHECK_ENTER_REASON = "Card machine failed 3 device checks in a row";
export const HEALTH_CHECK_EXIT_REASON = "Card machine passed 3 device checks in a row";

export type DeviceCheckSession = {
  sessionId: string;
  /** sessionTakesPayment (S7a): deferred mode is inert where nobody pays. */
  takesPayment: boolean;
  deferred: boolean;
  enteredBy: DeferredEnteredBy | null;
  /**
   * How many times deferred mode has been entered or left in this session
   * (its deferred_mode.enter / .exit audit rows), by anyone. When it moves,
   * the streak starts again, so "three consecutive" are three under one state.
   */
  deferredChanges: number;
};

export type DeviceStreak = { sessionId: string; deferredChanges: number; fails: number; passes: number; lastAt: Date };

export type CheckRead = "pass" | "fail" | "inconclusive";

export type HealthCheckDeps = {
  now: () => Date;
  /** true only when the live Web POS adapter is selected (selectWebPosPort). */
  live: boolean;
  readDeviceId: () => Promise<string | null>;
  port: Pick<YocoWebPosPort, "lookupDevice">;
  readOpenSession: () => Promise<DeviceCheckSession | null>;
  streak: { get(): DeviceStreak | null; set(s: DeviceStreak | null): void };
  /** applyDeferredMode with the SYSTEM actor (deferred_entered_by='health_check'). */
  setDeferred: (sessionId: string, on: boolean, reason: string) => Promise<SetDeferredOk | DeferredFailure>;
};

export type HealthCheckOutcome =
  | { ran: false; why: "not_live" | "no_device" | "no_session" | "no_payment_in_session" | "too_soon" }
  | { ran: true; read: CheckRead; fails: number; passes: number; action: "entered" | "exited" | "none" };

/**
 * Pure: the streak after one read. A pass resets the fail count and a fail the
 * pass count ("consecutive"). An inconclusive read — Yoco could not be asked
 * (a fetch error is never a status, §6.8.4) — changes neither count. A new
 * session, or any change of deferred mode since the last read (by a barista,
 * an Admin or the check itself), starts the counts from zero.
 */
export function nextStreak(
  prev: DeviceStreak | null,
  session: Pick<DeviceCheckSession, "sessionId" | "deferredChanges">,
  read: CheckRead,
  at: Date
): DeviceStreak {
  const { sessionId, deferredChanges } = session;
  const same = prev && prev.sessionId === sessionId && prev.deferredChanges === deferredChanges;
  const base = same ? prev : { sessionId, deferredChanges, fails: 0, passes: 0, lastAt: at };
  if (read === "pass") return { sessionId, deferredChanges, fails: 0, passes: base.passes + 1, lastAt: at };
  if (read === "fail") return { sessionId, deferredChanges, fails: base.fails + 1, passes: 0, lastAt: at };
  return { ...base, sessionId, deferredChanges, lastAt: at };
}

/** Pure: what the streak asks of deferred mode. Only a health_check entry is ever cleared by a check. */
export function decideFromStreak(s: DeviceStreak, session: DeviceCheckSession): "enter" | "exit" | "none" {
  if (!session.deferred && s.fails >= FAILED_CHECKS_TO_ENTER) return "enter";
  if (session.deferred && session.enteredBy === "health_check" && s.passes >= PASSED_CHECKS_TO_EXIT) return "exit";
  return "none";
}

/** One device check. See the header for what it may and may not touch. */
export async function checkDeviceHealth(deps: HealthCheckDeps): Promise<HealthCheckOutcome> {
  if (!deps.live) return { ran: false, why: "not_live" };
  const deviceId = await deps.readDeviceId();
  if (!deviceId) return { ran: false, why: "no_device" };
  const session = await deps.readOpenSession();
  if (!session) {
    deps.streak.set(null);
    return { ran: false, why: "no_session" };
  }
  if (!session.takesPayment) return { ran: false, why: "no_payment_in_session" };

  const at = deps.now();
  const prev = deps.streak.get();
  if (prev && prev.sessionId === session.sessionId && at.getTime() - prev.lastAt.getTime() < DEVICE_CHECK_INTERVAL_MS) {
    return { ran: false, why: "too_soon" };
  }

  const device = await deps.port.lookupDevice(deviceId).catch(() => ({ kind: "fetch_error" as const }));
  const read: CheckRead = device.kind === "online" ? "pass" : device.kind === "device_error" ? "fail" : "inconclusive";
  const streak = nextStreak(prev, session, read, at);
  deps.streak.set(streak);

  const want = decideFromStreak(streak, session);
  let action: "entered" | "exited" | "none" = "none";
  if (want !== "none") {
    const r = await deps.setDeferred(session.sessionId, want === "enter", want === "enter" ? HEALTH_CHECK_ENTER_REASON : HEALTH_CHECK_EXIT_REASON);
    if (r.ok && r.changed) action = want === "enter" ? "entered" : "exited";
  }
  return { ran: true, read, fails: streak.fails, passes: streak.passes, action };
}

/** The streak is per-process: fine on the single always-on VM (§9); a restart starts it from zero. */
let current: DeviceStreak | null = null;
export const processStreak: HealthCheckDeps["streak"] = {
  get: () => current,
  set: (s) => { current = s; },
};
