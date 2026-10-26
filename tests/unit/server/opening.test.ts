// Opening sessions — AT-134 backend, plus the AT-204 prerequisite session model.
// Notification rules: push on first submission or a genuinely new session
// (reopening); never on re-confirming an unchanged time. Admin planner CRUD
// is silent and admin-only.
// AT-204 (PRD §6.11.1): at most one session open at a time — openSession
// rejects with STALE_STATE while one is open, not while a row exists today.
//
// CHANGED (AT-204): every select sequence below now starts with the
// open-session lookup, then today's event windows and active profiles; the
// reopening test closes the first session before opening the second; the
// Saturday message points at Start an event.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockAuthorize = vi.fn();
vi.mock("@/server/auth/guard", () => ({
  authorize: (...a: unknown[]) => mockAuthorize(...a),
}));

const mockWriteAudit = vi.fn().mockResolvedValue(undefined);
vi.mock("@/server/audit", () => ({ writeAudit: (...a: unknown[]) => mockWriteAudit(...a) }));

// 2026-07-09 is a Thursday. AT-181 tests override it with a Saturday.
const mockToday = vi.fn(() => "2026-07-09");
vi.mock("@/server/cogs/compute", () => ({ todaySast: () => mockToday() }));

const mockSendOpeningPush = vi.fn().mockResolvedValue(true);
vi.mock("@/server/push/send", () => ({
  sendOpeningPush: (...a: unknown[]) => mockSendOpeningPush(...a),
}));
vi.mock("@/server/push/payload", () => ({ isValidPushSubscription: () => true }));

// db mock: every select() (on db or tx) consumes the next row-set from a FIFO
// queue via a self-returning thenable chain.
const selectQueue: unknown[][] = [];
function chain() {
  const rows = selectQueue.shift() ?? [];
  const c: Record<string, unknown> = {};
  for (const m of ["from", "where", "orderBy", "leftJoin", "limit", "for"]) c[m] = vi.fn().mockReturnValue(c);
  c.then = (resolve: (v: unknown[]) => void) => Promise.resolve(rows).then(resolve);
  return c;
}
const mockReturning = vi.fn();
const mockUpdateWhere = vi.fn().mockResolvedValue(undefined);
const mockUpdateSet = vi.fn().mockReturnValue({ where: mockUpdateWhere });
const mockDeleteWhere = vi.fn().mockResolvedValue(undefined);
const mockValues = vi.fn().mockImplementation(() => ({
  onConflictDoNothing: vi.fn().mockReturnValue({ returning: mockReturning }),
  returning: mockReturning,
}));
const tx = {
  select: vi.fn().mockImplementation(chain),
  insert: vi.fn().mockImplementation(() => ({ values: mockValues })),
  update: vi.fn().mockImplementation(() => ({ set: mockUpdateSet })),
  delete: vi.fn().mockImplementation(() => ({ where: mockDeleteWhere })),
};
vi.mock("@/lib/db", () => ({
  db: {
    select: vi.fn().mockImplementation(chain),
    transaction: vi.fn().mockImplementation(async (cb: (t: unknown) => unknown) => cb(tx)),
  },
}));

import {
  getTodaySessions, submitOpeningTime, addTodaySession, updateTodaySession, deleteTodaySession,
  openSession, closeSession, openEventWindow, getOpeningStep,
} from "@/server/actions/opening";

const BARISTA = { ok: true, session: { id: "staff_sam", name: "Sam", role: "barista" } };
const ADMIN = { ok: true, session: { id: "staff_gian", name: "Gian", role: "admin" } };
const NO_AUTH = { ok: false, code: "UNAUTHORIZED", message: "You must be signed in." };

const SESSION_ROW = {
  id: "os_1", sessionDate: "2026-07-09", opensAt: "07:30", closesAt: null,
  viaPos: true, notifiedAt: new Date("2026-07-09T05:30:00Z"),
};
// The open-session lookup row (closed_at IS NULL, joined to its window).
const OPEN_ROW = { ...SESSION_ROW, mode: "weekday", eventWindowId: null, windowStartsAt: null, windowEndsAt: null };
const SUBS = [{ id: "c1", pushSubscription: { endpoint: "https://push/1", keys: {} } }];

const STANDARD = {
  menuScope: "full", paymentPosture: "standard", consumesCupLid: true,
  audience: "both", extraShotSurcharge: true,
} as const;
const UNTRACKED_PROFILE = {
  id: "evp_untracked_church", name: "Untracked Church", recurrence: "FREQ=WEEKLY;BYDAY=SU",
  defaultStart: null, defaultEnd: null, ...STANDARD, voucherKinds: ["untracked_hot_drink"], active: true,
};

/** Queue the three reads every opening path makes before it writes. */
function queueOpeningReads(open: unknown[] = [], windows: unknown[] = [], profiles: unknown[] = []) {
  selectQueue.push(open, windows, profiles);
}

beforeEach(() => {
  vi.clearAllMocks();
  selectQueue.length = 0;
  mockReturning.mockResolvedValue([SESSION_ROW]);
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-07-09T05:30:00Z")); // 07:30 SAST, Thursday
});
afterEach(() => vi.useRealTimers());

// Waits a tick so the fire-and-forget push fan-out settles before asserting.
const flush = () => new Promise((r) => setTimeout(r, 0));

describe("getTodaySessions", () => {
  it("rejects unauthenticated callers", async () => {
    mockAuthorize.mockResolvedValue(NO_AUTH);
    const res = await getTodaySessions();
    expect(res.ok).toBe(false);
  });

  it("returns today's sessions, view-shaped", async () => {
    mockAuthorize.mockResolvedValue(BARISTA);
    selectQueue.push([SESSION_ROW]);
    const res = await getTodaySessions();
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.date).toBe("2026-07-09");
      expect(res.data.sessions).toEqual([
        { id: "os_1", sessionDate: "2026-07-09", opensAt: "07:30", closesAt: null, viaPos: true, notified: true },
      ]);
    }
  });
});

describe("submitOpeningTime", () => {
  beforeEach(() => mockAuthorize.mockResolvedValue(BARISTA));

  it("rejects a malformed time", async () => {
    const res = await submitOpeningTime("7h30");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("INVALID_INPUT");
  });

  it("first submission of the day inserts, audits, and notifies subscribers", async () => {
    queueOpeningReads();
    selectQueue.push([]);            // no sessions yet
    selectQueue.push(SUBS);          // push subscriptions (async fan-out)
    selectQueue.push([SESSION_ROW]); // fresh sessions list for the response
    const res = await submitOpeningTime("07:30");
    await flush();

    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data.notified).toBe(true);
    expect(mockWriteAudit).toHaveBeenCalledTimes(1);
    expect(mockSendOpeningPush).toHaveBeenCalledWith(SUBS[0].pushSubscription, "07:30", false);
  });

  it("re-confirming the open session's unchanged time is a silent no-op", async () => {
    selectQueue.push([OPEN_ROW]);    // 07:30 is the open session
    selectQueue.push([SESSION_ROW]); // sessions list
    const res = await submitOpeningTime("07:30");
    await flush();

    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data.notified).toBe(false);
    expect(tx.insert).not.toHaveBeenCalled();
    expect(mockSendOpeningPush).not.toHaveBeenCalled();
  });

  it("a new time while a session is open is STALE_STATE, not a 500 (§6.11.1)", async () => {
    selectQueue.push([OPEN_ROW]);
    const res = await submitOpeningTime("14:00");
    expect(res).toMatchObject({ ok: false, code: "STALE_STATE" });
    expect(tx.insert).not.toHaveBeenCalled();
    expect(mockSendOpeningPush).not.toHaveBeenCalled();
  });

  it("after the first session closes, a different time notifies as a reopening", async () => {
    const closed = { ...SESSION_ROW, closesAt: null };
    queueOpeningReads();             // no session open
    selectQueue.push([closed]);      // 07:30 exists today, closed
    selectQueue.push(SUBS);
    selectQueue.push([closed, { ...SESSION_ROW, id: "os_2", opensAt: "14:00" }]);
    mockReturning.mockResolvedValue([{ ...SESSION_ROW, id: "os_2", opensAt: "14:00" }]);

    const res = await submitOpeningTime("14:00");
    await flush();
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data.notified).toBe(true);
    expect(mockSendOpeningPush).toHaveBeenCalledWith(SUBS[0].pushSubscription, "14:00", true);
  });

  it("a concurrent open that loses the one-open index race is STALE_STATE", async () => {
    queueOpeningReads();
    selectQueue.push([]);                                  // no sessions yet
    mockReturning.mockResolvedValue([]);                   // ON CONFLICT DO NOTHING → no row
    selectQueue.push([{ ...OPEN_ROW, id: "os_x", opensAt: "07:25" }]); // the winner
    const res = await submitOpeningTime("07:30");
    expect(res).toMatchObject({ ok: false, code: "STALE_STATE" });
    expect(mockSendOpeningPush).not.toHaveBeenCalled();
  });
});

describe("admin planner CRUD", () => {
  it("is admin-only", async () => {
    mockAuthorize.mockResolvedValue({ ok: false, code: "FORBIDDEN", message: "No." });
    expect((await addTodaySession({ opensAt: "07:00" })).ok).toBe(false);
    expect((await updateTodaySession("os_1", { opensAt: "08:00" })).ok).toBe(false);
    expect((await deleteTodaySession("os_1")).ok).toBe(false);
  });

  it("add inserts silently by default (no push) and audits", async () => {
    mockAuthorize.mockResolvedValue(ADMIN);
    mockReturning.mockResolvedValue([{ ...SESSION_ROW, id: "os_9" }]);
    queueOpeningReads();
    selectQueue.push([]);            // isReopening check — no prior sessions today
    selectQueue.push([SESSION_ROW]); // sessions list for the response
    const res = await addTodaySession({ opensAt: "14:00", closesAt: "17:00" });
    await flush();
    expect(res.ok).toBe(true);
    expect(mockWriteAudit).toHaveBeenCalledTimes(1);
    expect(mockSendOpeningPush).not.toHaveBeenCalled();
  });

  it("add with notify=true pushes an opening notification (AT-134)", async () => {
    mockAuthorize.mockResolvedValue(ADMIN);
    mockReturning.mockResolvedValue([{ ...SESSION_ROW, id: "os_9" }]);
    queueOpeningReads();
    selectQueue.push([]);            // isReopening check — no prior sessions today
    selectQueue.push(SUBS);          // push subscriptions (async fan-out)
    selectQueue.push([SESSION_ROW]); // sessions list for the response
    const res = await addTodaySession({ opensAt: "14:00", notify: true });
    await flush();
    expect(res.ok).toBe(true);
    expect(mockSendOpeningPush).toHaveBeenCalledWith(SUBS[0].pushSubscription, "14:00", false);
  });

  it("add while a session is open is STALE_STATE with a plain message, no insert (§6.11.1)", async () => {
    mockAuthorize.mockResolvedValue(ADMIN);
    selectQueue.push([OPEN_ROW]);
    const res = await addTodaySession({ opensAt: "14:00", notify: true });
    expect(res).toEqual({
      ok: false, code: "STALE_STATE",
      message: "A session is already open (since 07:30). Close it before opening another.",
    });
    expect(tx.insert).not.toHaveBeenCalled();
  });

  it("update returns NOT_FOUND for a session that isn't today's", async () => {
    mockAuthorize.mockResolvedValue(ADMIN);
    selectQueue.push([]); // before-lookup misses
    const res = await updateTodaySession("os_zzz", { opensAt: "09:00" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("NOT_FOUND");
  });

  it("delete removes and audits", async () => {
    mockAuthorize.mockResolvedValue(ADMIN);
    selectQueue.push([{ opensAt: "07:30", closesAt: null }]); // before-lookup hits
    selectQueue.push([]); // sessions list after delete
    const res = await deleteTodaySession("os_1");
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data.sessions).toEqual([]);
    expect(mockDeleteWhere).toHaveBeenCalled();
    expect(mockWriteAudit).toHaveBeenCalledTimes(1);
  });
});

// AT-181 / PRD §4.2: a session's mode is defaulted from the date, and "a
// session cannot be opened on a Saturday at all unless an event window is in
// force" (REQ-057).
describe("AT-181: session mode and the Saturday refusal", () => {
  const SATURDAY = "2026-07-11";
  const SATURDAY_MESSAGE = "The café is closed on Saturdays unless an event is set up. Tap Start an event.";

  it("the barista prompt records mode 'weekday' on a Thursday", async () => {
    mockAuthorize.mockResolvedValue(BARISTA);
    queueOpeningReads();
    selectQueue.push([]);
    selectQueue.push(SUBS);
    selectQueue.push([SESSION_ROW]);
    await submitOpeningTime("07:30");
    await flush();
    expect(mockValues).toHaveBeenCalledWith(expect.objectContaining({
      sessionDate: "2026-07-09", mode: "weekday", eventWindowId: null, voucherKindsActive: [],
    }));
  });

  it("the barista prompt refuses a Saturday session with no event: no insert, no push", async () => {
    mockAuthorize.mockResolvedValue(BARISTA);
    mockToday.mockReturnValue(SATURDAY);
    vi.setSystemTime(new Date("2026-07-11T05:30:00Z"));
    queueOpeningReads();
    const res = await submitOpeningTime("07:30");
    await flush();
    mockToday.mockReturnValue("2026-07-09");
    expect(res).toEqual({ ok: false, code: "SATURDAY_CLOSED", message: SATURDAY_MESSAGE });
    expect(tx.insert).not.toHaveBeenCalled();
    expect(mockSendOpeningPush).not.toHaveBeenCalled();
  });

  it("the admin planner refuses a Saturday session with no event: no insert", async () => {
    mockAuthorize.mockResolvedValue(ADMIN);
    mockToday.mockReturnValue(SATURDAY);
    vi.setSystemTime(new Date("2026-07-11T05:30:00Z"));
    queueOpeningReads();
    const res = await addTodaySession({ opensAt: "14:00", notify: true });
    await flush();
    mockToday.mockReturnValue("2026-07-09");
    expect(res).toEqual({ ok: false, code: "SATURDAY_CLOSED", message: SATURDAY_MESSAGE });
    expect(tx.insert).not.toHaveBeenCalled();
    expect(mockSendOpeningPush).not.toHaveBeenCalled();
  });
});

// ─── AT-204 prerequisite: openSession / closeSession / openEventWindow ────────

const SAT = "2026-10-10";   // Saturday
const SUN = "2026-10-11";   // Sunday
const SAT_WINDOW = {
  id: "evw_sat", name: "Youth Social", eventProfileId: null,
  startsAt: new Date("2026-10-10T08:00:00Z"), endsAt: new Date("2026-10-10T12:00:00Z"), // 10:00–14:00 SAST
  ...STANDARD, voucherKinds: [], priceOverrides: null,
};
const SUN_EVENING = {
  ...SAT_WINDOW, id: "evw_untracked", name: "Untracked Church", eventProfileId: "evp_untracked_church",
  startsAt: new Date("2026-10-11T16:00:00Z"), endsAt: new Date("2026-10-11T18:30:00Z"), // 18:00–20:30 SAST
  voucherKinds: ["untracked_hot_drink"],
};

describe("openSession (§6.11.1, REQ-057, L18)", () => {
  beforeEach(() => mockAuthorize.mockResolvedValue(BARISTA));
  afterEach(() => mockToday.mockReturnValue("2026-07-09"));

  it("requires a POS role", async () => {
    mockAuthorize.mockResolvedValue(NO_AUTH);
    const res = await openSession({ opensAt: "07:30", confirm: { mode: "weekday" } });
    expect(res).toMatchObject({ ok: false, code: "UNAUTHORIZED" });
  });

  it("rejects with STALE_STATE while a session is open", async () => {
    selectQueue.push([OPEN_ROW]);
    const res = await openSession({ opensAt: "14:00", confirm: { mode: "weekday" } });
    expect(res).toMatchObject({ ok: false, code: "STALE_STATE" });
    expect(tx.insert).not.toHaveBeenCalled();
  });

  it("Saturday with no event window in force: refused, nothing opens", async () => {
    mockToday.mockReturnValue(SAT);
    vi.setSystemTime(new Date("2026-10-10T08:00:00Z"));
    queueOpeningReads();
    const res = await openSession({ opensAt: "10:00", confirm: { mode: "weekday" } });
    expect(res).toMatchObject({ ok: false, code: "SATURDAY_CLOSED" });
    expect(tx.insert).not.toHaveBeenCalled();
  });

  it("Saturday inside an event window opens mode 'event', bound to it, voucher kinds snapshotted", async () => {
    mockToday.mockReturnValue(SAT);
    vi.setSystemTime(new Date("2026-10-10T08:00:00Z"));
    queueOpeningReads([], [{ ...SAT_WINDOW, voucherKinds: ["x_kind"] }], []);
    selectQueue.push([]);            // no sessions yet today
    selectQueue.push([]);            // push subs
    selectQueue.push([]);            // sessions list
    const res = await openSession({ opensAt: "10:00", confirm: { mode: "event", eventWindowId: "evw_sat" } });
    await flush();
    expect(res.ok).toBe(true);
    expect(mockValues).toHaveBeenCalledWith(expect.objectContaining({
      sessionDate: SAT, mode: "event", eventWindowId: "evw_sat", voucherKindsActive: ["x_kind"],
    }));
  });

  it("a confirm that no longer matches what the server resolves is STALE_STATE", async () => {
    mockToday.mockReturnValue(SAT);
    vi.setSystemTime(new Date("2026-10-10T08:00:00Z"));
    queueOpeningReads([], [SAT_WINDOW], []);
    const res = await openSession({ opensAt: "10:00", confirm: { mode: "event", eventWindowId: "evw_other" } });
    expect(res).toMatchObject({ ok: false, code: "STALE_STATE" });
    expect(tx.insert).not.toHaveBeenCalled();
  });

  it("§6.6 precedence 2: an event overriding a Sunday needs the confirm step", async () => {
    mockToday.mockReturnValue(SUN);
    vi.setSystemTime(new Date("2026-10-11T16:00:00Z"));
    queueOpeningReads([], [SUN_EVENING], []);
    const res = await openSession({ opensAt: "18:00", confirm: { mode: "event", eventWindowId: "evw_untracked" } });
    expect(res).toMatchObject({ ok: false, code: "CONFIRM_REQUIRED" });
    expect(tx.insert).not.toHaveBeenCalled();
  });

  it("with the Sunday override confirmed, the evening session opens as the event", async () => {
    mockToday.mockReturnValue(SUN);
    vi.setSystemTime(new Date("2026-10-11T16:00:00Z"));
    queueOpeningReads([], [SUN_EVENING], []);
    selectQueue.push([{ ...SESSION_ROW, sessionDate: SUN }]); // the closed morning session
    selectQueue.push([]);
    selectQueue.push([]);
    const res = await openSession({
      opensAt: "18:00", confirm: { mode: "event", eventWindowId: "evw_untracked" }, sundayOverrideConfirmed: true,
    });
    await flush();
    expect(res.ok).toBe(true);
    expect(mockValues).toHaveBeenCalledWith(expect.objectContaining({
      mode: "event", eventWindowId: "evw_untracked", voucherKindsActive: ["untracked_hot_drink"],
    }));
  });

  it("COL-8: the Sunday morning session stays 'sunday' even with an evening event today", async () => {
    mockToday.mockReturnValue(SUN);
    vi.setSystemTime(new Date("2026-10-11T05:30:00Z"));
    queueOpeningReads([], [SUN_EVENING], []);
    selectQueue.push([]); selectQueue.push([]); selectQueue.push([]);
    const res = await openSession({ opensAt: "07:30", confirm: { mode: "sunday" } });
    await flush();
    expect(res.ok).toBe(true);
    expect(mockValues).toHaveBeenCalledWith(expect.objectContaining({ mode: "sunday", eventWindowId: null }));
  });

  it("a recurring profile found by the session's window is materialised as a window in the same transaction", async () => {
    const wedProfile = {
      ...UNTRACKED_PROFILE, id: "evp_social", name: "Wednesday Social",
      recurrence: "FREQ=WEEKLY;BYDAY=WE", defaultStart: "18:30", defaultEnd: "20:30", voucherKinds: [],
    };
    mockToday.mockReturnValue("2026-10-07");
    vi.setSystemTime(new Date("2026-10-07T16:30:00Z"));
    queueOpeningReads([], [], [wedProfile]);
    selectQueue.push([]); selectQueue.push([]); selectQueue.push([]);
    mockReturning
      .mockResolvedValueOnce([{ id: "evw_new" }]) // event_windows insert
      .mockResolvedValueOnce([SESSION_ROW]);      // opening_sessions insert
    const res = await openSession({ opensAt: "18:30", confirm: { mode: "event", eventProfileId: "evp_social" } });
    await flush();
    expect(res.ok).toBe(true);
    expect(mockValues).toHaveBeenNthCalledWith(1, expect.objectContaining({
      eventProfileId: "evp_social", name: "Wednesday Social",
      startsAt: new Date("2026-10-07T16:30:00.000Z"), endsAt: new Date("2026-10-07T18:30:00.000Z"),
      paymentPosture: "standard", consumesCupLid: true,
    }));
    expect(mockValues).toHaveBeenNthCalledWith(2, expect.objectContaining({ mode: "event", eventWindowId: "evw_new" }));
  });

  it("L07: yesterday's session left open is force-closed at midnight, audited as system, then today opens", async () => {
    const stale = { ...OPEN_ROW, id: "os_old", sessionDate: "2026-07-08" };
    queueOpeningReads([stale]);
    selectQueue.push([]); selectQueue.push([]); selectQueue.push([]);
    const res = await openSession({ opensAt: "07:30", confirm: { mode: "weekday" } });
    await flush();
    expect(res.ok).toBe(true);
    expect(mockUpdateSet).toHaveBeenCalledWith({ closedAt: new Date("2026-07-08T22:00:00.000Z") });
    expect(mockWriteAudit).toHaveBeenCalledWith(
      expect.objectContaining({ entityId: "os_old", action: "close", actorRole: "system" }),
      expect.anything()
    );
  });

  it("COL-11: a session bound to an expired window is force-closed at ends_at", async () => {
    mockToday.mockReturnValue(SUN);
    vi.setSystemTime(new Date("2026-10-11T19:00:00Z"));
    const bound = {
      ...OPEN_ROW, id: "os_ev", sessionDate: SUN, opensAt: "18:00", mode: "event",
      eventWindowId: "evw_untracked", windowStartsAt: SUN_EVENING.startsAt, windowEndsAt: SUN_EVENING.endsAt,
    };
    queueOpeningReads([bound], [SUN_EVENING], []);
    selectQueue.push([]); selectQueue.push([]); selectQueue.push([]);
    const res = await openSession({ opensAt: "21:00", confirm: { mode: "sunday" } });
    await flush();
    expect(res.ok).toBe(true);
    expect(mockUpdateSet).toHaveBeenCalledWith({ closedAt: new Date("2026-10-11T18:30:00.000Z") });
  });
});

describe("closeSession (§6.11.1, L43)", () => {
  beforeEach(() => mockAuthorize.mockResolvedValue(BARISTA));

  it("sets closed_at, leaves an uncounted tin NULL, and audits", async () => {
    selectQueue.push([{ id: "os_1", closedAt: null, opensAt: "07:30" }]);
    selectQueue.push([]); // sessions list
    const res = await closeSession("os_1");
    expect(res.ok).toBe(true);
    const set = mockUpdateSet.mock.calls[0][0];
    expect(set.closedAt).toEqual(new Date("2026-07-09T05:30:00Z"));
    expect(set).not.toHaveProperty("voucherSlipsCounted");
    expect(mockWriteAudit).toHaveBeenCalledWith(expect.objectContaining({ entityId: "os_1", action: "close" }), expect.anything());
  });

  it("records a slip count when given, zero included", async () => {
    selectQueue.push([{ id: "os_1", closedAt: null, opensAt: "07:30" }]);
    selectQueue.push([]);
    await closeSession("os_1", 0);
    expect(mockUpdateSet.mock.calls[0][0]).toMatchObject({ voucherSlipsCounted: 0 });
  });

  it("rejects a negative or fractional count", async () => {
    expect(await closeSession("os_1", -1)).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect(await closeSession("os_1", 1.5)).toMatchObject({ ok: false, code: "INVALID_INPUT" });
  });

  it("an already-closed session is STALE_STATE", async () => {
    selectQueue.push([{ id: "os_1", closedAt: new Date(), opensAt: "07:30" }]);
    expect(await closeSession("os_1")).toMatchObject({ ok: false, code: "STALE_STATE" });
    expect(mockUpdateSet).not.toHaveBeenCalled();
  });

  it("an unknown session is NOT_FOUND", async () => {
    selectQueue.push([]);
    expect(await closeSession("os_zzz")).toMatchObject({ ok: false, code: "NOT_FOUND" });
  });
});

describe("openEventWindow (L27, REQ-043, REQ-044)", () => {
  beforeEach(() => mockAuthorize.mockResolvedValue(BARISTA));
  const START = "2026-07-09T08:00:00.000Z";

  it("REQ-043: ends_at is required", async () => {
    const res = await openEventWindow("evp_untracked_church", { startsAt: START } as never);
    expect(res).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect(tx.insert).not.toHaveBeenCalled();
  });

  it("REQ-043: a window longer than 24 h is rejected", async () => {
    selectQueue.push([UNTRACKED_PROFILE]);
    const res = await openEventWindow("evp_untracked_church", { startsAt: START, endsAt: "2026-07-10T08:00:01.000Z" });
    expect(res).toMatchObject({ ok: false, code: "INVALID_INPUT", message: "An event can't run longer than 24 hours." });
    expect(tx.insert).not.toHaveBeenCalled();
  });

  it("REQ-044: a window from a profile snapshots all six switches at open", async () => {
    selectQueue.push([UNTRACKED_PROFILE]);
    mockReturning.mockResolvedValueOnce([{ id: "evw_new" }]);
    const res = await openEventWindow("evp_untracked_church", { startsAt: START, endsAt: "2026-07-09T10:00:00.000Z" });
    expect(res.ok).toBe(true);
    expect(mockValues).toHaveBeenCalledWith(expect.objectContaining({
      eventProfileId: "evp_untracked_church", name: "Untracked Church",
      menuScope: "full", paymentPosture: "standard", consumesCupLid: true, audience: "both",
      extraShotSurcharge: true, voucherKinds: ["untracked_hot_drink"], createdByStaffId: "staff_sam",
    }));
    // The snapshot is a copy: mutating the profile afterwards cannot move it.
    const snap = mockValues.mock.calls[0][0];
    UNTRACKED_PROFILE.voucherKinds.push("later_edit");
    expect(snap.voucherKinds).toEqual(["untracked_hot_drink"]);
    UNTRACKED_PROFILE.voucherKinds.pop();
    expect(mockWriteAudit).toHaveBeenCalledWith(expect.objectContaining({ entityKind: "event_window", action: "create" }), expect.anything());
  });

  it("ad-hoc: switches set directly, start defaults to now (to the minute)", async () => {
    vi.setSystemTime(new Date("2026-07-09T08:05:30Z"));
    mockReturning.mockResolvedValueOnce([{ id: "evw_adhoc" }]);
    const res = await openEventWindow(null, {
      name: "Youth Social", endsAt: "2026-07-09T12:00:00.000Z",
      switches: { ...STANDARD, voucherKinds: [] },
    });
    expect(res.ok).toBe(true);
    expect(mockValues).toHaveBeenCalledWith(expect.objectContaining({
      eventProfileId: null, name: "Youth Social", startsAt: new Date("2026-07-09T08:05:00.000Z"),
    }));
  });

  it("ad-hoc without a name or switches is rejected", async () => {
    const res = await openEventWindow(null, { endsAt: "2026-07-09T12:00:00.000Z" });
    expect(res).toMatchObject({ ok: false, code: "INVALID_INPUT" });
  });

  it("a free or event-price posture is refused until the till can honour it", async () => {
    selectQueue.push([{ ...UNTRACKED_PROFILE, paymentPosture: "free" }]);
    const res = await openEventWindow("evp_x", { endsAt: "2026-07-09T12:00:00.000Z" });
    expect(res).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect(tx.insert).not.toHaveBeenCalled();
  });

  it("an end time already past is rejected", async () => {
    selectQueue.push([UNTRACKED_PROFILE]);
    const res = await openEventWindow("evp_untracked_church", { startsAt: "2026-07-09T04:00:00.000Z", endsAt: "2026-07-09T05:00:00.000Z" });
    expect(res).toMatchObject({ ok: false, code: "INVALID_INPUT" });
  });
});

describe("getOpeningStep", () => {
  beforeEach(() => mockAuthorize.mockResolvedValue(BARISTA));

  it("NO_SESSION: no open session → current is null", async () => {
    queueOpeningReads([], [], [UNTRACKED_PROFILE]);
    selectQueue.push([]);
    const res = await getOpeningStep();
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.current).toBeNull();
      expect(res.data.date).toBe("2026-07-09");
      expect(res.data.profiles.map((p) => p.id)).toEqual(["evp_untracked_church"]);
    }
  });

  it("REQ-042: a session bound to an expired window reads as no current session — no write", async () => {
    mockToday.mockReturnValue(SUN);
    vi.setSystemTime(new Date("2026-10-11T19:00:00Z"));
    const bound = {
      ...OPEN_ROW, id: "os_ev", sessionDate: SUN, mode: "event", eventWindowId: "evw_untracked",
      windowStartsAt: SUN_EVENING.startsAt, windowEndsAt: SUN_EVENING.endsAt,
    };
    queueOpeningReads([bound], [SUN_EVENING], []);
    selectQueue.push([]);
    const res = await getOpeningStep();
    mockToday.mockReturnValue("2026-07-09");
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data.current).toBeNull();
    expect(tx.update).not.toHaveBeenCalled();
    expect(mockWriteAudit).not.toHaveBeenCalled();
  });

  it("an open session today is the current session", async () => {
    queueOpeningReads([OPEN_ROW]);
    selectQueue.push([SESSION_ROW]);
    const res = await getOpeningStep();
    if (res.ok) expect(res.data.current).toMatchObject({ id: "os_1", opensAt: "07:30", mode: "weekday", eventWindow: null });
  });
});
