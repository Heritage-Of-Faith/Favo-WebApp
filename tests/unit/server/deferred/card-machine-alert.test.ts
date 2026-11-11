// REQ-068 / PRD v7.0 §9.6.3: the card machine unreachable during trading
// hours alerts the on-duty barista's own device and the Admin, with a named
// action, once per incident; §15.1: one alert plus one resolution notice.
// Rides the §6.7 60 s device check (no scheduler).

import { describe, expect, it, vi } from "vitest";
import type { WebPosDeviceResult, YocoWebPosPort } from "@/server/yoco/webpos-port";
import {
  checkDeviceHealth,
  DEVICE_CHECK_INTERVAL_MS,
  type DeviceCheckSession,
  type DeviceStreak,
  type HealthCheckDeps,
} from "@/server/deferred/health-check";
import {
  ALERT_AFTER_FAILED_CHECKS,
  CARD_MACHINE_ALERT_ACTION,
  CARD_MACHINE_ALERT_BODY,
  CARD_MACHINE_PUSH_TAG,
  CARD_MACHINE_RECOVERED_ACTION,
  CARD_MACHINE_RESOLVED_BODY,
  onDeviceRead,
  tillCardMachineLine,
  type BaristaDelivery,
  type CardMachineAlertDeps,
  type IncidentTrack,
  type StaffForPush,
} from "@/server/deferred/card-machine-alert";
import type { PushSubscriptionShape } from "@/server/push/payload";

const T0 = new Date("2026-11-08T07:10:00.000Z"); // Sunday 09:10 SAST
const sub = (who: string): PushSubscriptionShape => ({ endpoint: `https://push.example/${who}`, keys: { p256dh: "p", auth: "a" } });
const OFFLINE: WebPosDeviceResult = { kind: "device_error" };
const ONLINE: WebPosDeviceResult = { kind: "online", model: "Khumo", serialNumber: "S1" };

const LOUIS: StaffForPush = { staffId: "staff_louis", role: "barista", active: true, pushSubscription: sub("louis") };
const THANDEKA: StaffForPush = { staffId: "staff_thandeka", role: "barista", active: true, pushSubscription: sub("thandeka") };
const NO_SUB: StaffForPush = { staffId: "staff_nkuli", role: "barista", active: true, pushSubscription: null };
const ADMIN_MIA: StaffForPush = { staffId: "staff_admin_mia", role: "admin", active: true, pushSubscription: sub("mia") };
const GONE: StaffForPush = { staffId: "staff_gone", role: "barista", active: false, pushSubscription: sub("gone") };

type Row = {
  action: string; sessionId: string; incidentId: string; seq: number;
  recipientKinds?: string[]; rosteredStaffIds?: string[]; runnerStaffId?: string | null;
  baristaTargetedStaffIds: string[]; alertDelivery?: BaristaDelivery | null;
};

class SwitchableDevice implements Pick<YocoWebPosPort, "lookupDevice"> {
  answer: WebPosDeviceResult | "throw" = ONLINE;
  async lookupDevice(): Promise<WebPosDeviceResult> {
    if (this.answer === "throw") throw new Error("network");
    return this.answer;
  }
}

type WorldOpts = {
  takesPayment?: boolean;
  rostered?: StaffForPush[];
  runner?: StaffForPush | null;
  pushBarista?: CardMachineAlertDeps["pushBarista"];
  pushAdmins?: CardMachineAlertDeps["pushAdmins"];
};

function world(opts: WorldOpts = {}) {
  let now = T0;
  // The audit log is the durable part: it survives a "restart" (a fresh track).
  const audit: Row[] = [];
  let track: IncidentTrack | null = null;
  let streak: DeviceStreak | null = null;
  let ids = 0;
  let session: DeviceCheckSession | null = { sessionId: "sess-1", takesPayment: opts.takesPayment ?? true, deferred: false, enteredBy: null, deferredChanges: 0 };
  const rostered = opts.rostered ?? [];
  const runner = opts.runner === undefined ? null : opts.runner;
  const directory = new Map([...rostered, ...(runner ? [runner] : []), LOUIS, THANDEKA, NO_SUB, ADMIN_MIA, GONE].map((s) => [s.staffId, s]));
  const pushBarista = vi.fn(opts.pushBarista ?? (async () => "sent" as const));
  const pushAdmins = vi.fn(opts.pushAdmins ?? (async () => {}));
  const sent: Promise<unknown>[] = [];
  // The session row lock: one claim/close at a time, as SELECT … FOR UPDATE gives.
  let lock: Promise<unknown> = Promise.resolve();
  const locked = <T>(fn: () => T): Promise<Awaited<T>> => {
    const run = lock.then(async () => { await Promise.resolve(); return fn(); });
    lock = run.catch(() => {});
    return run as Promise<Awaited<T>>;
  };
  const latest = (sessionId: string) => [...audit].filter((a) => a.sessionId === sessionId).sort((a, b) => b.seq - a.seq)[0];
  const claimFailures = { left: 0 };
  const alertDeps: CardMachineAlertDeps = {
    track: { get: () => track, set: (t) => { track = t; } },
    newIncidentId: () => `inc-${++ids}`,
    store: {
      readOnDutyBaristas: async (sessionId) => (session && sessionId === session.sessionId ? rostered.filter((s) => s.active) : []),
      readStaff: async (staffIds) => staffIds.map((id) => directory.get(id)).filter((s): s is StaffForPush => !!s),
      claimAlert: (row) => locked(() => {
        if (claimFailures.left > 0) { claimFailures.left -= 1; throw new Error("db down"); }
        const last = latest(row.sessionId);
        if (last?.action === CARD_MACHINE_ALERT_ACTION) return { claimed: false, incidentId: last.incidentId };
        audit.push({ ...row, action: CARD_MACHINE_ALERT_ACTION, seq: (last?.seq ?? 0) + 1 });
        return { claimed: true, incidentId: row.incidentId };
      }),
      closeIncident: (sessionId, _at, alertDelivery) => locked(() => {
        const last = latest(sessionId);
        if (last?.action !== CARD_MACHINE_ALERT_ACTION) return null;
        audit.push({ action: CARD_MACHINE_RECOVERED_ACTION, sessionId, incidentId: last.incidentId, seq: last.seq + 1, baristaTargetedStaffIds: last.baristaTargetedStaffIds, alertDelivery });
        return { incidentId: last.incidentId, baristaTargetedStaffIds: last.baristaTargetedStaffIds };
      }),
    },
    pushBarista,
    pushAdmins,
    dispatch: (p) => { sent.push(p); },
  };
  const device = new SwitchableDevice();
  let checkedSessionId: string | null = null;
  const deps: HealthCheckDeps = {
    now: () => now,
    live: true,
    readDeviceId: async () => "dev-khumo-1",
    port: device,
    readOpenSession: async () => session,
    streak: { get: () => streak, set: (s) => { streak = s; } },
    setDeferred: async () => ({ ok: true, deferred: true, changed: true }) as never,
    onDeviceRead: (sessionId, read, at) => {
      checkedSessionId = sessionId;
      return onDeviceRead(alertDeps, { sessionId, read, at, runnerStaffId: runner?.staffId ?? null });
    },
  };
  async function settle() { while (sent.length) await Promise.allSettled(sent.splice(0)); }
  return {
    audit, device, deps, pushBarista, pushAdmins, claimFailures,
    alerts: () => audit.filter((a) => a.action === CARD_MACHINE_ALERT_ACTION),
    recoveries: () => audit.filter((a) => a.action === CARD_MACHINE_RECOVERED_ACTION),
    bodies: (fn: typeof pushBarista) => fn.mock.calls.map((c) => JSON.parse(c[1] as string).body as string),
    setSession(s: DeviceCheckSession | null) { session = s; },
    restart() { track = null; streak = null; },
    /** The till's on-screen line after the last check. */
    line: (out: Awaited<ReturnType<typeof checkDeviceHealth>>) => tillCardMachineLine(out, track, checkedSessionId),
    async tick() {
      checkedSessionId = null;
      const r = await checkDeviceHealth(deps);
      await settle();
      now = new Date(now.getTime() + DEVICE_CHECK_INTERVAL_MS);
      return r;
    },
    /** Two tills checking at the same instant. */
    async concurrentTicks() {
      const r = await Promise.all([checkDeviceHealth(deps), checkDeviceHealth(deps)]);
      await settle();
      now = new Date(now.getTime() + DEVICE_CHECK_INTERVAL_MS);
      return r;
    },
  };
}

describe("REQ-068: the numbers and the words", () => {
  it("the 2nd consecutive 60 s failure is the threshold", () => {
    expect(ALERT_AFTER_FAILED_CHECKS).toBe(2);
    expect(DEVICE_CHECK_INTERVAL_MS).toBe(60_000);
  });
  it("names §9.6.3's action, verbatim", () => {
    expect(CARD_MACHINE_ALERT_BODY).toBe(
      "FAVO can't reach the card machine. Check it's on and on the wifi, or switch the till to deferred."
    );
  });
});

describe("REQ-068: the 2-minute boundary", () => {
  it("one failed check alerts nobody; the second consecutive one alerts the rostered barista and the Admin", async () => {
    const w = world({ rostered: [LOUIS] });
    w.device.answer = OFFLINE;
    const first = await w.tick();
    expect(w.pushBarista).not.toHaveBeenCalled();
    expect(w.pushAdmins).not.toHaveBeenCalled();
    expect(w.alerts()).toHaveLength(0);
    expect(w.line(first)).toBe(false);

    const second = await w.tick();
    expect(w.line(second)).toBe(true);
    expect(w.pushBarista).toHaveBeenCalledTimes(1);
    expect(w.pushBarista.mock.calls[0][0]).toEqual(LOUIS.pushSubscription);
    expect(JSON.parse(w.pushBarista.mock.calls[0][1] as string)).toMatchObject({ body: CARD_MACHINE_ALERT_BODY, tag: CARD_MACHINE_PUSH_TAG });
    expect(w.pushAdmins).toHaveBeenCalledTimes(1);
    expect(w.pushAdmins.mock.calls[0][1]).toBe(CARD_MACHINE_ALERT_BODY);
    expect(w.pushAdmins.mock.calls[0][3]).toBe(CARD_MACHINE_PUSH_TAG);
    expect(w.alerts()).toEqual([
      expect.objectContaining({
        sessionId: "sess-1", incidentId: "inc-1", recipientKinds: ["barista", "admin"],
        rosteredStaffIds: ["staff_louis"], runnerStaffId: null, baristaTargetedStaffIds: ["staff_louis"], firstFailAt: T0,
      }),
    ]);
  });

  it("an inconclusive read (Yoco could not be asked) neither counts towards nor ends an incident", async () => {
    const w = world({ rostered: [LOUIS] });
    w.device.answer = OFFLINE; await w.tick();
    w.device.answer = "throw"; await w.tick();
    expect(w.alerts()).toHaveLength(0);
    w.device.answer = OFFLINE; await w.tick();
    expect(w.alerts()).toHaveLength(1);
  });

  it("a pass between two failures restarts the count", async () => {
    const w = world({ rostered: [LOUIS] });
    w.device.answer = OFFLINE; await w.tick();
    w.device.answer = ONLINE; await w.tick();
    w.device.answer = OFFLINE; await w.tick();
    expect(w.alerts()).toHaveLength(0);
  });
});

describe("REQ-068: one alert per incident, not one per minute (§15.1 drill shape)", () => {
  it("an hour off the wifi, then back: one alert plus one resolution notice, not sixty", async () => {
    const w = world({ rostered: [LOUIS] });
    w.device.answer = OFFLINE;
    for (let i = 0; i < 60; i++) await w.tick();
    w.device.answer = ONLINE;
    for (let i = 0; i < 3; i++) await w.tick();
    expect(w.alerts()).toHaveLength(1);
    expect(w.recoveries()).toHaveLength(1);
    expect(w.bodies(w.pushBarista)).toEqual([CARD_MACHINE_ALERT_BODY, CARD_MACHINE_RESOLVED_BODY]);
    expect(w.pushAdmins.mock.calls.map((c) => c[1])).toEqual([CARD_MACHINE_ALERT_BODY, CARD_MACHINE_RESOLVED_BODY]);
  });

  it("the resolution goes once, to the alert's recipients, with the same tag, and carries the alert's delivery outcome", async () => {
    const w = world({ rostered: [LOUIS], pushBarista: async () => "failed" });
    w.device.answer = OFFLINE; await w.tick(); await w.tick();
    w.device.answer = ONLINE;
    const back = await w.tick();
    expect(w.line(back)).toBe(false);
    await w.tick();
    expect(w.recoveries()).toEqual([expect.objectContaining({ incidentId: "inc-1", alertDelivery: { staff_louis: "failed" } })]);
    expect(w.pushBarista).toHaveBeenCalledTimes(2);
    expect(JSON.parse(w.pushBarista.mock.calls[1][1] as string)).toMatchObject({ body: CARD_MACHINE_RESOLVED_BODY, tag: CARD_MACHINE_PUSH_TAG });
    expect(w.pushAdmins.mock.calls[1][3]).toBe(CARD_MACHINE_PUSH_TAG);
  });

  it("a passing check ends the incident; the next failure run is a new incident with a new alert", async () => {
    const w = world({ rostered: [LOUIS] });
    w.device.answer = OFFLINE; await w.tick(); await w.tick(); await w.tick();
    w.device.answer = ONLINE; await w.tick();
    expect(w.audit.map((a) => a.action)).toEqual([CARD_MACHINE_ALERT_ACTION, CARD_MACHINE_RECOVERED_ACTION]);
    w.device.answer = OFFLINE; await w.tick(); await w.tick();
    expect(w.alerts().map((a) => a.incidentId)).toEqual(["inc-1", "inc-2"]);
    expect(w.audit.map((a) => a.seq)).toEqual([1, 2, 3]);
  });

  it("a server restart mid-incident does not alert again (the open incident is in the audit log)", async () => {
    const w = world({ rostered: [LOUIS] });
    w.device.answer = OFFLINE; await w.tick(); await w.tick();
    w.restart();
    await w.tick();
    const relearnt = await w.tick();
    await w.tick();
    expect(w.line(relearnt)).toBe(true);
    expect(w.alerts()).toHaveLength(1);
    expect(w.pushAdmins).toHaveBeenCalledTimes(1);
    // A pass after the restart still closes it, once; the delivery is unknown to this process.
    w.device.answer = ONLINE; await w.tick(); await w.tick();
    expect(w.recoveries()).toEqual([expect.objectContaining({ incidentId: "inc-1", alertDelivery: null })]);
  });

  it("two tills checking at the same instant: one alert", async () => {
    const w = world({ rostered: [LOUIS] });
    w.device.answer = OFFLINE;
    await w.tick();
    await w.concurrentTicks();
    await w.concurrentTicks();
    expect(w.alerts()).toHaveLength(1);
    expect(w.pushBarista).toHaveBeenCalledTimes(1);
    expect(w.pushAdmins).toHaveBeenCalledTimes(1);
  });
});

describe("REQ-068: incidents are per open session", () => {
  it("a session change mid-incident starts the count again under the new session", async () => {
    const w = world({ rostered: [LOUIS] });
    w.device.answer = OFFLINE; await w.tick();
    w.setSession({ sessionId: "sess-2", takesPayment: true, deferred: false, enteredBy: null, deferredChanges: 0 });
    await w.tick();
    expect(w.alerts()).toHaveLength(0);
    await w.tick();
    expect(w.alerts()).toEqual([expect.objectContaining({ sessionId: "sess-2", incidentId: "inc-2" })]);
  });

  it("closing the till while alerted: no resolution is guessed, the line goes, and the next session starts clean", async () => {
    const w = world({ rostered: [LOUIS] });
    w.device.answer = OFFLINE; await w.tick(); await w.tick();
    w.setSession(null);
    const closed = await w.tick();
    expect(closed).toEqual({ ran: false, why: "no_session" });
    expect(w.line(closed)).toBe(false);
    expect(w.recoveries()).toHaveLength(0);
    expect(w.pushAdmins).toHaveBeenCalledTimes(1);

    w.setSession({ sessionId: "sess-2", takesPayment: true, deferred: false, enteredBy: null, deferredChanges: 0 });
    await w.tick();
    expect(w.alerts()).toHaveLength(1);
    await w.tick();
    expect(w.alerts().map((a) => [a.sessionId, a.incidentId])).toEqual([["sess-1", "inc-1"], ["sess-2", "inc-2"]]);
  });
});

describe("REQ-068: who is alerted", () => {
  it("nobody rostered and no barista running the check: the Admin only, no barista guessed", async () => {
    const w = world({ rostered: [] });
    w.device.answer = OFFLINE; await w.tick(); await w.tick();
    expect(w.pushBarista).not.toHaveBeenCalled();
    expect(w.pushAdmins).toHaveBeenCalledTimes(1);
    expect(w.alerts()[0]).toMatchObject({ recipientKinds: ["admin"], rosteredStaffIds: [], baristaTargetedStaffIds: [] });
  });

  it("nobody rostered: the logged-in barista whose till ran the check is alerted", async () => {
    const w = world({ rostered: [], runner: THANDEKA });
    w.device.answer = OFFLINE; await w.tick(); await w.tick();
    expect(w.pushBarista.mock.calls.map((c) => c[0])).toEqual([THANDEKA.pushSubscription]);
    expect(w.alerts()[0]).toMatchObject({ recipientKinds: ["barista", "admin"], runnerStaffId: "staff_thandeka", baristaTargetedStaffIds: ["staff_thandeka"] });
  });

  it("the union of rostered and logged-in, each once; Admins and inactive staff are left to their own leg", async () => {
    const w = world({ rostered: [LOUIS, ADMIN_MIA, GONE, THANDEKA], runner: LOUIS });
    w.device.answer = OFFLINE; await w.tick(); await w.tick();
    expect(w.pushBarista.mock.calls.map((c) => c[0])).toEqual([LOUIS.pushSubscription, THANDEKA.pushSubscription]);
    expect(w.pushAdmins).toHaveBeenCalledTimes(1);
    expect(w.alerts()[0].baristaTargetedStaffIds).toEqual(["staff_louis", "staff_thandeka"]);
  });

  it("an Admin running the check gets the Admin push only, not a second barista push", async () => {
    const w = world({ rostered: [], runner: ADMIN_MIA });
    w.device.answer = OFFLINE; await w.tick(); await w.tick();
    expect(w.pushBarista).not.toHaveBeenCalled();
    expect(w.pushAdmins).toHaveBeenCalledTimes(1);
  });

  it("a rostered barista with no saved subscription is recorded but not pushed; the till's line still shows", async () => {
    const w = world({ rostered: [NO_SUB], runner: NO_SUB });
    w.device.answer = OFFLINE; await w.tick();
    const second = await w.tick();
    expect(w.pushBarista).not.toHaveBeenCalled();
    expect(w.line(second)).toBe(true);
    expect(w.alerts()[0]).toMatchObject({ recipientKinds: ["admin"], rosteredStaffIds: ["staff_nkuli"], baristaTargetedStaffIds: [] });
  });
});

describe("REQ-068: trading hours only", () => {
  it("a free weekday session (nobody pays) never alerts and shows no line", async () => {
    const w = world({ takesPayment: false, rostered: [LOUIS] });
    w.device.answer = OFFLINE;
    for (let i = 0; i < 5; i++) {
      const r = await w.tick();
      expect(r).toEqual({ ran: false, why: "no_payment_in_session" });
      expect(w.line(r)).toBe(false);
    }
    expect(w.alerts()).toHaveLength(0);
    expect(w.pushBarista).not.toHaveBeenCalled();
    expect(w.pushAdmins).not.toHaveBeenCalled();
  });

  it("a check too soon after the last leaves the till's line as it was (null)", () => {
    expect(tillCardMachineLine({ ran: false, why: "too_soon" }, null, null)).toBeNull();
  });
});

describe("REQ-068: an alert that fails never breaks the device check", () => {
  it("both pushes throwing: the check still reports its read, and deferred mode still enters on the third failure", async () => {
    const w = world({
      rostered: [LOUIS],
      pushBarista: async () => { throw new Error("push down"); },
      pushAdmins: async () => { throw new Error("push down"); },
    });
    w.device.answer = OFFLINE;
    await w.tick();
    expect(await w.tick()).toMatchObject({ ran: true, read: "fail", fails: 2 });
    expect(await w.tick()).toMatchObject({ ran: true, read: "fail", fails: 3, action: "entered" });
    expect(w.alerts()).toHaveLength(1);
  });

  it("the claim throwing once: the check completes, and the next failure alerts with the same incident id", async () => {
    const w = world({ rostered: [LOUIS] });
    w.claimFailures.left = 1;
    w.device.answer = OFFLINE;
    await w.tick();
    expect(await w.tick()).toMatchObject({ ran: true, read: "fail", fails: 2 });
    expect(w.alerts()).toHaveLength(0);
    expect(w.pushAdmins).not.toHaveBeenCalled();
    await w.tick();
    expect(w.alerts()).toEqual([expect.objectContaining({ incidentId: "inc-1" })]);
    expect(w.pushAdmins).toHaveBeenCalledTimes(1);
  });

  it("the whole alert step throwing: the check still completes", async () => {
    const w = world({ rostered: [LOUIS] });
    w.deps.onDeviceRead = async () => { throw new Error("db down"); };
    w.device.answer = OFFLINE;
    await w.tick();
    expect(await w.tick()).toMatchObject({ ran: true, read: "fail", fails: 2 });
  });
});
