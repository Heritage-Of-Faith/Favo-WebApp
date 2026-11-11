// Shift-start push (PRD §6.3 "a shift-start push to whoever is on duty",
// §6.11.1 COL-23 "§6.3's shift-start push fires per session", §10.3
// barista_shifts `session_id, or shift_date + slot`, §9.6 Web Push).
//
// When a session opens, its slot is read from a counter that survives a
// deleted session (the day's audited opening_session `create` rows), the rota
// rows planned for (date, slot) are attached to it, and each rostered barista
// is pushed ONCE (notified_at is the dedupe record). A send that does not
// arrive leaves notified_at NULL and is audited as shift_start_push_failed;
// one failure never skips the next barista. Nobody rostered → nothing at all.
// Not a scheduled job.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";

const mockWriteAudit = vi.fn().mockResolvedValue(undefined);
vi.mock("@/server/audit", () => ({ writeAudit: (...a: unknown[]) => mockWriteAudit(...a) }));

const mockSendShiftStartPush = vi.fn();
vi.mock("@/server/push/send", () => ({
  sendShiftStartPush: (...a: unknown[]) => mockSendShiftStartPush(...a),
}));

const selectQueue: unknown[][] = [];
function chain() {
  const rows = selectQueue.shift() ?? [];
  const c: Record<string, unknown> = {};
  for (const m of ["from", "where", "innerJoin", "orderBy"]) c[m] = vi.fn().mockReturnValue(c);
  c.then = (resolve: (v: unknown[]) => void) => Promise.resolve(rows).then(resolve);
  return c;
}
// Every update(...).set(v).where(w) is recorded; it is awaitable (attach,
// release) and has .returning() (the notified_at claim).
const updates: { set: Record<string, unknown>; where: SQL }[] = [];
const claimQueue: unknown[][] = [];
let updateThrows: Error | null = null;
function updateChain() {
  if (updateThrows) throw updateThrows;
  return {
    set: (v: Record<string, unknown>) => ({
      where: (w: SQL) => {
        updates.push({ set: v, where: w });
        return {
          returning: vi.fn().mockImplementation(async () => claimQueue.shift() ?? []),
          then: (resolve: (v: unknown) => void) => Promise.resolve(undefined).then(resolve),
        };
      },
    }),
  };
}
vi.mock("@/lib/db", () => ({
  db: {
    select: vi.fn().mockImplementation(chain),
    update: vi.fn().mockImplementation(updateChain),
  },
}));

import { notifyShiftStart, fireShiftStart } from "@/server/rota/shift-start";
import { buildShiftStartPayload } from "@/server/push/payload";

const params = (w: SQL) => new PgDialect().sqlToQuery(w).params;

const SUB = { endpoint: "https://push/x", keys: { p256dh: "k", auth: "a" } };
const EVENING = { sessionId: "os_evening", sessionDate: "2026-11-15", opensAt: "18:30" };
const ACTOR = { id: "staff_nkuli", role: "barista" };
const NKULI = { id: "bs_nkuli", staffId: "staff_nkuli", active: true, pushSubscription: SUB };
const THANDEKA = { id: "bs_thandeka", staffId: "staff_thandeka", active: true, pushSubscription: SUB };
const CLAIM = (id: string) => [{ id, notifiedAt: new Date("2026-11-15T16:30:00Z") }];

const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  vi.clearAllMocks();
  selectQueue.length = 0;
  claimQueue.length = 0;
  updates.length = 0;
  updateThrows = null;
  mockSendShiftStartPush.mockResolvedValue("sent");
});

describe("notifyShiftStart", () => {
  it("nobody rostered for the session's date + slot: no push and no audit", async () => {
    selectQueue.push([{ n: 1 }], []);
    const res = await notifyShiftStart(EVENING, ACTOR);
    expect(res).toEqual({ slot: 1, pushed: [] });
    expect(mockSendShiftStartPush).not.toHaveBeenCalled();
    expect(mockWriteAudit).not.toHaveBeenCalled();
  });

  it("a session with no audited create row has no slot: nothing is attached or sent", async () => {
    selectQueue.push([{ n: 0 }]);
    const res = await notifyShiftStart(EVENING, ACTOR);
    expect(res).toEqual({ slot: null, pushed: [] });
    expect(updates).toHaveLength(0);
    expect(mockSendShiftStartPush).not.toHaveBeenCalled();
  });

  it("attaches the planned shift, claims notified_at, pushes once, audits pushed:true", async () => {
    selectQueue.push([{ n: 1 }], [NKULI]);
    claimQueue.push(CLAIM("bs_nkuli"));
    const res = await notifyShiftStart({ ...EVENING, opensAt: "08:45" }, ACTOR);

    expect(res).toEqual({ slot: 1, pushed: ["staff_nkuli"] });
    expect(updates[0]!.set).toEqual({ sessionId: "os_evening" });
    expect(params(updates[0]!.where)).toEqual(["2026-11-15", 1]);
    expect(updates[1]!.set.notifiedAt).toBeInstanceOf(Date);
    expect(updates).toHaveLength(2); // no release
    expect(mockSendShiftStartPush).toHaveBeenCalledTimes(1);
    expect(mockSendShiftStartPush).toHaveBeenCalledWith(SUB, "08:45");
    expect(mockWriteAudit).toHaveBeenCalledTimes(1);
    expect(mockWriteAudit.mock.calls[0]![0]).toMatchObject({
      entityKind: "barista_shift", entityId: "bs_nkuli", action: "shift_start_push",
      actorId: "staff_nkuli", actorRole: "barista",
      after: { sessionId: "os_evening", staffId: "staff_nkuli", slot: 1, pushed: true },
    });
  });

  it("delete-then-reopen: the morning's audit row still counts, so the evening is slot 2 and only slot 2 is attached", async () => {
    // Morning (slot 1, Louis) opened, closed and was deleted by an Admin: its
    // opening_sessions row is gone, its audited create row is not. The counter
    // for the evening session is 2, so the attach targets (date, 2) — Louis's
    // slot-1 row is never re-attached — and only Nkuli is due.
    selectQueue.push([{ n: 2 }], [NKULI]);
    claimQueue.push(CLAIM("bs_nkuli"));
    const res = await notifyShiftStart(EVENING, ACTOR);

    expect(res).toEqual({ slot: 2, pushed: ["staff_nkuli"] });
    expect(params(updates[0]!.where)).toEqual(["2026-11-15", 2]);
    expect(mockSendShiftStartPush).toHaveBeenCalledTimes(1);
    expect(mockSendShiftStartPush).toHaveBeenCalledWith(SUB, "18:30");
  });

  it("a shift already claimed by another open is not pushed again (idempotent)", async () => {
    selectQueue.push([{ n: 2 }], [NKULI]);
    claimQueue.push([]); // notified_at was already set
    const res = await notifyShiftStart(EVENING, ACTOR);
    expect(res.pushed).toEqual([]);
    expect(mockSendShiftStartPush).not.toHaveBeenCalled();
    expect(mockWriteAudit).not.toHaveBeenCalled();
  });

  it("a send that throws (no VAPID keys) releases notified_at, audits shift_start_push_failed, and the next barista is still pushed", async () => {
    selectQueue.push([{ n: 2 }], [NKULI, THANDEKA]);
    claimQueue.push(CLAIM("bs_nkuli"), CLAIM("bs_thandeka"));
    mockSendShiftStartPush
      .mockRejectedValueOnce(new Error("VAPID keys missing"))
      .mockResolvedValueOnce("sent");
    const res = await notifyShiftStart(EVENING, ACTOR);

    expect(res.pushed).toEqual(["staff_thandeka"]);
    // attach, claim Nkuli, release Nkuli, claim Thandeka
    expect(updates.map((u) => Object.keys(u.set)[0])).toEqual(["sessionId", "notifiedAt", "notifiedAt", "notifiedAt"]);
    expect(updates[2]!.set).toEqual({ notifiedAt: null });
    const actions = mockWriteAudit.mock.calls.map((c) => [(c[0] as { entityId: string }).entityId, (c[0] as { action: string }).action]);
    expect(actions).toEqual([["bs_nkuli", "shift_start_push_failed"], ["bs_thandeka", "shift_start_push"]]);
    expect(mockWriteAudit.mock.calls[0]![0]).toMatchObject({ after: { pushed: false, why: "send_error" } });
  });

  it("a send that gave up after its retries is NOT audited as pushed: notified_at released, failure audited", async () => {
    selectQueue.push([{ n: 2 }], [NKULI]);
    claimQueue.push(CLAIM("bs_nkuli"));
    mockSendShiftStartPush.mockResolvedValueOnce("failed");
    const res = await notifyShiftStart(EVENING, ACTOR);
    expect(res.pushed).toEqual([]);
    expect(updates[2]!.set).toEqual({ notifiedAt: null });
    expect(mockWriteAudit).toHaveBeenCalledTimes(1);
    expect(mockWriteAudit.mock.calls[0]![0]).toMatchObject({
      action: "shift_start_push_failed", after: { pushed: false, why: "send_failed" },
    });
  });

  it("a gone subscription (404/410) is a failure too", async () => {
    selectQueue.push([{ n: 2 }], [NKULI]);
    claimQueue.push(CLAIM("bs_nkuli"));
    mockSendShiftStartPush.mockResolvedValueOnce("gone");
    await notifyShiftStart(EVENING, ACTOR);
    expect(mockWriteAudit.mock.calls[0]![0]).toMatchObject({
      action: "shift_start_push_failed", after: { why: "subscription_gone" },
    });
  });

  it("an audit write that throws for one barista does not stop the next", async () => {
    selectQueue.push([{ n: 2 }], [NKULI, THANDEKA]);
    claimQueue.push(CLAIM("bs_nkuli"), CLAIM("bs_thandeka"));
    mockWriteAudit.mockRejectedValueOnce(new Error("db down"));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    await notifyShiftStart(EVENING, ACTOR);
    expect(mockSendShiftStartPush).toHaveBeenCalledTimes(2);
    err.mockRestore();
  });

  it("a rostered barista with no push subscription is not pushed, notified_at stays NULL, audited", async () => {
    selectQueue.push([{ n: 1 }], [{ ...NKULI, pushSubscription: null }]);
    const res = await notifyShiftStart(EVENING, ACTOR);
    expect(res.pushed).toEqual([]);
    expect(updates).toHaveLength(1); // the attach only, no claim
    expect(mockWriteAudit.mock.calls[0]![0]).toMatchObject({
      action: "shift_start_push", after: { pushed: false, why: "no_subscription" },
    });
  });

  it("a deactivated barista is never pushed", async () => {
    selectQueue.push([{ n: 1 }], [{ ...NKULI, active: false }]);
    await notifyShiftStart(EVENING, ACTOR);
    expect(mockSendShiftStartPush).not.toHaveBeenCalled();
    expect(mockWriteAudit.mock.calls[0]![0]).toMatchObject({ after: { pushed: false, why: "inactive" } });
  });
});

describe("fireShiftStart", () => {
  it("swallows a rejection, so the open that triggered it never fails", async () => {
    selectQueue.push([{ n: 1 }]);
    updateThrows = new Error("connection reset");
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => fireShiftStart(EVENING, ACTOR)).not.toThrow();
    await flush();
    expect(err).toHaveBeenCalledWith(
      "[push] shift-start push failed", { sessionId: "os_evening" }, expect.any(Error)
    );
    err.mockRestore();
  });
});

describe("buildShiftStartPayload — plain, not decorated (§6.3)", () => {
  it("names the opening time and carries no emoji", () => {
    const p = JSON.parse(buildShiftStartPayload("18:30")) as { title: string; body: string; data: { url: string } };
    expect(p.title).toBe("You're on duty");
    expect(p.body).toBe("FAVO opened at 18:30.");
    expect(p.data.url).toBe("/pos");
    expect(`${p.title}${p.body}`).not.toMatch(/\p{Extended_Pictographic}/u);
  });
});
