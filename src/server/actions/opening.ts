"use server";

// Opening sessions — AT-134 (backend).
//
// The barista's opening-time prompt and the admin "Today's Hours" planner both
// read/write the same opening_sessions table: same-day overrides on top of the
// recurring weekly schedule (operating_hours, which stays the fallback).
//
// Notification rules (locked on the ticket, Nikao 2026-07-05):
//  - Push fires on the FIRST submission of the day, or on a genuinely NEW
//    session (a reopening). Re-confirming an existing time never re-sends.
//  - The barista prompt notifies automatically. Admin planning edits are silent
//    by default but can opt in per action via `notify` (resolved 2026-07-13,
//    Nikao: the admin chooses when a change is worth notifying customers).
//  - The barista never records a closing time; closes_at is admin-only.
//
// AT-204 prerequisite (PRD §6.11.1, §6.6, L18, L27, REQ-042/043/044/057):
//  - At most one session is open at a time (closed_at IS NULL, enforced by the
//    opening_sessions_one_open index). Every path that creates a session goes
//    through openSessionCore, which rejects with STALE_STATE while one is open
//    — not while a row exists for today. UNIQUE(session_date, opens_at) stays.
//  - The mode is resolved against the session's own window (§6.6 precedence,
//    src/lib/session-mode.ts) and the barista's confirm must match it.
//  - A session left open past midnight (L07) or past its event window's end
//    (COL-11) is force-closed, audited as system, the next time a session is
//    opened. Reads treat it as no current session. No scheduled job is involved.

import { z } from "zod";
import { and, asc, eq, gt, isNotNull, isNull, lt } from "drizzle-orm";
import { db } from "@/lib/db";
import type { DB } from "@/lib/db";
import { openingSessions, customers, eventWindows, eventProfiles } from "@db/schema";
import { authorize } from "@/server/auth/guard";
import { writeAudit } from "@/server/audit";
import { todaySast } from "@/server/cogs/compute";
import {
  SATURDAY_CLOSED, resolveSessionMode, forcedCloseAt, forcedClose, sastInstant, validateWindowSpan,
  postureIsInTill, eventSwitchesInTill, EVENT_WEEKDAY_NOT_SUPPORTED, isWeekdayDate, windowTouchesWeekday,
  type DateMode, type EventProfileView, type EventSwitches, type EventWindowView,
  type SessionMode,
} from "@/lib/session-mode";
import { sendOpeningPush } from "@/server/push/send";
import { isValidPushSubscription } from "@/server/push/payload";
import type { ActionResult } from "@/lib/types";

const POS_ROLES = ["barista", "admin"] as const;

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const timeSchema = z.string().regex(TIME_RE, "Time must be HH:mm (24h).");

export type OpeningSession = {
  id: string;
  sessionDate: string; // YYYY-MM-DD
  opensAt: string;     // "07:30"
  closesAt: string | null;
  viaPos: boolean;
  notified: boolean;
};

function toView(r: {
  id: string; sessionDate: string; opensAt: string; closesAt: string | null;
  viaPos: boolean; notifiedAt: Date | null;
}): OpeningSession {
  return {
    id: r.id, sessionDate: r.sessionDate, opensAt: r.opensAt,
    closesAt: r.closesAt, viaPos: r.viaPos, notified: r.notifiedAt !== null,
  };
}

async function listToday(dbc: DB = db): Promise<OpeningSession[]> {
  const rows = await dbc
    .select({
      id: openingSessions.id, sessionDate: openingSessions.sessionDate,
      opensAt: openingSessions.opensAt, closesAt: openingSessions.closesAt,
      viaPos: openingSessions.viaPos, notifiedAt: openingSessions.notifiedAt,
    })
    .from(openingSessions)
    .where(eq(openingSessions.sessionDate, todaySast()))
    .orderBy(asc(openingSessions.opensAt));
  return rows.map(toView);
}

/** Today's sessions (SAST), earliest first. Barista + admin. */
export async function getTodaySessions(): Promise<ActionResult<{ date: string; sessions: OpeningSession[] }>> {
  const auth = await authorize(...POS_ROLES);
  if (!auth.ok) return auth;
  return { ok: true, data: { date: todaySast(), sessions: await listToday() } };
}

// ─── The open session, event windows, profiles ────────────────────────────────

type OpenRow = {
  id: string; sessionDate: string; opensAt: string; closesAt: string | null;
  viaPos: boolean; notifiedAt: Date | null; mode: SessionMode; eventWindowId: string | null;
  windowStartsAt: Date | null; windowEndsAt: Date | null;
};

/** The one session with closed_at IS NULL (§6.11.1), with its window's span. */
async function findOpenSession(dbc: Pick<DB, "select"> = db): Promise<OpenRow | null> {
  const rows = await dbc
    .select({
      id: openingSessions.id, sessionDate: openingSessions.sessionDate,
      opensAt: openingSessions.opensAt, closesAt: openingSessions.closesAt,
      viaPos: openingSessions.viaPos, notifiedAt: openingSessions.notifiedAt,
      mode: openingSessions.mode, eventWindowId: openingSessions.eventWindowId,
      windowStartsAt: eventWindows.startsAt, windowEndsAt: eventWindows.endsAt,
    })
    .from(openingSessions)
    .leftJoin(eventWindows, eq(openingSessions.eventWindowId, eventWindows.id))
    .where(isNull(openingSessions.closedAt))
    .limit(1);
  return (rows[0] as OpenRow | undefined) ?? null;
}

function openRowWindow(r: OpenRow): { endsAt: Date } | null {
  return r.eventWindowId && r.windowEndsAt ? { endsAt: r.windowEndsAt } : null;
}

type WindowRow = EventSwitches & {
  id: string; name: string; eventProfileId: string | null; startsAt: Date; endsAt: Date;
};

function windowView(w: WindowRow): EventWindowView {
  return {
    id: w.id, name: w.name, eventProfileId: w.eventProfileId,
    startsAt: new Date(w.startsAt).toISOString(), endsAt: new Date(w.endsAt).toISOString(),
    menuScope: w.menuScope, paymentPosture: w.paymentPosture, consumesCupLid: w.consumesCupLid,
    audience: w.audience, extraShotSurcharge: w.extraShotSurcharge, voucherKinds: [...w.voucherKinds],
  };
}

const windowCols = {
  id: eventWindows.id, name: eventWindows.name, eventProfileId: eventWindows.eventProfileId,
  startsAt: eventWindows.startsAt, endsAt: eventWindows.endsAt,
  menuScope: eventWindows.menuScope, paymentPosture: eventWindows.paymentPosture,
  consumesCupLid: eventWindows.consumesCupLid, audience: eventWindows.audience,
  extraShotSurcharge: eventWindows.extraShotSurcharge, voucherKinds: eventWindows.voucherKinds,
};

/** Event windows that have not ended and start before the end of this revenue day. */
async function listLiveWindows(date: string, now: Date): Promise<EventWindowView[]> {
  const dayEnd = new Date(sastInstant(date, "00:00").getTime() + 24 * 60 * 60 * 1000);
  const rows = await db
    .select(windowCols)
    .from(eventWindows)
    .where(and(gt(eventWindows.endsAt, now), lt(eventWindows.startsAt, dayEnd)));
  return (rows as WindowRow[])
    .filter((w) => new Date(w.endsAt).getTime() > now.getTime())
    .map(windowView);
}

async function listActiveProfiles(): Promise<EventProfileView[]> {
  const rows = await db
    .select({
      id: eventProfiles.id, name: eventProfiles.name, recurrence: eventProfiles.recurrence,
      defaultStart: eventProfiles.defaultStart, defaultEnd: eventProfiles.defaultEnd,
      menuScope: eventProfiles.menuScope, paymentPosture: eventProfiles.paymentPosture,
      consumesCupLid: eventProfiles.consumesCupLid, audience: eventProfiles.audience,
      extraShotSurcharge: eventProfiles.extraShotSurcharge, voucherKinds: eventProfiles.voucherKinds,
    })
    .from(eventProfiles)
    .where(eq(eventProfiles.active, true));
  return (rows as EventProfileView[]).map((p) => ({ ...p, voucherKinds: [...p.voucherKinds] }));
}

function alreadyOpen(r: OpenRow): { ok: false; code: string; message: string } {
  return {
    ok: false, code: "STALE_STATE",
    message: `A session is already open (since ${r.opensAt}). Close it before opening another.`,
  };
}

const CHANGED_UNDER_YOU = {
  ok: false as const, code: "STALE_STATE",
  message: "Today's events just changed — reloading the opening step.",
};

// Review of 3779b6d: the admin planner may not add a session while one is open
// (adding opened it at once, so a planned evening session took over the day).
const ADMIN_ALREADY_OPEN = {
  ok: false as const, code: "STALE_STATE",
  message: "A session is already open. Close it before adding another.",
};

const SWITCHES_NOT_IN_TILL = {
  ok: false as const, code: "INVALID_INPUT",
  message: "This event's menu, cup, audience or extra-shot settings can't run in the till yet. Use the normal Sunday settings.",
};

type Refusal = { ok: false; code: string; message: string };

/**
 * CLAUDE.md §5: a rejected state transition is audited and the row survives.
 * Written on its own — never inside a transaction that could roll it back —
 * as createOrder's reject audit is (src/server/actions/orders.ts).
 */
async function refuse(
  refusal: Refusal,
  audit: { entityKind: string; entityId: string; actor: { id: string; role: string }; after: Record<string, unknown> }
): Promise<Refusal> {
  await writeAudit({
    entityKind: audit.entityKind, entityId: audit.entityId, action: "reject",
    actorId: audit.actor.id, actorRole: audit.actor.role,
    after: { ...audit.after, code: refusal.code },
    reason: refusal.code,
  });
  return { ok: false, code: refusal.code, message: refusal.message };
}

/** What the barista confirmed in the opening step (L18). */
export type OpeningConfirm =
  | { mode: DateMode }
  | { mode: "event"; eventWindowId: string }
  | { mode: "event"; eventProfileId: string };

const confirmSchema = z.union([
  z.object({ mode: z.enum(["weekday", "sunday"]) }),
  z.object({ mode: z.literal("event"), eventWindowId: z.string().min(1) }),
  z.object({ mode: z.literal("event"), eventProfileId: z.string().min(1) }),
]);

class SessionConflict extends Error {}

type CoreInput = {
  opensAt: string;
  closesAt: string | null;
  /** "default" accepts what the server resolves; the POS opening step sends its confirm. */
  confirm: OpeningConfirm | "default";
  sundayOverrideConfirmed: boolean;
  viaPos: boolean;
  notify: boolean;
  actor: { id: string; role: string };
  /** Admin planner add: any open session refuses it, even at the same time. */
  adminAdd?: boolean;
};

type CoreResult = ActionResult<{ session: OpeningSession; notified: boolean; sessions: OpeningSession[] }>;

/**
 * The one way a session is created. §6.11.1: rejects with STALE_STATE while a
 * session is open; a second session on the same date is the normal path.
 */
async function openSessionCore(input: CoreInput): Promise<CoreResult> {
  const date = todaySast();
  const now = new Date();

  // Every refusal below is audited outside any transaction (CLAUDE.md §5).
  const reject = (r: Refusal, entityId: string, why: string) =>
    refuse(r, {
      entityKind: "opening_session", entityId, actor: input.actor,
      after: { attempted: "open", why, sessionDate: date, opensAt: input.opensAt, confirm: input.confirm },
    });
  const slot = `${date} ${input.opensAt}`;

  const open = await findOpenSession();
  const forced = open ? forcedClose(open, openRowWindow(open), date, now) : null;
  if (open && !forced) {
    if (input.adminAdd) return reject(ADMIN_ALREADY_OPEN, open.id, "session_open");
    if (open.sessionDate === date && open.opensAt === input.opensAt) {
      // Re-confirming the open session's time — never re-notifies (AT-134 rule 1).
      const sessions = await listToday();
      return { ok: true, data: { session: toView(open), notified: false, sessions } };
    }
    return reject(alreadyOpen(open), open.id, "session_open");
  }

  const [windows, profiles] = [await listLiveWindows(date, now), await listActiveProfiles()];
  const resolved = resolveSessionMode({
    sessionDate: date, opensAt: input.opensAt, closesAt: input.closesAt, windows, profiles,
  });

  // REQ-057: no session opens on a Saturday without an event window in force.
  if (resolved.kind === "closed") return reject({ ok: false, ...SATURDAY_CLOSED }, slot, "saturday_closed");

  // Temporary (review of 3779b6d, REQ-042): no event-mode session on Mon–Fri
  // until the order path's weekday test is made session-aware. See
  // EVENT_WEEKDAY_NOT_SUPPORTED in src/lib/session-mode.ts; the money story removes this.
  // resolveSessionMode already ignores events on Mon–Fri; this refuses a
  // client-confirmed event mode there (and stays as a backstop).
  const confirmsEvent = input.confirm !== "default" && input.confirm.mode === "event";
  if ((resolved.kind === "event" || confirmsEvent) && isWeekdayDate(date)) {
    return reject({ ok: false, ...EVENT_WEEKDAY_NOT_SUPPORTED }, slot, "event_on_weekday");
  }

  if (input.confirm !== "default") {
    const c = input.confirm;
    const matches =
      resolved.kind === "date"
        ? c.mode === resolved.mode
        : resolved.source === "window"
          ? "eventWindowId" in c && c.eventWindowId === resolved.window.id
          : "eventProfileId" in c && c.eventProfileId === resolved.profile.id;
    if (!matches) return reject(CHANGED_UNDER_YOU, slot, "confirm_mismatch");
  }

  // §6.6 precedence 2: an event overriding a Sunday needs a confirmation step.
  if (resolved.kind === "event" && resolved.overridesSunday && !input.sundayOverrideConfirmed) {
    return reject(
      {
        ok: false, code: "CONFIRM_REQUIRED",
        message: "This event replaces Sunday mode for the session. Confirm it in the POS opening step.",
      },
      slot, "sunday_override_unconfirmed"
    );
  }

  // L07 / COL-11: the forced close commits on its own, before the insert, so a
  // clash on the new row can never roll it back and hand the expired session
  // back as current (review of 3779b6d).
  if (open && forced) {
    await db.transaction(async (tx) => {
      await tx.update(openingSessions).set({ closedAt: forced.at }).where(eq(openingSessions.id, open.id));
      await writeAudit(
        {
          entityKind: "opening_session", entityId: open.id, action: "close", actorRole: "system",
          before: { closedAt: null },
          after: { closedAt: forced.at.toISOString(), reason: forced.reason },
        },
        tx as unknown as DB
      );
    });
  }

  const isReopening = (await listToday()).length > 0;

  let inserted: Awaited<ReturnType<typeof insertSession>>;
  try {
    inserted = await db.transaction(async (tx) => insertSession(tx as unknown as DB, date, input, resolved));
  } catch (err) {
    if (!(err instanceof SessionConflict)) throw err;
    // Lost a race on the one-open index or on (session_date, opens_at). A
    // winner that is itself past its forced close is not current.
    const found = await findOpenSession();
    const expired = found !== null && forcedCloseAt(found, openRowWindow(found), date, now) !== null;
    const winner = found && !expired ? found : null;
    if (winner && !input.adminAdd && winner.sessionDate === date && winner.opensAt === input.opensAt) {
      return { ok: true, data: { session: toView(winner), notified: false, sessions: await listToday() } };
    }
    if (winner) return reject(input.adminAdd ? ADMIN_ALREADY_OPEN : alreadyOpen(winner), winner.id, "lost_race");
    if (found && expired) {
      return reject(
        { ok: false, code: "STALE_STATE", message: "The previous session just expired. Tap again to open." },
        found.id, "winner_expired"
      );
    }
    return reject(
      { ok: false, code: "INVALID_INPUT", message: `A session already opened at ${input.opensAt} today. Pick another time.` },
      slot, "time_taken"
    );
  }

  // Fan out to every subscribed customer — fire-and-forget so a push failure
  // never fails the open.
  if (input.notify) fanOutOpeningPush(input.opensAt, isReopening);

  const sessions = await listToday();
  return { ok: true, data: { session: toView(inserted), notified: input.notify, sessions } };
}

async function insertSession(
  txDb: DB,
  date: string,
  input: CoreInput,
  resolved: Exclude<ReturnType<typeof resolveSessionMode>, { kind: "closed" }>
) {
  let eventWindowId: string | null = null;
  let voucherKindsActive: string[] = [];

  if (resolved.kind === "event" && resolved.source === "window") {
    eventWindowId = resolved.window.id;
    voucherKindsActive = [...resolved.window.voucherKinds];
  } else if (resolved.kind === "event") {
    // §6.6 Path A: the recurring profile's occurrence becomes a window now,
    // with its switches snapshotted (REQ-044).
    const p = resolved.profile;
    const [w] = await txDb
      .insert(eventWindows)
      .values({
        eventProfileId: p.id, name: p.name,
        startsAt: new Date(resolved.startsAt), endsAt: new Date(resolved.endsAt),
        ...snapshotSwitches(p), createdByStaffId: input.actor.id,
      })
      .returning({ id: eventWindows.id });
    if (!w) throw new SessionConflict();
    await writeAudit(
      {
        entityKind: "event_window", entityId: w.id, action: "create",
        actorId: input.actor.id, actorRole: input.actor.role,
        after: { eventProfileId: p.id, startsAt: resolved.startsAt, endsAt: resolved.endsAt },
      },
      txDb
    );
    eventWindowId = w.id;
    voucherKindsActive = [...p.voucherKinds];
  }

  const mode: SessionMode = resolved.kind === "event" ? "event" : resolved.mode;
  // No conflict target: covers both UNIQUE(session_date, opens_at) and the
  // partial one-open-session index, so a lost race is a clean result, not a 500.
  const [row] = await txDb
    .insert(openingSessions)
    .values({
      sessionDate: date, mode, opensAt: input.opensAt, closesAt: input.closesAt,
      viaPos: input.viaPos, createdByStaffId: input.actor.id,
      notifiedAt: input.notify ? new Date() : null,
      eventWindowId, voucherKindsActive,
    })
    .onConflictDoNothing()
    .returning({
      id: openingSessions.id, sessionDate: openingSessions.sessionDate,
      opensAt: openingSessions.opensAt, closesAt: openingSessions.closesAt,
      viaPos: openingSessions.viaPos, notifiedAt: openingSessions.notifiedAt,
    });
  if (!row) throw new SessionConflict(); // rolls back any window created above
  await writeAudit(
    {
      entityKind: "opening_session", entityId: row.id, action: "create",
      actorId: input.actor.id, actorRole: input.actor.role,
      after: {
        sessionDate: date, opensAt: input.opensAt, closesAt: input.closesAt,
        viaPos: input.viaPos, mode, eventWindowId, voucherKindsActive,
      },
    },
    txDb
  );
  return row;
}

function snapshotSwitches(s: EventSwitches): EventSwitches {
  return {
    menuScope: s.menuScope, paymentPosture: s.paymentPosture, consumesCupLid: s.consumesCupLid,
    audience: s.audience, extraShotSurcharge: s.extraShotSurcharge, voucherKinds: [...s.voucherKinds],
  };
}

// ─── Actions ──────────────────────────────────────────────────────────────────

export type CurrentSession = {
  id: string;
  opensAt: string;
  mode: SessionMode;
  eventWindow: EventWindowView | null;
};

/**
 * Everything the POS opening step needs. `current` is the one open session, or
 * null (NO_SESSION). A session past midnight or past its window's end reads as
 * null here; nothing is written on read (REQ-042).
 */
export async function getOpeningStep(): Promise<ActionResult<{
  date: string;
  current: CurrentSession | null;
  sessions: OpeningSession[];
  windows: EventWindowView[];
  profiles: EventProfileView[];
}>> {
  const auth = await authorize(...POS_ROLES);
  if (!auth.ok) return auth;
  const date = todaySast();
  const now = new Date();

  const open = await findOpenSession();
  const windows = await listLiveWindows(date, now);
  const profiles = await listActiveProfiles();
  const sessions = await listToday();

  let current: CurrentSession | null = null;
  if (open && !forcedCloseAt(open, openRowWindow(open), date, now)) {
    current = {
      id: open.id, opensAt: open.opensAt, mode: open.mode,
      eventWindow: open.eventWindowId ? windows.find((w) => w.id === open.eventWindowId) ?? null : null,
    };
  }
  return { ok: true, data: { date, current, sessions, windows, profiles } };
}

/**
 * openSession(opensAt) — PRD §11. Creates today's session in the mode the
 * barista confirmed in the opening step. Errors: AUTH, STALE_STATE (a session
 * is open, or the confirm no longer matches), SATURDAY_CLOSED, CONFIRM_REQUIRED.
 */
export async function openSession(input: {
  opensAt: string;
  confirm: OpeningConfirm;
  sundayOverrideConfirmed?: boolean;
}): Promise<CoreResult> {
  const auth = await authorize(...POS_ROLES);
  if (!auth.ok) return auth;
  const time = timeSchema.safeParse(input?.opensAt);
  const confirm = confirmSchema.safeParse(input?.confirm);
  if (!time.success || !confirm.success) {
    return { ok: false, code: "INVALID_INPUT", message: "Enter a time like 07:30 and confirm the mode." };
  }
  return openSessionCore({
    opensAt: time.data, closesAt: null, confirm: confirm.data as OpeningConfirm,
    sundayOverrideConfirmed: input.sundayOverrideConfirmed === true,
    viaPos: true, notify: true, actor: { id: auth.session.id, role: auth.session.role },
  });
}

/**
 * closeSession(sessionId) — PRD §11, §6.11.1. Sets closed_at. The slip count is
 * optional and never blocks the close; omitted, it stays NULL (L43).
 */
export async function closeSession(
  sessionId: string,
  voucherSlipsCounted?: number
): Promise<ActionResult<{ sessions: OpeningSession[] }>> {
  const auth = await authorize(...POS_ROLES);
  if (!auth.ok) return auth;
  if (voucherSlipsCounted !== undefined && !(Number.isInteger(voucherSlipsCounted) && voucherSlipsCounted >= 0)) {
    return { ok: false, code: "INVALID_INPUT", message: "The slip count must be a whole number, 0 or more." };
  }

  const result = await db.transaction(async (tx) => {
    const txDb = tx as unknown as DB;
    const [row] = await tx
      .select({ id: openingSessions.id, closedAt: openingSessions.closedAt, opensAt: openingSessions.opensAt })
      .from(openingSessions)
      .where(eq(openingSessions.id, sessionId))
      .for("update");
    if (!row) return "not_found" as const;
    if (row.closedAt) return "closed" as const;
    const closedAt = new Date();
    await tx
      .update(openingSessions)
      .set(voucherSlipsCounted === undefined ? { closedAt } : { closedAt, voucherSlipsCounted })
      .where(eq(openingSessions.id, sessionId));
    await writeAudit(
      {
        entityKind: "opening_session", entityId: sessionId, action: "close",
        actorId: auth.session.id, actorRole: auth.session.role,
        before: { closedAt: null },
        after: { closedAt: closedAt.toISOString(), voucherSlipsCounted: voucherSlipsCounted ?? null },
      },
      txDb
    );
    return "ok" as const;
  });

  if (result === "not_found") {
    return refuse(
      { ok: false, code: "NOT_FOUND", message: "Session not found." },
      {
        entityKind: "opening_session", entityId: sessionId, actor: { id: auth.session.id, role: auth.session.role },
        after: { attempted: "close", why: "not_found" },
      }
    );
  }
  if (result === "closed") {
    return refuse(
      { ok: false, code: "STALE_STATE", message: "This session is already closed." },
      {
        entityKind: "opening_session", entityId: sessionId, actor: { id: auth.session.id, role: auth.session.role },
        after: { attempted: "close", why: "already_closed" },
      }
    );
  }
  return { ok: true, data: { sessions: await listToday() } };
}

const isoSchema = z.string().refine((s) => !Number.isNaN(new Date(s).getTime()), "Invalid time");
const switchesSchema = z.object({
  menuScope: z.enum(["full", "coffee_only", "custom"]),
  paymentPosture: z.enum(["free", "standard", "override"]),
  consumesCupLid: z.boolean(),
  audience: z.enum(["office_staff", "church_member", "both", "nobody"]),
  extraShotSurcharge: z.boolean(),
  voucherKinds: z.array(z.string().min(1)),
});
const eventWindowInputSchema = z.object({
  name: z.string().trim().min(1).optional(),
  startsAt: isoSchema.optional(),
  endsAt: isoSchema, // L27 / REQ-043: required
  switches: switchesSchema.optional(),
});

/**
 * openEventWindow(profileId?, input) — PRD §11, §6.6 Paths B and C. Snapshots
 * the six switches at open, from the profile or as given (REQ-044). Requires
 * ends_at; rejects a window longer than 24 h (L27, REQ-043).
 */
export async function openEventWindow(
  profileId: string | null,
  input: z.input<typeof eventWindowInputSchema>
): Promise<ActionResult<{ window: EventWindowView }>> {
  const auth = await authorize(...POS_ROLES);
  if (!auth.ok) return auth;
  const parsed = eventWindowInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, code: "INVALID_INPUT", message: "An event needs an end time." };
  }

  const actor = { id: auth.session.id, role: auth.session.role };
  let name: string;
  let switches: EventSwitches;
  if (profileId) {
    const [p] = await db
      .select({
        id: eventProfiles.id, name: eventProfiles.name,
        menuScope: eventProfiles.menuScope, paymentPosture: eventProfiles.paymentPosture,
        consumesCupLid: eventProfiles.consumesCupLid, audience: eventProfiles.audience,
        extraShotSurcharge: eventProfiles.extraShotSurcharge, voucherKinds: eventProfiles.voucherKinds,
      })
      .from(eventProfiles)
      .where(and(eq(eventProfiles.id, profileId), eq(eventProfiles.active, true)));
    if (!p) {
      return refuse(
        { ok: false, code: "NOT_FOUND", message: "That event profile isn't available." },
        { entityKind: "event_window", entityId: profileId, actor, after: { attempted: "open_event_window", why: "profile_not_found", eventProfileId: profileId } }
      );
    }
    name = p.name;
    switches = snapshotSwitches(p as EventSwitches);
  } else {
    if (!parsed.data.name || !parsed.data.switches) {
      return refuse(
        { ok: false, code: "INVALID_INPUT", message: "Name the event and set its switches." },
        {
          entityKind: "event_window", entityId: `ad_hoc:${parsed.data.name ?? ""}`, actor,
          after: { attempted: "open_event_window", why: "name_or_switches_missing", eventProfileId: null },
        }
      );
    }
    name = parsed.data.name;
    switches = snapshotSwitches(parsed.data.switches);
  }

  // Refusals are audited outside any transaction (CLAUDE.md §5).
  const reject = (r: Refusal, why: string, extra: Record<string, unknown> = {}) =>
    refuse(r, {
      entityKind: "event_window", entityId: profileId ?? `ad_hoc:${name}`,
      actor,
      after: { attempted: "open_event_window", why, eventProfileId: profileId ?? null, name, ...switches, ...extra },
    });

  if (!postureIsInTill(switches.paymentPosture)) {
    return reject(
      {
        ok: false, code: "INVALID_INPUT",
        message: "Free and event-price events can't run in the till yet. Use normal prices.",
      },
      "posture_not_in_till"
    );
  }
  // Mirrors the posture guard: a switch the till ignores is refused, never shown as confirmed.
  if (!eventSwitchesInTill(switches)) return reject(SWITCHES_NOT_IN_TILL, "switches_not_in_till");

  const now = new Date();
  // Path C "start now": to the minute, so a session opened at this HH:mm is inside it.
  const startsAt = parsed.data.startsAt
    ? new Date(parsed.data.startsAt)
    : new Date(Math.floor(now.getTime() / 60000) * 60000);
  const endsAt = new Date(parsed.data.endsAt);
  const spanError = validateWindowSpan(startsAt, endsAt);
  const span = { startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString() };
  if (spanError) return reject({ ok: false, code: "INVALID_INPUT", message: spanError }, "invalid_span", span);
  if (endsAt.getTime() <= now.getTime()) {
    return reject({ ok: false, code: "INVALID_INPUT", message: "Pick an end time later than now." }, "ends_in_past", span);
  }
  // Temporary (review of 3779b6d, REQ-042): no event on Mon–Fri SAST until the
  // money story makes the order path session-aware; that story removes this.
  if (windowTouchesWeekday(startsAt, endsAt)) {
    return reject({ ok: false, ...EVENT_WEEKDAY_NOT_SUPPORTED }, "event_on_weekday", {
      startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString(),
    });
  }

  const created = await db.transaction(async (tx) => {
    const txDb = tx as unknown as DB;
    const [w] = await tx
      .insert(eventWindows)
      .values({
        eventProfileId: profileId ?? null, name, startsAt, endsAt, ...switches,
        createdByStaffId: auth.session.id,
      })
      .returning({ id: eventWindows.id });
    if (!w) return null;
    await writeAudit(
      {
        entityKind: "event_window", entityId: w.id, action: "create",
        actorId: auth.session.id, actorRole: auth.session.role,
        after: { eventProfileId: profileId ?? null, name, startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString(), ...switches },
      },
      txDb
    );
    return w;
  });
  if (!created) return { ok: false, code: "DB_ERROR", message: "Could not start the event." };

  return {
    ok: true,
    data: {
      window: {
        id: created.id, name, eventProfileId: profileId ?? null,
        startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString(), ...switches,
      },
    },
  };
}

/**
 * Barista prompt submit (AT-134), now routed through openSessionCore:
 * - The open session's own time → no-op confirm, `notified: false`.
 * - A session open at another time → STALE_STATE (close it first, §6.11.1).
 * - Otherwise a new session in the resolved mode, and every subscribed
 *   customer is pushed ("opening" first, "reopening" for later ones).
 */
export async function submitOpeningTime(
  opensAt: string
): Promise<CoreResult> {
  const auth = await authorize(...POS_ROLES);
  if (!auth.ok) return auth;

  const parsed = timeSchema.safeParse(opensAt);
  if (!parsed.success) {
    return { ok: false, code: "INVALID_INPUT", message: "Enter a time like 07:30." };
  }
  return openSessionCore({
    opensAt: parsed.data, closesAt: null, confirm: "default", sundayOverrideConfirmed: false,
    viaPos: true, notify: true, actor: { id: auth.session.id, role: auth.session.role },
  });
}

/**
 * Push an opening/reopening notification to every subscribed customer.
 * Fire-and-forget (mirrors the operating-hours notify path) — a push failure
 * must never fail the action that triggered it.
 */
function fanOutOpeningPush(opensAt: string, isReopening: boolean): void {
  db.select({ id: customers.id, pushSubscription: customers.pushSubscription })
    .from(customers)
    .where(isNotNull(customers.pushSubscription))
    .then((subs) => {
      for (const sub of subs) {
        if (!isValidPushSubscription(sub.pushSubscription)) continue;
        sendOpeningPush(sub.pushSubscription, opensAt, isReopening).catch(
          (err) => console.error("[push] sendOpeningPush failed", { customerId: sub.id }, err)
        );
      }
    })
    .catch((err) => console.error("[push] failed to fetch subscriptions for opening notify", err));
}

// AT-134: admin edits do NOT auto-notify (unlike the barista prompt). The admin
// opts in per action via `notify` (default false) — Nikao's decision, 2026-07-13:
// admin planning edits are often quiet corrections, so the push is a deliberate
// per-change choice, not automatic.
const adminSessionSchema = z.object({
  opensAt: timeSchema,
  closesAt: timeSchema.nullable().optional(),
  notify: z.boolean().optional().default(false),
});

/**
 * Admin planner: add a session for today. Silent by default; pushes an
 * opening/reopening notification only when `notify` is true.
 */
export async function addTodaySession(
  input: z.input<typeof adminSessionSchema>
): Promise<ActionResult<{ sessions: OpeningSession[] }>> {
  const auth = await authorize("admin");
  if (!auth.ok) return auth;
  const parsed = adminSessionSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: "INVALID_INPUT", message: "Times must be HH:mm." };

  // AT-204: the same path as the barista's open — the mode resolved against
  // this session's window, Saturday refused without an event. Adding opens the
  // session at once (there is no "planned, not yet open" state), so it is
  // refused with STALE_STATE whenever any session is open — otherwise an
  // evening session planned at 06:00 would become the open one and lock out
  // the morning barista. Opt-in notify: only a newly created row pushes.
  const res = await openSessionCore({
    opensAt: parsed.data.opensAt, closesAt: parsed.data.closesAt ?? null,
    confirm: "default", sundayOverrideConfirmed: false,
    viaPos: false, notify: parsed.data.notify, actor: { id: auth.session.id, role: auth.session.role },
    adminAdd: true,
  });
  if (!res.ok) return res;
  return { ok: true, data: { sessions: res.data.sessions } };
}

/**
 * Admin planner: edit a session's times. Silent by default; pushes only when
 * `notify` is true (opt-in per edit).
 */
export async function updateTodaySession(
  id: string,
  input: z.input<typeof adminSessionSchema>
): Promise<ActionResult<{ sessions: OpeningSession[] }>> {
  const auth = await authorize("admin");
  if (!auth.ok) return auth;
  const parsed = adminSessionSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: "INVALID_INPUT", message: "Times must be HH:mm." };

  const updated = await db.transaction(async (tx) => {
    const txDb = tx as unknown as DB;
    const [row] = await tx
      .select({ opensAt: openingSessions.opensAt, closesAt: openingSessions.closesAt, closedAt: openingSessions.closedAt })
      .from(openingSessions)
      .where(and(eq(openingSessions.id, id), eq(openingSessions.sessionDate, todaySast())));
    if (!row) return false;
    // Moving an open session's times would leave its mode and event binding
    // stale (both are resolved at open), so it is refused, not recomputed.
    if (row.closedAt === null) return "open" as const;
    const before = { opensAt: row.opensAt, closesAt: row.closesAt };

    await tx
      .update(openingSessions)
      .set({
        opensAt: parsed.data.opensAt,
        closesAt: parsed.data.closesAt ?? null,
        ...(parsed.data.notify ? { notifiedAt: new Date() } : {}),
      })
      .where(eq(openingSessions.id, id));
    await writeAudit(
      {
        entityKind: "opening_session", entityId: id, action: "update",
        actorId: auth.session.id, actorRole: auth.session.role,
        before, after: parsed.data,
      },
      txDb
    );
    return true;
  });

  if (!updated) return { ok: false, code: "NOT_FOUND", message: "Session not found for today." };
  if (updated === "open") {
    return refuse(
      { ok: false, code: "STALE_STATE", message: "This session is open. Close it before changing its times." },
      {
        entityKind: "opening_session", entityId: id, actor: { id: auth.session.id, role: auth.session.role },
        after: { attempted: "update", why: "session_open", ...parsed.data },
      }
    );
  }
  // Opt-in notify: push the (possibly changed) opening time when the admin asked.
  if (parsed.data.notify) fanOutOpeningPush(parsed.data.opensAt, false);
  return { ok: true, data: { sessions: await listToday() } };
}

/** Admin planner: remove a session. Silent — no customer push. */
export async function deleteTodaySession(
  id: string
): Promise<ActionResult<{ sessions: OpeningSession[] }>> {
  const auth = await authorize("admin");
  if (!auth.ok) return auth;

  const deleted = await db.transaction(async (tx) => {
    const txDb = tx as unknown as DB;
    const [row] = await tx
      .select({ opensAt: openingSessions.opensAt, closesAt: openingSessions.closesAt, closedAt: openingSessions.closedAt })
      .from(openingSessions)
      .where(and(eq(openingSessions.id, id), eq(openingSessions.sessionDate, todaySast())));
    if (!row) return false;
    // The open session is the current session (§6.11.1); it ends by closeSession, never a hard delete.
    if (row.closedAt === null) return "open" as const;
    const before = { opensAt: row.opensAt, closesAt: row.closesAt };

    await tx.delete(openingSessions).where(eq(openingSessions.id, id));
    await writeAudit(
      {
        entityKind: "opening_session", entityId: id, action: "delete",
        actorId: auth.session.id, actorRole: auth.session.role,
        before, after: null,
      },
      txDb
    );
    return true;
  });

  if (!deleted) return { ok: false, code: "NOT_FOUND", message: "Session not found for today." };
  if (deleted === "open") {
    return refuse(
      { ok: false, code: "STALE_STATE", message: "This session is open. Close it before removing it." },
      {
        entityKind: "opening_session", entityId: id, actor: { id: auth.session.id, role: auth.session.role },
        after: { attempted: "delete", why: "session_open" },
      }
    );
  }
  return { ok: true, data: { sessions: await listToday() } };
}
