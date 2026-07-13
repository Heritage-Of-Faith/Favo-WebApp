// Opening sessions — AT-134 backend.
// Notification rules: push on first submission or a genuinely new session
// (reopening); never on re-confirming an unchanged time. Admin planner CRUD
// is silent and admin-only.

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockAuthorize = vi.fn();
vi.mock("@/server/auth/guard", () => ({
  authorize: (...a: unknown[]) => mockAuthorize(...a),
}));

const mockWriteAudit = vi.fn().mockResolvedValue(undefined);
vi.mock("@/server/audit", () => ({ writeAudit: (...a: unknown[]) => mockWriteAudit(...a) }));

vi.mock("@/server/cogs/compute", () => ({ todaySast: () => "2026-07-09" }));

const mockSendOpeningPush = vi.fn().mockResolvedValue(true);
vi.mock("@/server/push/send", () => ({
  sendOpeningPush: (...a: unknown[]) => mockSendOpeningPush(...a),
}));
vi.mock("@/server/push/payload", () => ({ isValidPushSubscription: () => true }));

// db mock: every select() (on db or tx) consumes the next row-set from a FIFO
// queue via a self-returning thenable chain, so from/where/orderBy all work.
const selectQueue: unknown[][] = [];
function chain() {
  const rows = selectQueue.shift() ?? [];
  const c: Record<string, unknown> = {};
  for (const m of ["from", "where", "orderBy"]) c[m] = vi.fn().mockReturnValue(c);
  c.then = (resolve: (v: unknown[]) => void) => Promise.resolve(rows).then(resolve);
  return c;
}
const mockReturning = vi.fn();
const mockUpdateWhere = vi.fn().mockResolvedValue(undefined);
const mockDeleteWhere = vi.fn().mockResolvedValue(undefined);
const tx = {
  select: vi.fn().mockImplementation(chain),
  insert: vi.fn().mockImplementation(() => ({
    values: vi.fn().mockReturnValue({
      onConflictDoNothing: vi.fn().mockReturnValue({ returning: mockReturning }),
    }),
  })),
  update: vi.fn().mockImplementation(() => ({ set: vi.fn().mockReturnValue({ where: mockUpdateWhere }) })),
  delete: vi.fn().mockImplementation(() => ({ where: mockDeleteWhere })),
};
vi.mock("@/lib/db", () => ({
  db: {
    select: vi.fn().mockImplementation(chain),
    transaction: vi.fn().mockImplementation(async (cb: (t: unknown) => unknown) => cb(tx)),
  },
}));

import { getTodaySessions, submitOpeningTime, addTodaySession, updateTodaySession, deleteTodaySession } from "@/server/actions/opening";

const BARISTA = { ok: true, session: { id: "staff_sam", name: "Sam", role: "barista" } };
const ADMIN = { ok: true, session: { id: "staff_gian", name: "Gian", role: "admin" } };
const NO_AUTH = { ok: false, code: "UNAUTHORIZED", message: "You must be signed in." };

const SESSION_ROW = {
  id: "os_1", sessionDate: "2026-07-09", opensAt: "07:30", closesAt: null,
  viaPos: true, notifiedAt: new Date("2026-07-09T05:30:00Z"),
};
const SUBS = [{ id: "c1", pushSubscription: { endpoint: "https://push/1", keys: {} } }];

beforeEach(() => {
  vi.clearAllMocks();
  selectQueue.length = 0;
  mockReturning.mockResolvedValue([SESSION_ROW]);
});

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

  it("re-confirming an unchanged time is a silent no-op", async () => {
    selectQueue.push([SESSION_ROW]); // 07:30 already recorded
    const res = await submitOpeningTime("07:30");
    await flush();

    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data.notified).toBe(false);
    expect(tx.insert).not.toHaveBeenCalled();
    expect(mockSendOpeningPush).not.toHaveBeenCalled();
  });

  it("a different time on a day with sessions notifies as a reopening", async () => {
    selectQueue.push([SESSION_ROW]); // 07:30 exists; submitting 14:00
    selectQueue.push(SUBS);
    selectQueue.push([SESSION_ROW, { ...SESSION_ROW, id: "os_2", opensAt: "14:00" }]);
    mockReturning.mockResolvedValue([{ ...SESSION_ROW, id: "os_2", opensAt: "14:00" }]);

    const res = await submitOpeningTime("14:00");
    await flush();
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data.notified).toBe(true);
    expect(mockSendOpeningPush).toHaveBeenCalledWith(SUBS[0].pushSubscription, "14:00", true);
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
    mockReturning.mockResolvedValue([{ id: "os_9" }]);
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
    mockReturning.mockResolvedValue([{ id: "os_9" }]);
    selectQueue.push([]);            // isReopening check — no prior sessions today
    selectQueue.push(SUBS);          // push subscriptions (async fan-out)
    selectQueue.push([SESSION_ROW]); // sessions list for the response
    const res = await addTodaySession({ opensAt: "14:00", notify: true });
    await flush();
    expect(res.ok).toBe(true);
    expect(mockSendOpeningPush).toHaveBeenCalledWith(SUBS[0].pushSubscription, "14:00", false);
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
