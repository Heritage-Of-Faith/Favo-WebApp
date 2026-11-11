// The 60 s device check and the one tap after TERMINAL_UNREACHABLE.
// PRD v7.0 §6.7 "Detection": "The first failed send is the primary signal —
// TERMINAL_UNREACHABLE offers deferred mode one tap away. A background device
// check every 60 s is the backstop; three consecutive failures put the till
// into deferred mode on their own." T3 step 4: "A manual entry exits only
// manually. A check-triggered entry also exits on three consecutive successful
// checks." REQ-005 (the Admin push on entry), REQ-006 (a barista cannot clear a
// health_check entry; only an Admin or a passing check may).
// The device is FakeYocoWebPosPort — never live Yoco.

import { describe, it, expect, vi } from "vitest";
import { FakeYocoWebPosPort } from "@/server/yoco/webpos-fake";
import type { WebPosDeviceResult, YocoWebPosPort } from "@/server/yoco/webpos-port";
import {
  applyDeferredMode,
  enterDeferredAfterUnreachable,
  TERMINAL_UNREACHABLE_DEFERRED_REASON,
  type DeferredActor,
  type DeferredAudit,
  type DeferredDeps,
  type DeferredPatch,
  type DeferredTx,
  type SessionDeferredState,
} from "@/server/deferred/mode";
import {
  checkDeviceHealth,
  nextStreak,
  DEVICE_CHECK_INTERVAL_MS,
  FAILED_CHECKS_TO_ENTER,
  PASSED_CHECKS_TO_EXIT,
  HEALTH_CHECK_ENTER_REASON,
  type DeviceStreak,
  type HealthCheckDeps,
} from "@/server/deferred/health-check";
import { sessionTakesPayment } from "@/server/deferred/mode";

const T0 = new Date("2026-11-08T07:10:00.000Z"); // Sunday 09:10 SAST
const LOUIS = { kind: "staff" as const, staffId: "staff_louis", role: "barista" as const };
const ADMIN: DeferredActor = { kind: "staff", staffId: "staff_admin_mia", role: "admin" };

function session(over: Partial<SessionDeferredState> = {}): SessionDeferredState {
  return {
    id: "sess-1", sessionDate: "2026-11-08", opensAt: "07:50", closedAt: null,
    deferredSince: null, deferredReason: null, deferredByStaffId: null, deferredEnteredBy: null,
    ...over,
  };
}

/** A device whose answer the test can change between checks. */
class SwitchableDevice implements Pick<YocoWebPosPort, "lookupDevice"> {
  answer: WebPosDeviceResult | "throw" = { kind: "online", model: "Khumo", serialNumber: "S1" };
  lookups = 0;
  async lookupDevice(): Promise<WebPosDeviceResult> {
    this.lookups += 1;
    if (this.answer === "throw") throw new Error("network");
    return this.answer;
  }
}

function world(initial: SessionDeferredState = session(), opts: { live?: boolean; deviceId?: string | null } = {}) {
  const state = { session: { ...initial } as SessionDeferredState | null, audit: [] as DeferredAudit[] };
  const tx: DeferredTx = {
    lockSession: async (id) => (state.session && state.session.id === id ? { ...state.session } : null),
    setDeferred: async (_id, patch: DeferredPatch) => { state.session = { ...(state.session as SessionDeferredState), ...patch }; },
    audit: async (row) => { state.audit.push(row); },
  };
  let now = T0;
  const notifyEntered = vi.fn(async () => {});
  const deferredDeps: DeferredDeps = { store: { transaction: (fn) => fn(tx) }, now: () => now, notifyEntered };
  const device = new SwitchableDevice();
  let streak: DeviceStreak | null = null;
  const deps: HealthCheckDeps = {
    now: () => now,
    live: opts.live ?? true,
    readDeviceId: async () => (opts.deviceId === undefined ? "dev-khumo-1" : opts.deviceId),
    port: device,
    readOpenSession: async () => {
      const s = state.session;
      if (!s || s.closedAt) return null;
      const deferredChanges = state.audit.filter(
        (a) => a.entityId === s.id && (a.action === "deferred_mode.enter" || a.action === "deferred_mode.exit")
      ).length;
      return { sessionId: s.id, takesPayment: sessionTakesPayment(s), deferred: s.deferredSince !== null, enteredBy: s.deferredEnteredBy, deferredChanges };
    },
    streak: { get: () => streak, set: (s) => { streak = s; } },
    setDeferred: (id, on, reason) => applyDeferredMode(deferredDeps, { kind: "system" }, id, on, reason),
  };
  return {
    state, deps, device, deferredDeps, notifyEntered,
    /** One check, 60 s after the previous one. */
    async tick() {
      const r = await checkDeviceHealth(deps);
      now = new Date(now.getTime() + DEVICE_CHECK_INTERVAL_MS);
      return r;
    },
  };
}

const OFFLINE: WebPosDeviceResult = { kind: "device_error" };

describe("the numbers are the PRD's", () => {
  it("60 s, three to enter, three to exit", () => {
    expect(DEVICE_CHECK_INTERVAL_MS).toBe(60_000);
    expect(FAILED_CHECKS_TO_ENTER).toBe(3);
    expect(PASSED_CHECKS_TO_EXIT).toBe(3);
  });
});

describe("§6.7: three consecutive failed checks put the till into deferred mode on their own", () => {
  it("two failures do nothing; the third enters with deferred_entered_by='health_check', audited, Admin pushed (REQ-005)", async () => {
    const w = world();
    w.device.answer = OFFLINE;
    expect(await w.tick()).toMatchObject({ ran: true, read: "fail", fails: 1, action: "none" });
    expect(await w.tick()).toMatchObject({ ran: true, read: "fail", fails: 2, action: "none" });
    expect(w.state.session!.deferredSince).toBeNull();
    expect(await w.tick()).toMatchObject({ ran: true, read: "fail", fails: 3, action: "entered" });
    expect(w.state.session).toMatchObject({
      deferredEnteredBy: "health_check", deferredByStaffId: null, deferredReason: HEALTH_CHECK_ENTER_REASON,
    });
    expect(w.state.audit).toMatchObject([
      { action: "deferred_mode.enter", actorRole: "system", reason: HEALTH_CHECK_ENTER_REASON },
    ]);
    expect(w.notifyEntered).toHaveBeenCalledTimes(1);
    expect(w.notifyEntered).toHaveBeenCalledWith(expect.objectContaining({ enteredBy: "health_check", byStaffId: null }));
  });

  it("a pass between failures resets the count — they must be consecutive", async () => {
    const w = world();
    w.device.answer = OFFLINE;
    await w.tick();
    await w.tick();
    w.device.answer = { kind: "online", model: "Khumo", serialNumber: "S1" };
    await w.tick();
    w.device.answer = OFFLINE;
    await w.tick();
    expect(await w.tick()).toMatchObject({ fails: 2, action: "none" });
    expect(w.state.session!.deferredSince).toBeNull();
  });

  it("a fetch error is never a status (§6.8.4): it counts neither way", async () => {
    const w = world();
    w.device.answer = OFFLINE;
    await w.tick();
    await w.tick();
    w.device.answer = { kind: "fetch_error" };
    expect(await w.tick()).toMatchObject({ read: "inconclusive", fails: 2, action: "none" });
    w.device.answer = "throw";
    expect(await w.tick()).toMatchObject({ read: "inconclusive", fails: 2, action: "none" });
    expect(w.state.session!.deferredSince).toBeNull();
  });
});

describe("T3 step 4 / REQ-006: the exit is asymmetric", () => {
  it("a check-triggered entry: a barista is refused; three consecutive passes clear it", async () => {
    const w = world(session({ deferredSince: T0, deferredReason: "x", deferredEnteredBy: "health_check" }));
    expect(await applyDeferredMode(w.deferredDeps, LOUIS, "sess-1", false, "")).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(await w.tick()).toMatchObject({ read: "pass", passes: 1, action: "none" });
    expect(await w.tick()).toMatchObject({ read: "pass", passes: 2, action: "none" });
    expect(w.state.session!.deferredSince).toEqual(T0);
    expect(await w.tick()).toMatchObject({ read: "pass", passes: 3, action: "exited" });
    expect(w.state.session).toMatchObject({ deferredSince: null, deferredEnteredBy: null });
    expect(w.state.audit.map((a) => a.action)).toEqual(["deferred_mode.reject", "deferred_mode.exit"]);
    expect(w.state.audit[1]).toMatchObject({ actorRole: "system" });
  });

  it("an Admin can still clear a check-triggered entry", async () => {
    const w = world(session({ deferredSince: T0, deferredReason: "x", deferredEnteredBy: "health_check" }));
    expect(await applyDeferredMode(w.deferredDeps, ADMIN, "sess-1", false, "")).toMatchObject({ ok: true, deferred: false });
  });

  it("a manual entry is never cleared by passing checks, and the check writes nothing", async () => {
    const w = world(session({ deferredSince: T0, deferredReason: "flat battery", deferredByStaffId: "staff_louis", deferredEnteredBy: "manual" }));
    for (let i = 0; i < 5; i++) expect(await w.tick()).toMatchObject({ read: "pass", action: "none" });
    expect(w.state.session).toMatchObject({ deferredSince: T0, deferredEnteredBy: "manual" });
    expect(w.state.audit).toEqual([]);
  });
});

describe("'three consecutive' restarts whenever deferred mode changes, by anyone", () => {
  it("a barista enters and leaves deferred mode between checks: the earlier failures no longer count", async () => {
    const w = world();
    w.device.answer = OFFLINE;
    await w.tick();
    await w.tick(); // 2 failures
    await applyDeferredMode(w.deferredDeps, LOUIS, "sess-1", true, "machine flat");
    await applyDeferredMode(w.deferredDeps, LOUIS, "sess-1", false, "");
    expect(await w.tick()).toMatchObject({ read: "fail", fails: 1, action: "none" });
    expect(w.state.session!.deferredSince).toBeNull();
  });

  it("an Admin clears a check-triggered entry after two passes: the passes no longer count", async () => {
    const w = world();
    w.device.answer = OFFLINE;
    for (let i = 0; i < 3; i++) await w.tick(); // entered by the check
    w.device.answer = { kind: "online", model: "Khumo", serialNumber: "S1" };
    await w.tick();
    await w.tick(); // 2 passes
    await applyDeferredMode(w.deferredDeps, ADMIN, "sess-1", false, "");
    w.device.answer = OFFLINE;
    expect(await w.tick()).toMatchObject({ fails: 1, passes: 0, action: "none" });
  });

  it("the check's own entry restarts the count: the exit needs three NEW passes", async () => {
    const w = world();
    w.device.answer = OFFLINE;
    for (let i = 0; i < 3; i++) await w.tick();
    w.device.answer = { kind: "online", model: "Khumo", serialNumber: "S1" };
    expect(await w.tick()).toMatchObject({ passes: 1, fails: 0, action: "none" });
    expect(await w.tick()).toMatchObject({ passes: 2, action: "none" });
    expect(await w.tick()).toMatchObject({ passes: 3, action: "exited" });
  });

  it("a manual entry while failures are counting: a later manual exit starts from zero", async () => {
    const w = world();
    w.device.answer = OFFLINE;
    await w.tick();
    await applyDeferredMode(w.deferredDeps, LOUIS, "sess-1", true, "machine flat");
    await w.tick(); // counted under the manual entry
    await applyDeferredMode(w.deferredDeps, LOUIS, "sess-1", false, "");
    expect(await w.tick()).toMatchObject({ fails: 1, action: "none" });
  });
});

describe("when the check does not run", () => {
  it("off unless the live Web POS port is selected — no lookup at all", async () => {
    const w = world(session(), { live: false });
    w.device.answer = OFFLINE;
    for (let i = 0; i < 4; i++) expect(await w.tick()).toEqual({ ran: false, why: "not_live" });
    expect(w.device.lookups).toBe(0);
    expect(w.state.session!.deferredSince).toBeNull();
  });

  it("no device configured", async () => {
    const w = world(session(), { deviceId: null });
    expect(await w.tick()).toEqual({ ran: false, why: "no_device" });
    expect(w.device.lookups).toBe(0);
  });

  it("a weekday session (nobody pays, S7a): no lookup, nothing written", async () => {
    const w = world(session({ sessionDate: "2026-11-09", mode: "weekday" }));
    w.device.answer = OFFLINE;
    for (let i = 0; i < 4; i++) expect(await w.tick()).toEqual({ ran: false, why: "no_payment_in_session" });
    expect(w.device.lookups).toBe(0);
    expect(w.state.audit).toEqual([]);
  });

  it("no open session", async () => {
    const w = world(session({ closedAt: T0 }));
    expect(await w.tick()).toEqual({ ran: false, why: "no_session" });
  });

  it("a second call inside 60 s (another tablet, or a spammed call) is not counted and does not look the device up", async () => {
    const w = world();
    w.device.answer = OFFLINE;
    await checkDeviceHealth(w.deps);
    expect(await checkDeviceHealth(w.deps)).toEqual({ ran: false, why: "too_soon" });
    expect(await checkDeviceHealth(w.deps)).toEqual({ ran: false, why: "too_soon" });
    expect(w.device.lookups).toBe(1);
    expect(w.state.session!.deferredSince).toBeNull();
  });
});

describe("it never touches a payment", () => {
  it("only lookupDevice is called on the port — no send, no fetch, no lookup by reference", async () => {
    const w = world();
    const fake = new FakeYocoWebPosPort({ device: OFFLINE });
    const spies = {
      send: vi.spyOn(fake, "sendPayment"),
      fetch: vi.spyOn(fake, "fetchPayment"),
      find: vi.spyOn(fake, "findPaymentsByClientReference"),
    };
    w.deps.port = fake;
    for (let i = 0; i < 3; i++) await w.tick();
    expect(w.state.session!.deferredEnteredBy).toBe("health_check");
    expect(spies.send).not.toHaveBeenCalled();
    expect(spies.fetch).not.toHaveBeenCalled();
    expect(spies.find).not.toHaveBeenCalled();
  });
});

describe("nextStreak (pure)", () => {
  it("a new session starts from zero", () => {
    const prev: DeviceStreak = { sessionId: "old", deferredChanges: 0, fails: 2, passes: 0, lastAt: T0 };
    expect(nextStreak(prev, { sessionId: "sess-1", deferredChanges: 0 }, "fail", T0))
      .toEqual({ sessionId: "sess-1", deferredChanges: 0, fails: 1, passes: 0, lastAt: T0 });
  });

  it("a change of deferred mode in the same session starts from zero", () => {
    const prev: DeviceStreak = { sessionId: "sess-1", deferredChanges: 1, fails: 2, passes: 0, lastAt: T0 };
    expect(nextStreak(prev, { sessionId: "sess-1", deferredChanges: 2 }, "fail", T0)).toMatchObject({ fails: 1 });
    expect(nextStreak(prev, { sessionId: "sess-1", deferredChanges: 1 }, "fail", T0)).toMatchObject({ fails: 3 });
  });
});

describe("§6.7: TERMINAL_UNREACHABLE offers deferred mode one tap away", () => {
  it("one tap: no typed reason; entered_by='manual' with the barista, audited with the fixed reason, Admin pushed", async () => {
    const w = world();
    const r = await enterDeferredAfterUnreachable(w.deferredDeps, LOUIS, "sess-1");
    expect(r).toEqual({ ok: true, changed: true, deferred: true, enteredBy: "manual" });
    expect(TERMINAL_UNREACHABLE_DEFERRED_REASON).toBe("Card machine unreachable");
    expect(w.state.session).toMatchObject({
      deferredByStaffId: "staff_louis", deferredEnteredBy: "manual", deferredReason: "Card machine unreachable",
    });
    expect(w.state.audit).toMatchObject([
      { action: "deferred_mode.enter", actorId: "staff_louis", actorRole: "barista", reason: "Card machine unreachable" },
    ]);
    expect(w.notifyEntered).toHaveBeenCalledTimes(1);
  });

  it("already deferred: unchanged, no second push", async () => {
    const w = world(session({ deferredSince: T0, deferredReason: "x", deferredEnteredBy: "health_check" }));
    expect(await enterDeferredAfterUnreachable(w.deferredDeps, LOUIS, "sess-1")).toMatchObject({ ok: true, changed: false });
    expect(w.notifyEntered).not.toHaveBeenCalled();
  });

  it("no open session → NO_SESSION, nothing written", async () => {
    const w = world();
    expect(await enterDeferredAfterUnreachable(w.deferredDeps, LOUIS, null)).toMatchObject({ ok: false, code: "NO_SESSION" });
    expect(w.state.audit).toEqual([]);
  });

  it("a weekday session refuses it (S7a), audited", async () => {
    const w = world(session({ sessionDate: "2026-11-09", mode: "weekday" }));
    expect(await enterDeferredAfterUnreachable(w.deferredDeps, LOUIS, "sess-1")).toMatchObject({ ok: false, code: "MODE_FORBIDDEN" });
    expect(w.state.audit).toMatchObject([{ action: "deferred_mode.reject" }]);
  });
});
