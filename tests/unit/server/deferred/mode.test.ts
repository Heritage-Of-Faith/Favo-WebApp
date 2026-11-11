// setDeferredMode — PRD v7.0 §6.0.4 T3 steps 1 and 4, S2a, §10.3, the §11.2
// catalogue row ("Writes opening_sessions.deferred_*, records
// deferred_entered_by='manual', and fires S2a's Admin push. Audited with the
// reason"), the §11.3 matrix rows for on / off-by-check / off-manual.
//   REQ-005: Given a session not in deferred mode · When setDeferredMode(on)
//            succeeds · Then an Admin push fires within one minute, and again
//            every 30 minutes the session stays deferred.
//   REQ-006: Given deferred_entered_by='health_check' · When a barista attempts
//            to exit deferred mode · Then it is refused; only an Admin or a
//            passing check may clear it.

import { describe, it, expect, vi } from "vitest";
import {
  DEFERRED_BANNER,
  DEFERRED_ORDER_NOTICE,
  applyDeferredMode,
  decideDeferredChange,
  deferredAlert,
  deferredReminderDue,
  type DeferredActor,
  type DeferredAudit,
  type DeferredDeps,
  type DeferredPatch,
  type DeferredTx,
  type SessionDeferredState,
} from "@/server/deferred/mode";

const T0 = new Date("2026-11-08T07:10:00.000Z"); // Sunday 09:10 SAST
const LOUIS: DeferredActor = { kind: "staff", staffId: "staff_louis", role: "barista" };
const ADMIN: DeferredActor = { kind: "staff", staffId: "staff_admin_mia", role: "admin" };
const CHECK: DeferredActor = { kind: "system" };

function session(over: Partial<SessionDeferredState> = {}): SessionDeferredState {
  return {
    id: "sess-1", sessionDate: "2026-11-08", opensAt: "07:50", closedAt: null,
    deferredSince: null, deferredReason: null, deferredByStaffId: null, deferredEnteredBy: null,
    ...over,
  };
}

function world(initial: SessionDeferredState | null = session()) {
  const state = { session: initial ? { ...initial } : null, audit: [] as DeferredAudit[] };
  const tx: DeferredTx = {
    lockSession: async (id) => (state.session && state.session.id === id ? { ...state.session } : null),
    setDeferred: async (_id, patch: DeferredPatch) => { state.session = { ...(state.session as SessionDeferredState), ...patch }; },
    audit: async (row) => { state.audit.push(row); },
  };
  const notifyEntered = vi.fn(async () => {});
  const deps: DeferredDeps = { store: { transaction: (fn) => fn(tx) }, now: () => T0, notifyEntered };
  return { state, deps, notifyEntered };
}

describe("PRD copy, verbatim", () => {
  it("T3's banner and per-order notice", () => {
    expect(DEFERRED_BANNER).toBe("Card machine unavailable — orders are being taken unpaid.");
    expect(DEFERRED_ORDER_NOTICE).toBe("This order is unpaid — settle it when the machine is back.");
  });
});

describe("REQ-005 — entering fires the Admin push; staying deferred repeats it every 30 minutes", () => {
  it("a barista's tap writes deferred_* with entered_by='manual', audits the reason, and pushes once", async () => {
    const w = world();
    const r = await applyDeferredMode(w.deps, LOUIS, "sess-1", true, "terminal_unreachable");
    expect(r).toEqual({ ok: true, changed: true, deferred: true, enteredBy: "manual" });
    expect(w.state.session).toMatchObject({
      deferredSince: T0, deferredReason: "terminal_unreachable", deferredByStaffId: "staff_louis", deferredEnteredBy: "manual",
    });
    expect(w.state.audit).toMatchObject([
      { entityKind: "opening_session", entityId: "sess-1", action: "deferred_mode.enter", actorId: "staff_louis",
        actorRole: "barista", reason: "terminal_unreachable" },
    ]);
    expect(w.notifyEntered).toHaveBeenCalledTimes(1);
    expect(w.notifyEntered).toHaveBeenCalledWith({
      sessionId: "sess-1", sessionDate: "2026-11-08", opensAt: "07:50", reason: "terminal_unreachable",
      enteredBy: "manual", byStaffId: "staff_louis", since: T0,
    });
  });

  it("the push names the barista, the session and the reason (S2a)", () => {
    const a = deferredAlert(
      { sessionId: "sess-1", sessionDate: "2026-11-08", opensAt: "07:50", reason: "terminal_unreachable", enteredBy: "manual", since: T0 },
      "Louis"
    );
    expect(a.body).toContain("Louis");
    expect(a.body).toContain("2026-11-08 07:50");
    expect(a.body).toContain("terminal_unreachable");
  });

  it("a session already deferred is unchanged: nothing written, no second push", async () => {
    const w = world(session({ deferredSince: T0, deferredEnteredBy: "manual", deferredReason: "x", deferredByStaffId: "staff_louis" }));
    const r = await applyDeferredMode(w.deps, LOUIS, "sess-1", true, "again");
    expect(r).toEqual({ ok: true, changed: false, deferred: true, enteredBy: "manual" });
    expect(w.state.audit).toEqual([]);
    expect(w.notifyEntered).not.toHaveBeenCalled();
  });

  it("the repeat is due at exactly 30 minutes after the last push, not at 29:59", () => {
    expect(deferredReminderDue(T0, new Date(T0.getTime() + 29 * 60_000 + 59_000))).toBe(false);
    expect(deferredReminderDue(T0, new Date(T0.getTime() + 30 * 60_000))).toBe(true);
  });

  it("a failed push never undoes the entry", async () => {
    const w = world();
    w.notifyEntered.mockRejectedValueOnce(new Error("push down"));
    vi.spyOn(console, "error").mockImplementationOnce(() => {});
    const r = await applyDeferredMode(w.deps, LOUIS, "sess-1", true, "terminal_unreachable");
    expect(r).toMatchObject({ ok: true, deferred: true });
    expect(w.state.session?.deferredSince).toEqual(T0);
  });

  it("the device check enters as 'health_check' with no barista", async () => {
    const w = world();
    const r = await applyDeferredMode(w.deps, CHECK, "sess-1", true, "three_failed_device_checks");
    expect(r).toMatchObject({ ok: true, enteredBy: "health_check" });
    expect(w.state.session).toMatchObject({ deferredEnteredBy: "health_check", deferredByStaffId: null });
    expect(w.state.audit[0]).toMatchObject({ actorRole: "system", action: "deferred_mode.enter" });
  });
});

describe("REQ-006 — a check-triggered entry: a barista is refused; an Admin or a passing check clears it", () => {
  const byCheck = () => session({ deferredSince: T0, deferredEnteredBy: "health_check", deferredReason: "checks" });

  it("a barista is refused FORBIDDEN 'Needs an admin', the refusal is audited, and the session stays deferred", async () => {
    const w = world(byCheck());
    const r = await applyDeferredMode(w.deps, LOUIS, "sess-1", false, "machine back");
    expect(r).toEqual({ ok: false, code: "FORBIDDEN", message: "Needs an admin" });
    expect(w.state.session?.deferredSince).toEqual(T0);
    expect(w.state.audit).toMatchObject([
      { action: "deferred_mode.reject", actorId: "staff_louis", reason: "health_check_entry_needs_admin", after: { code: "FORBIDDEN" } },
    ]);
  });

  it.each([["an Admin", ADMIN], ["a passing check", CHECK]] as const)("%s clears it", async (_n, actor) => {
    const w = world(byCheck());
    const r = await applyDeferredMode(w.deps, actor, "sess-1", false, "");
    expect(r).toEqual({ ok: true, changed: true, deferred: false, enteredBy: null });
    expect(w.state.session).toMatchObject({ deferredSince: null, deferredReason: null, deferredByStaffId: null, deferredEnteredBy: null });
    expect(w.state.audit[0]).toMatchObject({ action: "deferred_mode.exit" });
  });
});

describe("T3 step 4 — a manual entry exits only manually", () => {
  const manual = () => session({ deferredSince: T0, deferredEnteredBy: "manual", deferredReason: "flat", deferredByStaffId: "staff_louis" });

  it("passing checks never clear a manual entry", async () => {
    const w = world(manual());
    const r = await applyDeferredMode(w.deps, CHECK, "sess-1", false, "");
    expect(r).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(w.state.session?.deferredSince).toEqual(T0);
  });

  it.each([["the barista", LOUIS], ["an Admin", ADMIN]] as const)("%s clears it with the same tap", async (_n, actor) => {
    const w = world(manual());
    expect(await applyDeferredMode(w.deps, actor, "sess-1", false, "")).toMatchObject({ ok: true, deferred: false });
  });
});

describe("S7a + owner decision: the server refuses deferred mode where nobody pays", () => {
  const THU = "2026-11-05";

  it.each([
    ["a weekday session", { sessionDate: THU, mode: "weekday" }],
    ["a weekday date with no event", { sessionDate: THU, mode: null }],
    ["a free-posture event", { sessionDate: "2026-11-07", mode: "event", eventPaymentPosture: "free" }],
  ] as const)("%s → MODE_FORBIDDEN, audited, no push, nothing written", async (_n, over) => {
    const w = world(session(over));
    const r = await applyDeferredMode(w.deps, LOUIS, "sess-1", true, "terminal_unreachable");
    expect(r).toEqual({ ok: false, code: "MODE_FORBIDDEN", message: "Nobody pays in this session — deferred mode is not needed." });
    expect(w.state.session?.deferredSince).toBeNull();
    expect(w.state.audit).toMatchObject([{ action: "deferred_mode.reject", reason: "no_payment_in_session" }]);
    expect(w.notifyEntered).not.toHaveBeenCalled();
  });

  it.each([
    ["a Sunday session", { sessionDate: "2026-11-08", mode: "sunday" }],
    ["a paying event on a weekday (standard)", { sessionDate: THU, mode: "event", eventPaymentPosture: "standard" }],
    ["a paying event (override prices)", { sessionDate: "2026-11-07", mode: "event", eventPaymentPosture: "override" }],
  ] as const)("%s may enter", async (_n, over) => {
    const w = world(session(over));
    expect(await applyDeferredMode(w.deps, LOUIS, "sess-1", true, "terminal_unreachable")).toMatchObject({ ok: true, deferred: true });
  });

  it("leaving is never blocked by the mode", async () => {
    const w = world(session({ sessionDate: THU, mode: "weekday", deferredSince: T0, deferredEnteredBy: "manual" }));
    expect(await applyDeferredMode(w.deps, LOUIS, "sess-1", false, "")).toMatchObject({ ok: true, deferred: false });
  });

  it("a reason needs at least 3 non-space characters", async () => {
    const w = world();
    expect(await applyDeferredMode(w.deps, LOUIS, "sess-1", true, " a b ")).toMatchObject({
      ok: false, code: "VALIDATION", message: "Give a reason — at least 3 characters.",
    });
    expect(await applyDeferredMode(w.deps, LOUIS, "sess-1", true, "  flat   battery ")).toMatchObject({ ok: true });
    expect(w.state.session?.deferredReason).toBe("flat battery");
  });
});

describe("session-scoped, and refusals", () => {
  it("a closed session (or none) is NO_SESSION, audited", async () => {
    const w = world(session({ closedAt: T0 }));
    expect(await applyDeferredMode(w.deps, LOUIS, "sess-1", true, "x")).toMatchObject({ ok: false, code: "NO_SESSION" });
    expect(w.state.audit[0]).toMatchObject({ action: "deferred_mode.reject", reason: "no_open_session" });
    expect(decideDeferredChange(null, LOUIS, true, "x")).toMatchObject({ kind: "refuse", code: "NO_SESSION" });
  });

  it("entering needs a reason (the catalogue: 'Audited with the reason')", async () => {
    const w = world();
    expect(await applyDeferredMode(w.deps, LOUIS, "sess-1", true, "  ")).toMatchObject({ ok: false, code: "VALIDATION" });
    expect(w.state.session?.deferredSince).toBeNull();
    expect(w.notifyEntered).not.toHaveBeenCalled();
  });

  it("exiting a session that is not deferred is unchanged and pushes nothing", async () => {
    const w = world();
    expect(await applyDeferredMode(w.deps, LOUIS, "sess-1", false, "")).toEqual({ ok: true, changed: false, deferred: false, enteredBy: null });
    expect(w.state.audit).toEqual([]);
  });
});
