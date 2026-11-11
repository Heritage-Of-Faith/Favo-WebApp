// §9.6.2 job 4 — unconfirmed-payment reconciliation, with DEC-27 (owner
// decision, Mia, 10 Nov 2026): it acts only on days we take payment (Sundays,
// and events with a standard or override posture) and on payments carried
// over from such a day until they are resolved; on every other day it does
// nothing and writes nothing.
// The tender chain runs for real on the in-memory store and FakeYocoWebPosPort;
// never live Yoco, never a database. Every instant is fixed.

import { describe, it, expect, vi } from "vitest";
import { FakeYocoWebPosPort, type FakeFetchStep, type FakeSendScript } from "@/server/yoco/webpos-fake";
import { beginTender, isAttemptOpen, recordTenderResult, sendToTerminal } from "@/server/tender/tender";
import { unlinkedWebPosPort } from "@/server/tender/unlinked-port";
import type { TenderActor, TenderDeps } from "@/server/tender/types";
import { Scheduler, type JobDefinition, type JobStore, type RunRecord } from "@/server/jobs/scheduler";
import { sastMinute } from "@/server/jobs/schedule";
import {
  isPaidDay,
  reconcileUnconfirmedPayments,
  shouldRunUnconfirmedPayments,
  PAYING_POSTURES,
  PAYMENT_AGED_ALERT_ACTION,
  type OpenPayment,
  type UnconfirmedPaymentsDeps,
} from "@/server/crons/unconfirmed-payments";
import { MemoryTenderStore } from "./tender/memory-store";

const BARISTA: TenderActor = { kind: "staff", staffId: "staff_louis", role: "barista" };
const MIN = 60_000;
const at = (iso: string) => new Date(iso);
// Sunday 8 Nov 2026, 09:00 SAST.
const SUNDAY_0900 = at("2026-11-08T07:00:00.000Z");
// Tuesday 10 Nov 2026, 09:00 SAST.
const TUESDAY_0900 = at("2026-11-10T07:00:00.000Z");
// Saturday 14 Nov 2026, 19:00 SAST.
const SATURDAY_1900 = at("2026-11-14T17:00:00.000Z");

const quiet = { info: () => {}, warn: () => {}, error: () => {} };

type Attempt = "unresolved_sent" | "begun_unsent" | "closed_out_unsent" | "none";

/**
 * One R30.00 card order. Its attempt is begun at `startedAt` and, by default,
 * sent and taken to `unresolved` by the 180 s ceiling (S4).
 */
async function world(opts: { attempt?: Attempt; startedAt?: Date; fetches?: FakeFetchStep[]; payingEvent?: boolean } = {}) {
  const kind = opts.attempt ?? "unresolved_sent";
  const store = new MemoryTenderStore([{ id: "ord-1", state: "ordered", totalZar: 3000, clientUuid: "cu-1" }]);
  const sends: FakeSendScript[] =
    kind === "closed_out_unsent"
      ? [{ outcome: "gateway_unavailable", httpStatus: 400 }]
      : [{ outcome: "sent", yocoPaymentId: "yp-1", fetches: opts.fetches }];
  const port = new FakeYocoWebPosPort({ sends });
  let now = opts.startedAt ?? SUNDAY_0900;
  const notify = { paymentUnresolved: vi.fn(async () => {}), duplicateCharge: vi.fn(async () => {}) };
  const tender: TenderDeps = { store, port, now: () => now, readDeviceId: async () => "dev-khumo-1", notify };

  if (kind !== "none") expect((await beginTender(tender, BARISTA, "ord-1")).ok).toBe(true);
  if (kind === "unresolved_sent") {
    expect((await sendToTerminal(tender, BARISTA, "ord-1", 1)).ok).toBe(true);
    await recordTenderResult(tender, BARISTA, "ord-1", 1, { kind: "unresolved", cause: "ceiling" });
    expect(store.paymentsOf("ord-1")[0].status).toBe("unresolved");
  }
  if (kind === "closed_out_unsent") {
    await sendToTerminal(tender, BARISTA, "ord-1", 1);
    const p = store.paymentsOf("ord-1")[0];
    expect([p.status, p.sentAt, p.yocoPaymentId]).toEqual(["unresolved", null, null]);
  }
  const fetchesBefore = port.fetches.length;

  // Every pending/unresolved row; the job applies isAttemptOpen itself.
  const rows = (): OpenPayment[] =>
    store.state.payments
      .filter((p) => p.status === "pending" || p.status === "unresolved")
      .map((p) => ({
        id: p.id, orderId: p.orderId, fundTopupId: null, attempt: p.attempt, amountZar: p.amountZar,
        status: p.status, sentAt: p.sentAt, yocoPaymentId: p.yocoPaymentId, at: p.at,
      }));
  const alertRows: { paymentId: string }[] = [];
  const deps = {
    now: () => now,
    hasOpenPayment: vi.fn(async () => rows().some(isAttemptOpen)),
    hasPayingEventSession: vi.fn(async () => opts.payingEvent ?? false),
    orderDeps: vi.fn(() => tender),
    topupDeps: vi.fn((): TenderDeps => { throw new Error("no top-ups in this world"); }),
    listOpenPayments: vi.fn(async () => rows()),
    alreadyAlerted: vi.fn(async (id: string) => alertRows.some((r) => r.paymentId === id)),
    recordAlerted: vi.fn(async (p: OpenPayment) => { alertRows.push({ paymentId: p.id }); }),
    push: vi.fn(async () => {}),
  } satisfies UnconfirmedPaymentsDeps;

  return {
    store, port, tender, deps, alertRows,
    setNow(t: Date) { now = t; },
    fetchesSinceSetup: () => port.fetches.length - fetchesBefore,
  };
}

/** The registry's job 4, composed the same way, with injected deps. */
function job4(deps: UnconfirmedPaymentsDeps): JobDefinition {
  return {
    name: "unconfirmedPayments",
    cron: "*/15 * * * *",
    missedRun: "skip",
    periodFor: sastMinute,
    runsAt: (firedAt) => shouldRunUnconfirmedPayments(firedAt, deps),
    run: () => reconcileUnconfirmedPayments(deps),
  };
}

function scheduler(deps: UnconfirmedPaymentsDeps) {
  const runs: RunRecord[] = [];
  const store: JobStore = {
    hasRun: async () => false,
    firstStartedAt: async () => null,
    recordStart: async () => {},
    recordRun: async (r) => { runs.push(r); },
  };
  const alert = vi.fn(async () => {});
  const j = job4(deps);
  const s = new Scheduler([j], { store, alert, log: quiet });
  return { s, j, runs, alert };
}

describe("job 4 — the DEC-27 gate", () => {
  it("a weekday Tuesday with no open payments: no-op — no lookup, no push, no audit row, no run row", async () => {
    const w = await world({ attempt: "none" });
    w.setNow(TUESDAY_0900);
    const { s, runs, alert } = scheduler(w.deps);
    await s.tick(TUESDAY_0900);

    expect(w.deps.hasOpenPayment).toHaveBeenCalledTimes(1);
    expect(w.deps.hasPayingEventSession).toHaveBeenCalledTimes(1);
    expect(w.deps.hasPayingEventSession).toHaveBeenCalledWith("2026-11-10");
    expect(w.deps.listOpenPayments).not.toHaveBeenCalled();
    expect(w.deps.orderDeps).not.toHaveBeenCalled();
    expect(w.deps.alreadyAlerted).not.toHaveBeenCalled();
    expect(w.deps.recordAlerted).not.toHaveBeenCalled();
    expect(w.deps.push).not.toHaveBeenCalled();
    expect(w.fetchesSinceSetup()).toBe(0);
    expect(runs).toHaveLength(0);
    expect(alert).not.toHaveBeenCalled();
  });

  it("an open payment is checked first: when one exists the day is not even asked", async () => {
    const w = await world();
    expect(await shouldRunUnconfirmedPayments(TUESDAY_0900, w.deps)).toBe(true);
    expect(w.deps.hasPayingEventSession).not.toHaveBeenCalled();
  });

  it("a Sunday is a paid day by its date alone — no query", async () => {
    const deps = { hasPayingEventSession: vi.fn(async () => false) };
    expect(await isPaidDay(SUNDAY_0900, deps)).toBe(true);
    expect(deps.hasPayingEventSession).not.toHaveBeenCalled();
  });

  it("midnight boundary, no open payments: Sunday 23:59 SAST runs, Monday 00:05 SAST does not", async () => {
    const w = await world({ attempt: "none" });
    expect(await shouldRunUnconfirmedPayments(at("2026-11-08T21:59:00Z"), w.deps)).toBe(true);
    expect(w.deps.hasPayingEventSession).not.toHaveBeenCalled();
    expect(await shouldRunUnconfirmedPayments(at("2026-11-08T22:05:00Z"), w.deps)).toBe(false);
    expect(w.deps.hasPayingEventSession).toHaveBeenCalledWith("2026-11-09");
  });

  it("a Saturday with a paid event session runs", async () => {
    const w = await world({ attempt: "none", payingEvent: true });
    w.setNow(SATURDAY_1900);
    const { s, runs } = scheduler(w.deps);
    await s.tick(SATURDAY_1900);
    expect(w.deps.hasPayingEventSession).toHaveBeenCalledWith("2026-11-14");
    expect(w.deps.listOpenPayments).toHaveBeenCalledTimes(1);
    expect(runs).toEqual([expect.objectContaining({ job: "unconfirmedPayments", action: "job_run" })]);
  });

  it("a Saturday whose only event is free-posture, with no open payments, is a no-op", async () => {
    const w = await world({ attempt: "none", payingEvent: false });
    w.setNow(SATURDAY_1900);
    const { s, runs } = scheduler(w.deps);
    await s.tick(SATURDAY_1900);
    expect(w.deps.hasPayingEventSession).toHaveBeenCalledWith("2026-11-14");
    expect(w.deps.listOpenPayments).not.toHaveBeenCalled();
    expect(w.deps.push).not.toHaveBeenCalled();
    expect(runs).toHaveLength(0);
  });

  it("paying postures are standard and override — never free (§6.6)", () => {
    expect([...PAYING_POSTURES]).toEqual(["standard", "override"]);
  });
});

describe("job 4 — payments carried over from a paid day (DEC-27)", () => {
  it("Thursday after a Wednesday 23:40 paid-event payment: looked up; one push once it is 30 minutes old", async () => {
    // Sent Wed 11 Nov 23:40 SAST; Thursday 12 Nov is not a paid day.
    const w = await world({ startedAt: at("2026-11-11T21:40:00Z") });
    const { s, j, runs } = scheduler(w.deps);

    w.setNow(at("2026-11-11T22:00:00Z")); // Thu 00:00 SAST, 20 min old
    await s.runJob(j, at("2026-11-11T22:00:00Z"));
    expect(w.fetchesSinceSetup()).toBeGreaterThan(0);
    expect(w.deps.push).not.toHaveBeenCalled();

    w.setNow(at("2026-11-11T22:20:00Z")); // Thu 00:20 SAST, 40 min old
    await s.runJob(j, at("2026-11-11T22:20:00Z"));
    expect(w.deps.push).toHaveBeenCalledTimes(1);

    w.setNow(at("2026-11-11T22:35:00Z")); // Thu 00:35 SAST
    await s.runJob(j, at("2026-11-11T22:35:00Z"));
    expect(w.deps.push).toHaveBeenCalledTimes(1);

    expect(w.deps.hasPayingEventSession).not.toHaveBeenCalled();
    expect(runs.map((r) => r.action)).toEqual(["job_run", "job_run", "job_run"]);
  });

  it("Monday 00:10 with a Sunday 23:50 unresolved payment: the lookup runs", async () => {
    const w = await world({ startedAt: at("2026-11-08T21:50:00Z") }); // Sun 23:50 SAST
    w.setNow(at("2026-11-08T22:10:00Z")); // Mon 00:10 SAST
    const { s, j, runs } = scheduler(w.deps);
    await s.runJob(j, at("2026-11-08T22:10:00Z"));
    expect(w.fetchesSinceSetup()).toBeGreaterThan(0);
    expect(runs).toEqual([expect.objectContaining({ action: "job_run", result: { due: 1, lookedUp: 1, alerted: 0 } })]);
  });
});

describe("job 4 — lookup and the 30-minute Admin push (§9.6.2, S4)", () => {
  it("Sunday, unresolved for 29 minutes: looked up, no push", async () => {
    const w = await world();
    w.setNow(new Date(SUNDAY_0900.getTime() + 29 * MIN));
    expect(await reconcileUnconfirmedPayments(w.deps)).toEqual({ due: 1, lookedUp: 1, alerted: 0 });
    expect(w.fetchesSinceSetup()).toBeGreaterThan(0);
    expect(w.deps.push).not.toHaveBeenCalled();
    expect(w.store.paymentsOf("ord-1")[0].status).toBe("unresolved");
  });

  it("Sunday, 31 minutes: one push; the next run (46 minutes) pushes nothing more", async () => {
    const w = await world();
    w.setNow(new Date(SUNDAY_0900.getTime() + 31 * MIN));
    expect(await reconcileUnconfirmedPayments(w.deps)).toEqual({ due: 1, lookedUp: 1, alerted: 1 });
    expect(w.deps.push).toHaveBeenCalledTimes(1);
    const [title, body, data] = w.deps.push.mock.calls[0] as unknown as [string, string, Record<string, unknown>];
    expect(title).toContain("order ord-1");
    expect(body).toMatch(/^R\s?30,00 · attempt 1 · 31 min old\./);
    expect(data).toMatchObject({ orderId: "ord-1", attempt: 1, amountZar: 3000 });
    expect(w.alertRows).toEqual([{ paymentId: w.store.paymentsOf("ord-1")[0].id }]);

    w.setNow(new Date(SUNDAY_0900.getTime() + 46 * MIN));
    expect(await reconcileUnconfirmedPayments(w.deps)).toEqual({ due: 1, lookedUp: 1, alerted: 0 });
    expect(w.deps.push).toHaveBeenCalledTimes(1);
  });

  it("the dedupe action name is the audit row the job checks", () => {
    expect(PAYMENT_AGED_ALERT_ACTION).toBe("payment.unresolved_30min_alert");
  });

  it("Sunday, Yoco reports the payment successful: attached through resolveTenderByLookup, no push, nothing sent", async () => {
    const w = await world({ fetches: [{ status: "successful", chargedAmountZar: 3000 }] });
    w.setNow(new Date(SUNDAY_0900.getTime() + 31 * MIN));
    const sendsBefore = w.port.sends.length;
    expect(await reconcileUnconfirmedPayments(w.deps)).toEqual({ due: 1, lookedUp: 1, alerted: 0 });
    const p = w.store.paymentsOf("ord-1")[0];
    expect(p.status).toBe("successful");
    expect(p.chargedAmountZar).toBe(3000);
    expect(w.store.state.statusWrites.at(-1)).toEqual({ id: p.id, status: "successful" });
    expect(w.store.state.audit.filter((a) => a.action === "payment.successful")).toEqual([
      expect.objectContaining({ actorRole: "system", after: expect.objectContaining({ via: "lookup" }) }),
    ]);
    expect(w.port.sends.length).toBe(sendsBefore); // never sends
    expect(w.deps.push).not.toHaveBeenCalled();
  });

  it("the unlinked port (DEC-21): lookups skipped, but the 31-minute payment is still pushed once", async () => {
    const w = await world();
    w.setNow(new Date(SUNDAY_0900.getTime() + 31 * MIN));
    w.deps.orderDeps.mockReturnValue({ ...w.tender, port: unlinkedWebPosPort });
    expect(await reconcileUnconfirmedPayments(w.deps)).toEqual({
      due: 1, lookedUp: 0, alerted: 1, lookupsSkipped: "no_device_linked",
    });
    expect(w.fetchesSinceSetup()).toBe(0);
    expect(w.deps.push).toHaveBeenCalledTimes(1);
    w.setNow(new Date(SUNDAY_0900.getTime() + 46 * MIN));
    await reconcileUnconfirmedPayments(w.deps);
    expect(w.deps.push).toHaveBeenCalledTimes(1);
  });

  it("a pending attempt begun but never sent is open (isAttemptOpen): aged and pushed once, never looked up", async () => {
    const w = await world({ attempt: "begun_unsent" });
    w.setNow(new Date(SUNDAY_0900.getTime() + 31 * MIN));
    expect(await reconcileUnconfirmedPayments(w.deps)).toEqual({ due: 1, lookedUp: 0, alerted: 1 });
    expect(w.fetchesSinceSetup()).toBe(0);
    expect(w.port.lookups).toEqual([]);
  });

  it("an unresolved attempt closed out never-sent is not open: not aged, not pushed", async () => {
    const w = await world({ attempt: "closed_out_unsent" });
    w.setNow(new Date(SUNDAY_0900.getTime() + 31 * MIN));
    expect(await reconcileUnconfirmedPayments(w.deps)).toEqual({ due: 0, lookedUp: 0, alerted: 0 });
    expect(w.deps.push).not.toHaveBeenCalled();
  });

  it("a TenderFailure from resolveTenderByLookup is a lookup error: the run fails and the scheduler alerts once", async () => {
    const w = await world();
    w.setNow(new Date(SUNDAY_0900.getTime() + 15 * MIN));
    const real = w.deps.listOpenPayments.getMockImplementation()!;
    w.deps.listOpenPayments.mockImplementation(async () => (await real()).map((p) => ({ ...p, orderId: "ord-gone" })));
    await expect(reconcileUnconfirmedPayments(w.deps)).rejects.toThrow(/order ord-gone: VALIDATION/);

    const { s, j, runs, alert } = scheduler(w.deps);
    await s.runJob(j, at("2026-11-08T07:15:00Z"));
    expect(runs).toEqual([expect.objectContaining({ action: "job_failed" })]);
    expect(alert).toHaveBeenCalledTimes(1);
  });

  it("nothing open: no lookup, no push", async () => {
    const w = await world({ fetches: [{ status: "successful", chargedAmountZar: 3000 }] });
    w.setNow(new Date(SUNDAY_0900.getTime() + 31 * MIN));
    await reconcileUnconfirmedPayments(w.deps); // attaches it
    const fetches = w.fetchesSinceSetup();
    expect(await reconcileUnconfirmedPayments(w.deps)).toEqual({ due: 0, lookedUp: 0, alerted: 0 });
    expect(w.fetchesSinceSetup()).toBe(fetches);
    expect(w.deps.push).not.toHaveBeenCalled();
  });
});

describe("job 4 — a card fund top-up's payment is looked up with the top-up chain", () => {
  it("routes a payment with fund_topup_id to topupDeps, never to the order chain", async () => {
    const w = await world({ fetches: [{ status: "successful", chargedAmountZar: 3000 }] });
    w.setNow(new Date(SUNDAY_0900.getTime() + 31 * MIN));
    // The in-memory store keys the subject as an order; here it stands in for top-up "ord-1".
    const real = w.deps.listOpenPayments.getMockImplementation()!;
    w.deps.listOpenPayments.mockImplementation(async () =>
      (await real()).map((p) => ({ ...p, orderId: null, fundTopupId: p.orderId }))
    );
    w.deps.topupDeps.mockReturnValue(w.tender);
    expect(await reconcileUnconfirmedPayments(w.deps)).toEqual({ due: 1, lookedUp: 1, alerted: 0 });
    expect(w.deps.topupDeps).toHaveBeenCalledTimes(1);
    expect(w.store.paymentsOf("ord-1")[0].status).toBe("successful");
  });
});
