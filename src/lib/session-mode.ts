// AT-181 — the default mode of an opening session, from its date.
// AT-204 prerequisite — event windows, precedence and read-time reversion.
//
// PRD §10.3: opening_sessions.mode is "the day's mode, defaulted from the
// date, confirmed by the barista". PRD §4.2 mode table: Monday–Friday →
// Weekday; Sunday → Sunday; Saturday → "No default — the café is closed
// unless an event says otherwise", and "a session cannot be opened on a
// Saturday at all unless an event window is in force".
//
// §6.6 precedence: (1) a one-off event beats a recurring template on the same
// date; (2) an explicit event beats the date-derived mode, including Sunday,
// but overriding a Sunday needs a confirmation step; (3) absent any event the
// date decides. L18 / COL-8: a session's default is computed against that
// session's own window, never against the day and never against `now`.
//
// T7 / REQ-042: `mode='event'` is stored; whether the event is in force is read
// from the window every time. At ends_at it stops applying with no job and no
// write. Pure functions only — imported by the POS client and the server.

export type SessionMode = "weekday" | "sunday" | "event";
export type DateMode = Exclude<SessionMode, "event">;

export type MenuScope = "full" | "coffee_only" | "custom";
export type PaymentPosture = "free" | "standard" | "override";
export type Audience = "office_staff" | "church_member" | "both" | "nobody";

/** The six switches of §6.6, as snapshotted onto event_windows. */
export type EventSwitches = {
  menuScope: MenuScope;
  paymentPosture: PaymentPosture;
  consumesCupLid: boolean;
  audience: Audience;
  extraShotSurcharge: boolean;
  voucherKinds: string[];
};

/** An event_windows row as the opening step sees it. Instants are ISO strings. */
export type EventWindowView = EventSwitches & {
  id: string;
  name: string;
  eventProfileId: string | null;
  startsAt: string;
  endsAt: string;
};

/** An active event_profiles row. Default times are SAST wall clock, or null. */
export type EventProfileView = EventSwitches & {
  id: string;
  name: string;
  recurrence: string | null;
  defaultStart: string | null;
  defaultEnd: string | null;
};

/** L27: an event window may not exceed 24 hours. */
export const MAX_EVENT_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Payment postures the order path honours today. `free` (send nothing to the
 * machine, L25) and `override` (event prices via price_history, DEC-03) are not
 * built yet, so a window carrying either is neither applied nor opened: the
 * screen would say "free" while the till still charged.
 */
export const POSTURES_IN_TILL: readonly PaymentPosture[] = ["standard"];

export function postureIsInTill(p: PaymentPosture): boolean {
  return POSTURES_IN_TILL.includes(p);
}

/**
 * The switches the till does not read yet (menu scope, cup & lid, audience,
 * extra-shot surcharge) must hold the normal-Sunday values of PRD §4's mode
 * table — the same values as Untracked Church (§6.11.2). Any other value would
 * be shown as confirmed state while the till ignored it, so it is refused,
 * exactly like a posture outside POSTURES_IN_TILL. Voucher kinds are honoured.
 */
export const SWITCHES_IN_TILL = {
  menuScope: "full", consumesCupLid: true, audience: "both", extraShotSurcharge: true,
} as const satisfies Partial<EventSwitches>;

export function eventSwitchesInTill(s: EventSwitches): boolean {
  return (
    postureIsInTill(s.paymentPosture) &&
    s.menuScope === SWITCHES_IN_TILL.menuScope &&
    s.consumesCupLid === SWITCHES_IN_TILL.consumesCupLid &&
    s.audience === SWITCHES_IN_TILL.audience &&
    s.extraShotSurcharge === SWITCHES_IN_TILL.extraShotSurcharge
  );
}

/**
 * Temporary refusal (independent review of 3779b6d, REQ-042): the free-cup and
 * cup/lid code treat a day as weekday only when every opening_sessions row of
 * the date is mode 'weekday', so an event session on Mon–Fri would make office
 * staff pay for the rest of the day. Until that money decision is taken (Tier
 * A), no event-mode session or window may fall on Mon–Fri SAST. Remove this
 * guard in the story that makes the order path session-aware.
 */
export const EVENT_WEEKDAY_NOT_SUPPORTED = {
  code: "EVENT_WEEKDAY_NOT_SUPPORTED",
  message: "Events can only run on a Saturday or Sunday for now.",
} as const;

/** True for a Mon–Fri revenue day (YYYY-MM-DD, already SAST). */
export function isWeekdayDate(sessionDate: string): boolean {
  return defaultSessionMode(sessionDate) === "weekday";
}

/** The SAST revenue day (YYYY-MM-DD) of an instant — UTC+2 all year. */
export function sastDate(instant: string | Date): string {
  return new Date(new Date(instant).getTime() + 2 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/** Does any part of [startsAt, endsAt) fall on a Mon–Fri SAST? (≤ 24 h, so two days at most.) */
export function windowTouchesWeekday(startsAt: Date, endsAt: Date): boolean {
  return isWeekdayDate(sastDate(startsAt)) || isWeekdayDate(sastDate(new Date(endsAt.getTime() - 1)));
}

/**
 * Default mode for a session date (YYYY-MM-DD, already the SAST revenue day —
 * see todaySast / revenueDay), or `null` on a Saturday, which has no default.
 * A calendar date's weekday does not depend on a timezone, so it is read at
 * UTC noon.
 */
export function defaultSessionMode(sessionDate: string): DateMode | null {
  const dow = dayOfWeek(sessionDate);
  if (dow === 0) return "sunday";
  if (dow === 6) return null;
  return "weekday";
}

/** Refusal for a Saturday session with no event window in force (REQ-057). */
export const SATURDAY_CLOSED = {
  code: "SATURDAY_CLOSED",
  message: "The café is closed on Saturdays unless an event is set up. Tap Start an event.",
} as const;

function dayOfWeek(sessionDate: string): number {
  const dow = new Date(`${sessionDate}T12:00:00Z`).getUTCDay(); // 0=Sun … 6=Sat
  if (Number.isNaN(dow)) throw new Error(`Invalid session date: ${sessionDate}`);
  return dow;
}

/**
 * The instant of a SAST wall-clock time on a date. South Africa keeps UTC+2
 * all year (no daylight saving), so the offset is fixed.
 */
export function sastInstant(sessionDate: string, hhmm: string): Date {
  const d = new Date(`${sessionDate}T${hhmm}:00+02:00`);
  if (Number.isNaN(d.getTime())) throw new Error(`Invalid SAST time: ${sessionDate} ${hhmm}`);
  return d;
}

/** "HH:mm" in SAST for an instant. */
export function sastClock(instant: string | Date): string {
  const t = new Date(instant).getTime() + 2 * 60 * 60 * 1000;
  return new Date(t).toISOString().slice(11, 16);
}

function nextDate(sessionDate: string): string {
  const d = new Date(`${sessionDate}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** REQ-042: an event window is in force from starts_at up to, not including, ends_at. */
export function isWindowInForce(w: { startsAt: string | Date; endsAt: string | Date }, now: Date): boolean {
  const t = now.getTime();
  return new Date(w.startsAt).getTime() <= t && t < new Date(w.endsAt).getTime();
}

type SessionSlot = { sessionDate: string; opensAt: string; closesAt: string | null };

/**
 * L18 / COL-8: does a session's own window meet an event window? With a known
 * close time this is an overlap test. With none (the barista never records one)
 * the session's window is its opening instant, so the event must be in force
 * when the session opens — a Sunday morning never picks up the evening event.
 */
export function sessionMatchesWindow(s: SessionSlot, w: { startsAt: string; endsAt: string }): boolean {
  const open = sastInstant(s.sessionDate, s.opensAt).getTime();
  const ws = new Date(w.startsAt).getTime();
  const we = new Date(w.endsAt).getTime();
  if (s.closesAt) {
    const close = sastInstant(s.sessionDate, s.closesAt).getTime();
    if (close > open) return open < we && ws < close;
  }
  return ws <= open && open < we;
}

const BYDAY: Record<string, number> = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };

/**
 * Does an RRULE recur on this date? Only FREQ=WEEKLY;BYDAY=… is understood;
 * anything else never matches, so an unreadable rule cannot change a mode.
 */
export function profileRecursOn(recurrence: string | null, sessionDate: string): boolean {
  if (!recurrence) return false;
  const parts = Object.fromEntries(
    recurrence.split(";").map((kv) => kv.split("=") as [string, string])
  );
  if (parts.FREQ !== "WEEKLY" || !parts.BYDAY) return false;
  const dow = dayOfWeek(sessionDate);
  return parts.BYDAY.split(",").some((d) => BYDAY[d] === dow);
}

/** A recurring profile's occurrence on a date, or null if it has no usable default times. */
export function profileOccurrence(
  p: Pick<EventProfileView, "recurrence" | "defaultStart" | "defaultEnd">,
  sessionDate: string
): { startsAt: string; endsAt: string } | null {
  if (!p.defaultStart || !p.defaultEnd || !profileRecursOn(p.recurrence, sessionDate)) return null;
  const s = sastInstant(sessionDate, p.defaultStart);
  const e = sastInstant(sessionDate, p.defaultEnd);
  if (validateWindowSpan(s, e) !== null) return null;
  return { startsAt: s.toISOString(), endsAt: e.toISOString() };
}

export type ModeResolution =
  | { kind: "date"; mode: DateMode }
  | { kind: "closed" }
  | { kind: "event"; source: "window"; window: EventWindowView; overridesSunday: boolean }
  | {
      kind: "event"; source: "profile"; profile: EventProfileView;
      startsAt: string; endsAt: string; overridesSunday: boolean;
    };

/** §6.6 precedence for one session, against that session's own window (L18). */
export function resolveSessionMode(input: SessionSlot & {
  windows: readonly EventWindowView[];
  profiles: readonly EventProfileView[];
}): ModeResolution {
  const dateMode = defaultSessionMode(input.sessionDate);
  const overridesSunday = dateMode === "sunday";

  // Temporary (coordinator decision on the review of 3779b6d, REQ-042): on
  // Mon–Fri a stray window or recurring profile is ignored, so a weekday session
  // is always plain weekday and the barista is never blocked. Explicitly
  // creating a weekday event stays refused (EVENT_WEEKDAY_NOT_SUPPORTED).
  if (dateMode === "weekday") return { kind: "date", mode: "weekday" };

  // (1) A window that already exists (one-off or started) beats a recurring template.
  const window = [...input.windows]
    .filter((w) => eventSwitchesInTill(w) && sessionMatchesWindow(input, w))
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt))[0];
  if (window) return { kind: "event", source: "window", window, overridesSunday };

  for (const profile of input.profiles) {
    if (!eventSwitchesInTill(profile)) continue;
    const occ = profileOccurrence(profile, input.sessionDate);
    if (occ && sessionMatchesWindow(input, occ)) {
      return { kind: "event", source: "profile", profile, ...occ, overridesSunday };
    }
  }

  // (3) The date decides; a Saturday has nothing to decide with.
  return dateMode ? { kind: "date", mode: dateMode } : { kind: "closed" };
}

/**
 * REQ-042: the mode a session behaves in right now. A stored `event` whose
 * window has ended reads as the date default (null on a Saturday: closed).
 */
export function effectiveSessionMode(
  session: { sessionDate: string; mode: SessionMode },
  window: { startsAt: string | Date; endsAt: string | Date } | null,
  now: Date
): SessionMode | null {
  if (session.mode !== "event") return session.mode;
  if (window && isWindowInForce(window, now)) return "event";
  return defaultSessionMode(session.sessionDate);
}

/** REQ-042: the six switches while the window is in force, otherwise null. */
export function eventSwitchesInForce<W extends EventSwitches & { startsAt: string | Date; endsAt: string | Date }>(
  window: W | null,
  now: Date
): EventSwitches | null {
  if (!window || !isWindowInForce(window, now)) return null;
  const { menuScope, paymentPosture, consumesCupLid, audience, extraShotSurcharge, voucherKinds } = window;
  return { menuScope, paymentPosture, consumesCupLid, audience, extraShotSurcharge, voucherKinds };
}

/**
 * When an open session must be force-closed, or null if it is still current.
 * L07: a session never straddles midnight SAST. COL-11: a session bound to an
 * event window closes with it. The earlier of the two applies.
 */
export function forcedCloseAt(
  session: { sessionDate: string },
  window: { endsAt: string | Date } | null,
  today: string,
  now: Date
): Date | null {
  return forcedClose(session, window, today, now)?.at ?? null;
}

export type ForcedCloseReason = "day_boundary" | "event_window_expired";

/** forcedCloseAt plus the reason that owns the chosen (earlier) instant. A tie is the day boundary. */
export function forcedClose(
  session: { sessionDate: string },
  window: { endsAt: string | Date } | null,
  today: string,
  now: Date
): { at: Date; reason: ForcedCloseReason } | null {
  const candidates: { at: Date; reason: ForcedCloseReason }[] = [];
  if (session.sessionDate < today) {
    candidates.push({ at: sastInstant(nextDate(session.sessionDate), "00:00"), reason: "day_boundary" });
  }
  if (window && new Date(window.endsAt).getTime() <= now.getTime()) {
    candidates.push({ at: new Date(window.endsAt), reason: "event_window_expired" });
  }
  if (candidates.length === 0) return null;
  return candidates.reduce((a, b) => (a.at.getTime() <= b.at.getTime() ? a : b));
}

/** L27 / REQ-043: null when valid, otherwise the reason. */
export function validateWindowSpan(startsAt: Date, endsAt: Date): string | null {
  if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) return "Enter a valid end time.";
  if (endsAt.getTime() <= startsAt.getTime()) return "The end time must be after the start.";
  if (endsAt.getTime() - startsAt.getTime() > MAX_EVENT_WINDOW_MS) return "An event can't run longer than 24 hours.";
  return null;
}

// Labels are the PRD's own words (§6.6 switch table, Path A copy, §6.11.2).
const POSTURE_LABEL: Record<PaymentPosture, string> = {
  free: "free", standard: "normal prices", override: "event prices",
};
const AUDIENCE_LABEL: Record<Audience, string> = {
  office_staff: "Office Staff", church_member: "Church Member",
  both: "Office Staff + Church Member", nobody: "nobody",
};
const MENU_LABEL: Record<MenuScope, string> = {
  full: "Full", coffee_only: "Coffee-only", custom: "Custom subset",
};

/** L18 / §6.6 Path A: "Discipleship 101 · Event · free · disposables · Church Member". */
export function describeEvent(
  name: string,
  s: Pick<EventSwitches, "paymentPosture" | "consumesCupLid" | "audience">,
  endsAt: string | Date
): string {
  const cups = s.consumesCupLid ? "disposables" : "own mugs";
  return `${name} · Event · ${POSTURE_LABEL[s.paymentPosture]} · ${cups} · ${AUDIENCE_LABEL[s.audience]} · until ${sastClock(endsAt)}`;
}

/** T7: the six switches shown as confirmed state, not as choices. */
export function switchLines(s: EventSwitches): { label: string; value: string }[] {
  return [
    { label: "Menu scope", value: MENU_LABEL[s.menuScope] },
    { label: "Payment posture", value: POSTURE_LABEL[s.paymentPosture] },
    { label: "Cup & lid", value: s.consumesCupLid ? "Consumed" : "Not consumed" },
    { label: "Broadcast audience", value: AUDIENCE_LABEL[s.audience] },
    { label: "Extra-shot surcharge", value: s.extraShotSurcharge ? "Charged" : "Not charged" },
    { label: "Voucher kinds", value: s.voucherKinds.length ? s.voucherKinds.join(", ") : "none" },
  ];
}

/** A one-word label for a date mode. */
export function dateModeLabel(m: DateMode): string {
  return m === "weekday" ? "Weekday" : "Sunday";
}
