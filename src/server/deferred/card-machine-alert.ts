// The card-machine alert (PRD v7.0 §9.6.3 "The card machine unreachable from
// FAVO — during trading hours, within 2 minutes — the barista's own device,
// and Nikao"; REQ-068; R19; §15.1 "one alert plus one resolution notice").
//
// NOT a scheduled job: it rides the §6.7 60 s device check (./health-check.ts),
// which the open till calls. "Trading hours" = a session that takes payment is
// open — the check already skips a free weekday session (no_payment_in_session)
// and a closed till (no_session) before this runs. It never begins, sends,
// reads or alters a payment, and never changes deferred mode.
//
// Incident: from the first failed device read to the next passing one. An
// inconclusive read (Yoco could not be asked) neither counts nor ends it.
// ALERT_AFTER_FAILED_CHECKS consecutive failures raise ONE alert per incident;
// the passing read that ends an alerted incident sends ONE resolution notice.
//
// Recipients: the union of (a) the active baristas rostered on the open
// session (barista_shifts.session_id) and (b) the logged-in barista whose till
// ran the check — staff with role admin excluded from this leg, de-duplicated
// by staff id — plus every Admin (alertAdmins). Every push carries the same tag,
// so a device that is reached twice shows one notification, and the resolution
// replaces the alert. Nobody to reach on the barista leg → Admin only; no
// recipient is guessed. The till also shows an on-screen line while an
// incident is alerted (DeferredModeBar), so a barista with no saved
// subscription is never left un-alerted silently.
//
// Where the state lives:
//   • the consecutive-failure count — in the server process (one always-on VM,
//     §9). A restart starts it from zero: it can delay an alert, never repeat one.
//   • whether this incident was alerted / recovered — in audit_log
//     (card_machine.alert / card_machine.recovered on the opening_session, with
//     a per-session `seq` for a deterministic order), claimed under a row lock
//     on the session, so a restart, or two tills checking at once, never sends
//     a second alert or a second resolution for the same incident.

import type { PushOutcome } from "@/server/push/send";
import { isValidPushSubscription, type PushSubscriptionShape } from "@/server/push/payload";
import type { CheckRead } from "./health-check";

/**
 * The reading chosen for REQ-068 "when 2 minutes pass" / §9.6.3 "within 2
 * minutes": §9.6.3's "within". Alert on the 2nd consecutive failed check, i.e.
 * one check interval (60 s) after the first failed check. The machine may have
 * gone down up to one interval before that first failed check, so the alert
 * lands roughly 60–120 s after the machine stopped answering, plus the client
 * timer's drift and the lookup's own latency — "about 2 minutes at most", not a
 * hard guarantee. Waiting for a 3rd failure (2 full minutes of failed checks)
 * would put it at 120–180 s, outside "within 2 minutes".
 */
export const ALERT_AFTER_FAILED_CHECKS = 2;

export const CARD_MACHINE_ALERT_ACTION = "card_machine.alert";
export const CARD_MACHINE_RECOVERED_ACTION = "card_machine.recovered";

/** §9.6.3's named action, verbatim. */
export const CARD_MACHINE_ALERT_BODY =
  "FAVO can't reach the card machine. Check it's on and on the wifi, or switch the till to deferred.";
/** Not PRD copy: the PRD gives the body only. */
export const CARD_MACHINE_ALERT_TITLE = "Card machine not answering";
/** Not PRD copy: §9.6.3 / §15.1 require a resolution notice and give no words. */
export const CARD_MACHINE_RESOLVED_TITLE = "Card machine is back";
export const CARD_MACHINE_RESOLVED_BODY = "Card machine is back. Cards work again.";
/** One tag for every card-machine push: a device shows one notification, the resolution replaces the alert. */
export const CARD_MACHINE_PUSH_TAG = "favo-card-machine";

export type BaristaDelivery = Record<string, PushOutcome | "error">;

export type IncidentTrack = {
  sessionId: string;
  incidentId: string;
  incidentFails: number;
  firstFailAt: Date;
  /** This process claimed, or found, the alert for this incident: no further DB work until it ends. */
  alerted: boolean;
  /** The alert's real per-barista delivery outcome, once its sends settled (this process only). */
  delivery?: BaristaDelivery;
};

export type StaffForPush = { staffId: string; role: string; active: boolean; pushSubscription: unknown };

export type RecipientKind = "barista" | "admin";

export type CardMachineAlertRow = {
  sessionId: string;
  incidentId: string;
  at: Date;
  firstFailAt: Date;
  recipientKinds: RecipientKind[];
  /** Everyone rostered on the open session's shift. */
  rosteredStaffIds: string[];
  /** The logged-in staff member whose till ran the check, if any. */
  runnerStaffId: string | null;
  /** The baristas the alert was addressed to (intent — delivery is on the recovery row). */
  baristaTargetedStaffIds: string[];
};

export type ClosedIncident = { incidentId: string; baristaTargetedStaffIds: string[] };

export type CardMachineAlertStore = {
  /** Staff on barista_shifts rows attached to this session. */
  readOnDutyBaristas(sessionId: string): Promise<StaffForPush[]>;
  /** These staff rows (the check's runner; the alert's recipients at resolution). */
  readStaff(staffIds: string[]): Promise<StaffForPush[]>;
  /**
   * Under a lock on the session: if the session's latest alert/recovered row
   * is an alert, the incident is already alerted — return it unclaimed.
   * Otherwise write the alert row and return it claimed.
   */
  claimAlert(row: CardMachineAlertRow): Promise<{ claimed: boolean; incidentId: string }>;
  /**
   * Under a lock on the session: if the session's latest alert/recovered row
   * is an alert, write the matching recovered row (with the alert's delivery,
   * when known) and return the alert's incident; otherwise null.
   */
  closeIncident(sessionId: string, at: Date, alertDelivery: BaristaDelivery | null): Promise<ClosedIncident | null>;
};

export type CardMachineAlertDeps = {
  track: { get(): IncidentTrack | null; set(t: IncidentTrack | null): void };
  store: CardMachineAlertStore;
  newIncidentId: () => string;
  pushBarista: (sub: PushSubscriptionShape, payload: string) => Promise<PushOutcome>;
  pushAdmins: (title: string, body: string, data: Record<string, unknown>, tag: string) => Promise<void>;
  /** Runs the sends without holding up the device check (production: fire-and-forget). */
  dispatch: (sends: Promise<unknown>) => void;
};

export type DeviceReadInput = { sessionId: string; read: CheckRead; at: Date; runnerStaffId: string | null };

export type CardMachineAlertResult =
  | { alerted: true; incidentId: string; recipientKinds: RecipientKind[] }
  | { resolved: true; incidentId: string }
  | { alerted: false; why: "pass" | "inconclusive" | "below_threshold" | "already_alerted" };

function payload(title: string, body: string, incidentId: string): string {
  return JSON.stringify({ title, body, data: { url: "/pos", incidentId }, tag: CARD_MACHINE_PUSH_TAG });
}
export const buildCardMachineAlertPayload = (incidentId: string) =>
  payload(CARD_MACHINE_ALERT_TITLE, CARD_MACHINE_ALERT_BODY, incidentId);
export const buildCardMachineResolvedPayload = (incidentId: string) =>
  payload(CARD_MACHINE_RESOLVED_TITLE, CARD_MACHINE_RESOLVED_BODY, incidentId);

/** Pure: the incident count after one read. A different session starts from nothing. */
export function nextIncident(
  prev: IncidentTrack | null,
  sessionId: string,
  read: CheckRead,
  at: Date,
  newIncidentId: () => string
): IncidentTrack | null {
  const same = prev && prev.sessionId === sessionId ? prev : null;
  if (read === "pass") return null;
  if (read === "inconclusive") return same;
  return same
    ? { ...same, incidentFails: same.incidentFails + 1 }
    : { sessionId, incidentId: newIncidentId(), incidentFails: 1, firstFailAt: at, alerted: false };
}

/** Pure: the barista leg — active, not an Admin (they get the Admin leg), once each. */
export function baristaRecipients(rostered: StaffForPush[], runner: StaffForPush[]): StaffForPush[] {
  const seen = new Set<string>();
  const out: StaffForPush[] = [];
  for (const s of [...rostered, ...runner]) {
    if (!s.active || s.role === "admin" || seen.has(s.staffId)) continue;
    seen.add(s.staffId);
    out.push(s);
  }
  return out;
}

/** Pure: whether the till should show its on-screen line for this session. */
export function cardMachineDownFor(track: IncidentTrack | null, sessionId: string | null): boolean {
  return !!track && !!sessionId && track.sessionId === sessionId && track.alerted;
}

/**
 * Pure: the till's on-screen line after one runDeviceHealthCheck call. null =
 * no check ran this time (too soon after the last), so the till keeps what it
 * shows; false when no paid session is being checked; else the incident state.
 * Process-held: after a restart the line returns on the next alerted check.
 */
export function tillCardMachineLine(
  out: { ran: true } | { ran: false; why: string },
  track: IncidentTrack | null,
  checkedSessionId: string | null
): boolean | null {
  if (!out.ran) return out.why === "too_soon" ? null : false;
  return cardMachineDownFor(track, checkedSessionId);
}

function send(
  deps: CardMachineAlertDeps,
  to: StaffForPush[],
  body: string,
  title: string,
  data: string,
  incidentId: string,
  onBaristas?: (d: BaristaDelivery) => void
): void {
  const delivery: BaristaDelivery = {};
  const sends = [
    ...to.map((b) =>
      Promise.resolve()
        .then(() => deps.pushBarista(b.pushSubscription as PushSubscriptionShape, data))
        .then((outcome) => {
          delivery[b.staffId] = outcome;
          if (outcome !== "sent") console.error("[push] card-machine push not delivered", { staffId: b.staffId, outcome });
        }, (err: unknown) => {
          delivery[b.staffId] = "error";
          throw err;
        })
    ),
    Promise.resolve().then(() => deps.pushAdmins(title, body, { url: "/pos", incidentId }, CARD_MACHINE_PUSH_TAG)),
  ].map((p) => p.catch((err: unknown) => console.error("[push] card-machine push failed", { incidentId }, err)));
  deps.dispatch(Promise.allSettled(sends).then(() => onBaristas?.(delivery)));
}

/** Called by the device check after each counted read. Throws only if a store call throws; the caller swallows. */
export async function onDeviceRead(deps: CardMachineAlertDeps, input: DeviceReadInput): Promise<CardMachineAlertResult> {
  const { sessionId, read, at, runnerStaffId } = input;
  const prev = deps.track.get();
  const track = nextIncident(prev, sessionId, read, at, deps.newIncidentId);
  deps.track.set(track);

  if (read === "pass") {
    const delivery = prev && prev.sessionId === sessionId ? prev.delivery ?? null : null;
    const closed = await deps.store.closeIncident(sessionId, at, delivery);
    if (!closed) return { alerted: false, why: "pass" };
    const to = (await deps.store.readStaff(closed.baristaTargetedStaffIds))
      .filter((s) => s.active && isValidPushSubscription(s.pushSubscription));
    send(deps, to, CARD_MACHINE_RESOLVED_BODY, CARD_MACHINE_RESOLVED_TITLE,
      buildCardMachineResolvedPayload(closed.incidentId), closed.incidentId);
    return { resolved: true, incidentId: closed.incidentId };
  }
  if (!track) return { alerted: false, why: "inconclusive" };
  if (track.incidentFails < ALERT_AFTER_FAILED_CHECKS) return { alerted: false, why: "below_threshold" };
  if (track.alerted) return { alerted: false, why: "already_alerted" };

  const rostered = await deps.store.readOnDutyBaristas(sessionId);
  const runner = runnerStaffId ? await deps.store.readStaff([runnerStaffId]) : [];
  const to = baristaRecipients(rostered, runner).filter((s) => isValidPushSubscription(s.pushSubscription));
  const recipientKinds: RecipientKind[] = to.length > 0 ? ["barista", "admin"] : ["admin"];
  const claim = await deps.store.claimAlert({
    sessionId,
    incidentId: track.incidentId,
    at,
    firstFailAt: track.firstFailAt,
    recipientKinds,
    rosteredStaffIds: rostered.map((b) => b.staffId),
    runnerStaffId,
    baristaTargetedStaffIds: to.map((b) => b.staffId),
  });
  // Claimed here, or already in the audit log (a restart mid-incident): either way, done.
  deps.track.set({ ...track, incidentId: claim.incidentId, alerted: true });
  if (!claim.claimed) return { alerted: false, why: "already_alerted" };

  send(deps, to, CARD_MACHINE_ALERT_BODY, CARD_MACHINE_ALERT_TITLE,
    buildCardMachineAlertPayload(claim.incidentId), claim.incidentId, (delivery) => {
      const now = deps.track.get();
      if (now && now.incidentId === claim.incidentId) deps.track.set({ ...now, delivery });
    });
  return { alerted: true, incidentId: claim.incidentId, recipientKinds };
}

/** Per-process incident count: fine on the single always-on VM (§9); see the header. */
let currentIncident: IncidentTrack | null = null;
export const processIncident: CardMachineAlertDeps["track"] = {
  get: () => currentIncident,
  set: (t) => { currentIncident = t; },
};
