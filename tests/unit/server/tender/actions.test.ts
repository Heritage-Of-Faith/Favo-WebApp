// AT-201 part 2b: the tender server actions (src/server/actions/tender.ts),
// run on the real chain over an in-memory store and FakeYocoWebPosPort —
// never live Yoco. Spec: PRD v7.0 §11.2, §10.7 (role matrix), S1, S2–S4, T2;
// REQ-003, 004, 008, 010, 026, 027, 028, 029, 153. R30.00 is 3000 cents.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { FakeYocoWebPosPort, type FakeSendScript } from "@/server/yoco/webpos-fake";
import type { TenderDeps } from "@/server/tender/types";
import { unlinkedWebPosPort } from "@/server/tender/unlinked-port";
import { MemoryTenderStore } from "./memory-store";

const mockAuthorize = vi.fn(async (..._roles: unknown[]) => ({
  ok: true as const,
  session: { id: "staff_louis", role: "barista" },
}));
vi.mock("@/server/auth/guard", () => ({ authorize: (...a: unknown[]) => mockAuthorize(...a) }));

let deps: TenderDeps;
let sessionToday = true;
vi.mock("@/server/tender/runtime", () => ({
  getTenderDeps: () => deps,
  hasSessionToday: vi.fn(async () => sessionToday),
}));

import * as actions from "@/server/actions/tender";
import { beginTender, pollTenderResult, resolveTenderByLookup, sendToTerminal } from "@/server/actions/tender";

const T0 = new Date("2026-10-25T07:00:00.000Z"); // Sunday 09:00 SAST

function world(opts: { totalZar?: number; sends?: FakeSendScript[] } = {}) {
  const store = new MemoryTenderStore([
    { id: "ord-1", state: "ordered", totalZar: opts.totalZar ?? 3000, clientUuid: "cu-1" },
  ]);
  const port = new FakeYocoWebPosPort({ sends: opts.sends ?? [] });
  let now = T0;
  const notify = { paymentUnresolved: vi.fn(async () => {}), duplicateCharge: vi.fn(async () => {}) };
  deps = { store, port, now: () => now, readDeviceId: async () => "dev-khumo-1", notify };
  return {
    store,
    port,
    notify,
    advance(ms: number) { now = new Date(now.getTime() + ms); },
    pays: () => store.paymentsOf("ord-1"),
    audits: (action: string) => store.state.audit.filter((a) => a.action === action),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  sessionToday = true;
});

describe("auth (§10.7: barista ✔ admin ✔, nobody else)", () => {
  it("every tender action is authorised for barista and admin only", async () => {
    world();
    await beginTender("ord-1");
    await sendToTerminal("ord-1", 1);
    await pollTenderResult("ord-1", 1);
    await resolveTenderByLookup("ord-1");
    expect(mockAuthorize).toHaveBeenCalledTimes(4);
    for (const call of mockAuthorize.mock.calls) expect(call).toEqual(["barista", "admin"]);
  });

  it("an unauthenticated caller gets the guard's refusal and nothing is written", async () => {
    const w = world();
    mockAuthorize.mockResolvedValueOnce({ ok: false, code: "UNAUTHORIZED", message: "You must be signed in." } as never);
    expect(await beginTender("ord-1")).toEqual({ ok: false, code: "UNAUTHORIZED", message: "You must be signed in." });
    expect(w.pays()).toEqual([]);
  });

  it("§10.2.1: there is no recordTenderResult action — a client can never submit a result", () => {
    expect(Object.keys(actions).sort()).toEqual(
      ["beginTender", "pollTenderResult", "resolveTenderByLookup", "sendToTerminal"].sort()
    );
  });

  it("malformed input is VALIDATION and touches nothing", async () => {
    const w = world();
    expect(await sendToTerminal("ord-1", 0)).toMatchObject({ ok: false, code: "VALIDATION" });
    expect(await pollTenderResult("", 1)).toMatchObject({ ok: false, code: "VALIDATION" });
    expect(w.pays()).toEqual([]);
  });
});

describe("beginTender action", () => {
  it("S1 NO_SESSION: no opening_sessions row today → refused, audited, no payments row", async () => {
    const w = world();
    sessionToday = false;
    const r = await beginTender("ord-1");
    expect(r).toMatchObject({ ok: false, code: "NO_SESSION" });
    expect(w.pays()).toEqual([]);
    expect(w.audits("payment.tender_rejected")).toEqual([
      expect.objectContaining({ entityId: "ord-1", reason: "no_session", actorId: "staff_louis" }),
    ]);
  });

  it("REQ-027: attempt 1, client_reference = client_uuid:1, amount = order total in cents", async () => {
    const w = world();
    expect(await beginTender("ord-1")).toEqual({
      ok: true, data: { attempt: 1, clientReference: "cu-1:1", amountZar: 3000 },
    });
    expect(w.pays()).toMatchObject([{ attempt: 1, status: "pending", amountZar: 3000, sentAt: null }]);
    expect(w.port.sends).toEqual([]); // REQ-026: begun, nothing sent
  });

  it("REQ-153: an R0 order → no payments row, nothing sent", async () => {
    const w = world({ totalZar: 0 });
    expect(await beginTender("ord-1")).toMatchObject({ ok: false, code: "VALIDATION" });
    expect(w.pays()).toEqual([]);
    expect(w.port.sends).toEqual([]);
  });

  it("REQ-028: a second begin while one is open is TENDER_IN_PROGRESS, naming the open attempt so the screen resumes it", async () => {
    world();
    await beginTender("ord-1");
    expect(await beginTender("ord-1")).toMatchObject({
      ok: false,
      code: "TENDER_IN_PROGRESS",
      message: "This order is at the card machine — finish or cancel the payment first",
      openAttempt: { attempt: 1, status: "pending", sent: false },
    });
  });
});

describe("no card terminal linked to FAVO (no webpos_device_id, or the unlinked port)", () => {
  const NO_TERMINAL = "No card terminal is linked to FAVO yet. Take this payment on the Yoco app, or cancel the order.";
  const PRD_COPY = "Card machine not responding — check it's on and on the wifi, or switch to deferred";

  it("no app_config.webpos_device_id → TERMINAL_UNREACHABLE with the no-terminal copy (no deferred switch exists), no row", async () => {
    const w = world();
    deps.readDeviceId = async () => null;
    expect(await beginTender("ord-1")).toEqual({ ok: false, code: "TERMINAL_UNREACHABLE", message: NO_TERMINAL });
    expect(w.pays()).toEqual([]);
  });

  it("the unlinked port at send → the no-terminal copy; nothing sent", async () => {
    const w = world();
    deps.port = unlinkedWebPosPort;
    await beginTender("ord-1");
    expect(await sendToTerminal("ord-1", 1)).toMatchObject({ ok: false, code: "TERMINAL_UNREACHABLE", message: NO_TERMINAL });
    expect(w.pays()[0]).toMatchObject({ sentAt: null, yocoPaymentId: null });
  });

  it("a LINKED device that errors keeps the PRD's own copy", async () => {
    world({ sends: [{ outcome: "device_error" }] });
    await beginTender("ord-1");
    expect(await sendToTerminal("ord-1", 1)).toMatchObject({ ok: false, code: "TERMINAL_UNREACHABLE", message: PRD_COPY });
  });

  it("an exception inside beginTender (DB outage) → TENDER_NOT_BEGUN with a retry, not STALE_STATE", async () => {
    world();
    deps.store = { transaction: async () => { throw new Error("connection refused"); } };
    expect(await beginTender("ord-1")).toEqual({
      ok: false, code: "TENDER_NOT_BEGUN",
      message: "Couldn't start the card payment — nothing was sent. Try again.", retryOffered: true,
    });
  });
});

describe("sendToTerminal action — the four outcomes, never conflated (REQ-010)", () => {
  it("sent → Yoco's id and sent_at are persisted immediately (REQ-029)", async () => {
    const w = world({ sends: [{ outcome: "sent", yocoPaymentId: "yp_1" }] });
    await beginTender("ord-1");
    const r = await sendToTerminal("ord-1", 1);
    expect(r).toEqual({ ok: true, data: { sentAt: T0.toISOString() } });
    expect(w.pays()[0]).toMatchObject({ yocoPaymentId: "yp_1", sentAt: T0, status: "pending" });
    expect(w.port.sends).toEqual([{ deviceId: "dev-khumo-1", amountZar: 3000, clientReference: "cu-1:1" }]);
  });

  it("REQ-029: a second send for the same attempt is VALIDATION, never a re-send", async () => {
    const w = world({ sends: [{ outcome: "sent", yocoPaymentId: "yp_1" }, { outcome: "sent", yocoPaymentId: "yp_2" }] });
    await beginTender("ord-1");
    await sendToTerminal("ord-1", 1);
    expect(await sendToTerminal("ord-1", 1)).toMatchObject({ ok: false, code: "VALIDATION" });
    expect(w.port.sends).toHaveLength(1);
  });

  it("gateway error with no id → GATEWAY_UNAVAILABLE with a retry offered; the next attempt is a NEW reference", async () => {
    const w = world({ sends: [{ outcome: "gateway_unavailable", httpStatus: 503 }, { outcome: "sent", yocoPaymentId: "yp_2" }] });
    await beginTender("ord-1");
    expect(w.pays()).toHaveLength(1);
    expect(await sendToTerminal("ord-1", 1)).toEqual({
      ok: false, code: "GATEWAY_UNAVAILABLE", message: "Couldn't reach the card system — try again.", retryOffered: true,
    });
    expect(await beginTender("ord-1")).toMatchObject({ ok: true, data: { attempt: 2, clientReference: "cu-1:2" } });
    expect(await sendToTerminal("ord-1", 2)).toMatchObject({ ok: true });
  });

  it("a send that TIMED OUT → PAYMENT_UNKNOWN, no retry offered, unresolved, and never sent again (REQ-010, S4)", async () => {
    const w = world({ sends: [{ outcome: "timeout" }] });
    await beginTender("ord-1");
    const r = await sendToTerminal("ord-1", 1);
    expect(r).toEqual({ ok: false, code: "PAYMENT_UNKNOWN", message: "We'll confirm this one shortly" });
    expect((r as { retryOffered?: boolean }).retryOffered).toBeUndefined();
    expect(w.pays()[0].status).toBe("unresolved");
    expect(await beginTender("ord-1")).toMatchObject({ ok: false, code: "TENDER_IN_PROGRESS" });
    expect(w.port.sends).toHaveLength(1);
  });
});

describe("pollTenderResult action", () => {
  it("successful → status successful at the charged amount, plain cents (no ×100)", async () => {
    const w = world({ sends: [{ outcome: "sent", yocoPaymentId: "yp_1", fetches: [{ status: "pending" }, { status: "successful" }] }] });
    await beginTender("ord-1");
    await sendToTerminal("ord-1", 1);
    expect(await pollTenderResult("ord-1", 1)).toEqual({ ok: true, data: { status: "pending", fetchError: false } });
    expect(await pollTenderResult("ord-1", 1)).toEqual({ ok: true, data: { status: "successful", fetchError: false } });
    expect(w.pays()[0]).toMatchObject({ status: "successful", chargedAmountZar: 3000 });
  });

  it("REQ-004: declined → PAYMENT_DECLINED; the order row is untouched (still ordered)", async () => {
    const w = world({ sends: [{ outcome: "sent", yocoPaymentId: "yp_1", fetches: [{ status: "failed" }] }] });
    await beginTender("ord-1");
    await sendToTerminal("ord-1", 1);
    expect(await pollTenderResult("ord-1", 1)).toEqual({
      ok: false, code: "PAYMENT_DECLINED", message: "Card declined — try again or use another card.",
    });
    expect(w.store.order("ord-1")).toEqual({ id: "ord-1", state: "ordered", totalZar: 3000, clientUuid: "cu-1" });
    expect(await beginTender("ord-1")).toMatchObject({ ok: true, data: { attempt: 2 } }); // re-attemptable, nothing re-rung
  });

  it("REQ-003: at 180 s from the send → PAYMENT_UNKNOWN, unresolved, the Admin is pushed, no cancel", async () => {
    const w = world({ sends: [{ outcome: "sent", yocoPaymentId: "yp_1" }] });
    await beginTender("ord-1");
    await sendToTerminal("ord-1", 1);
    w.advance(180_000);
    expect(await pollTenderResult("ord-1", 1)).toMatchObject({ ok: false, code: "PAYMENT_UNKNOWN" });
    expect(w.pays()[0].status).toBe("unresolved");
    expect(w.notify.paymentUnresolved).toHaveBeenCalledWith({ orderId: "ord-1", attempt: 1, amountZar: 3000, cause: "ceiling" });
    expect(w.store.order("ord-1")?.state).toBe("ordered");
  });
});

describe("resolveTenderByLookup action (S4, REQ-008)", () => {
  it("attaches what Yoco says, by a server-side fetch — and never sends", async () => {
    const w = world({ sends: [{ outcome: "timeout", createdPaymentId: "yp_9", fetches: [{ status: "successful" }] }] });
    await beginTender("ord-1");
    await sendToTerminal("ord-1", 1); // unresolved, no id held
    const sends = w.port.sends.length;
    const r = await resolveTenderByLookup("ord-1");
    expect(r).toEqual({ ok: true, data: { attempts: [{ attempt: 1, read: "successful", status: "successful" }] } });
    expect(w.port.sends.length).toBe(sends);
    expect(w.port.lookups).toEqual(["cu-1:1"]);
  });
});
