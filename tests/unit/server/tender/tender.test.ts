// AT-201 part 2a: the tender chain, proven against FakeYocoWebPosPort only —
// never live Yoco. Spec: PRD v7.0 §6.8 (§6.8.4 error paths), §10.2.1, §10.3.3,
// §11.2, S2–S4, T2; REQ-003, 004, 008, 010, 011, 026, 027, 028, 029, 030, 065,
// 153. Every amount is integer cents: R30.00 is 3000, and nothing is ×100.

import { describe, it, expect, vi } from "vitest";
import { FakeYocoWebPosPort, type FakeSendScript } from "@/server/yoco/webpos-fake";
import type { WebPosDeviceResult } from "@/server/yoco/webpos-port";
import {
  beginTender,
  isAttemptOpen,
  isUnresolvedNeedingAttention,
  pollTenderResult,
  recordTenderResult,
  resolveTenderByLookup,
  sendToTerminal,
} from "@/server/tender/tender";
import type { TenderActor, TenderDeps } from "@/server/tender/types";
import { MemoryTenderStore } from "./memory-store";

const BARISTA: TenderActor = { kind: "staff", staffId: "staff_louis", role: "barista" };
const SYSTEM: TenderActor = { kind: "system" };
const T0 = new Date("2026-10-25T07:00:00.000Z"); // a Sunday, 09:00 SAST

function world(opts: { totalZar?: number; sends?: FakeSendScript[]; device?: WebPosDeviceResult } = {}) {
  const store = new MemoryTenderStore([
    { id: "ord-1", state: "ordered", totalZar: opts.totalZar ?? 3000, clientUuid: "cu-1" },
  ]);
  const port = new FakeYocoWebPosPort({ sends: opts.sends ?? [], device: opts.device });
  let now = T0;
  let deviceId: string | null = "dev-khumo-1";
  const readDeviceId = vi.fn(async () => deviceId);
  const notify = {
    paymentUnresolved: vi.fn(async () => {}),
    duplicateCharge: vi.fn(async () => {}),
  };
  const deps: TenderDeps = { store, port, now: () => now, readDeviceId, notify };
  return {
    store,
    port,
    deps,
    notify,
    readDeviceId,
    advance(ms: number) { now = new Date(now.getTime() + ms); },
    setDevice(id: string | null) { deviceId = id; },
    pay(attempt = 1) { return store.paymentsOf("ord-1").find((p) => p.attempt === attempt)!; },
    audits(action: string) { return store.state.audit.filter((a) => a.action === action); },
  };
}

async function begunAndSent(w: ReturnType<typeof world>) {
  const b = await beginTender(w.deps, BARISTA, "ord-1");
  expect(b.ok).toBe(true);
  const s = await sendToTerminal(w.deps, BARISTA, "ord-1", 1);
  return s;
}

// ─── beginTender ──────────────────────────────────────────────────────────────

describe("beginTender (T2 step 3, §11.2)", () => {
  it("REQ-026/027: writes the pending row with client_uuid:1 and the total BEFORE anything is sent", async () => {
    const w = world();
    const r = await beginTender(w.deps, BARISTA, "ord-1");
    expect(r).toEqual({ ok: true, paymentId: expect.any(String), attempt: 1, clientReference: "cu-1:1", amountZar: 3000 });
    expect(w.store.paymentsOf("ord-1")).toHaveLength(1);
    expect(w.pay()).toMatchObject({
      status: "pending",
      attempt: 1,
      clientReference: "cu-1:1",
      amountZar: 3000,
      webposDeviceId: "dev-khumo-1",
      yocoPaymentId: null,
      sentAt: null,
    });
    expect(w.port.sends).toHaveLength(0);
    expect(w.audits("payment.tender_begun")).toHaveLength(1);
  });

  it("REQ-153 / L42: an R0 order writes no payments row and sends nothing; the refusal is audited", async () => {
    const w = world({ totalZar: 0 });
    const r = await beginTender(w.deps, BARISTA, "ord-1");
    expect(r).toMatchObject({ ok: false, code: "VALIDATION" });
    expect(w.store.paymentsOf("ord-1")).toHaveLength(0);
    expect(w.port.sends).toHaveLength(0);
    expect(w.readDeviceId).not.toHaveBeenCalled();
    expect(w.audits("payment.tender_rejected")).toMatchObject([{ reason: "no_net_charge" }]);
  });

  it("§6.8.4 double-tap / REQ-028: a second beginTender while an attempt is open is TENDER_IN_PROGRESS, audited", async () => {
    const w = world();
    await beginTender(w.deps, BARISTA, "ord-1");
    const r = await beginTender(w.deps, BARISTA, "ord-1");
    expect(r).toEqual({
      ok: false,
      code: "TENDER_IN_PROGRESS",
      message: "This order is at the card machine — finish or cancel the payment first",
    });
    expect(w.store.paymentsOf("ord-1")).toHaveLength(1);
    expect(w.audits("payment.tender_rejected")).toMatchObject([{ reason: "tender_in_progress" }]);
  });

  it("REQ-027: after a decline the next attempt is 2 with a NEW reference, cu-1:2 — never reused", async () => {
    const w = world({ sends: [{ outcome: "sent", yocoPaymentId: "yp-1", fetches: [{ status: "failed" }] }] });
    await begunAndSent(w);
    await pollTenderResult(w.deps, BARISTA, "ord-1", 1);
    expect(w.pay(1).status).toBe("declined");
    const r = await beginTender(w.deps, BARISTA, "ord-1");
    expect(r).toMatchObject({ ok: true, attempt: 2, clientReference: "cu-1:2" });
    expect(w.store.paymentsOf("ord-1").map((p) => p.clientReference)).toEqual(["cu-1:1", "cu-1:2"]);
  });

  it("REQ-065: the device id is read once, at beginTender; changing config mid-tender changes nothing", async () => {
    const w = world({ sends: [{ outcome: "sent", yocoPaymentId: "yp-1" }] });
    await beginTender(w.deps, BARISTA, "ord-1");
    expect(w.readDeviceId).toHaveBeenCalledTimes(1);
    w.setDevice("dev-replacement-2");
    await sendToTerminal(w.deps, BARISTA, "ord-1", 1);
    await pollTenderResult(w.deps, BARISTA, "ord-1", 1);
    expect(w.readDeviceId).toHaveBeenCalledTimes(1);
    expect(w.pay().webposDeviceId).toBe("dev-khumo-1");
    expect(w.port.sends[0].deviceId).toBe("dev-khumo-1");
  });

  it("no configured device: TERMINAL_UNREACHABLE and no payments row", async () => {
    const w = world();
    w.setDevice(null);
    const r = await beginTender(w.deps, BARISTA, "ord-1");
    expect(r).toMatchObject({ ok: false, code: "TERMINAL_UNREACHABLE" });
    expect(w.store.paymentsOf("ord-1")).toHaveLength(0);
  });

  it("an order already paid is ALREADY_RESOLVED", async () => {
    const w = world({ sends: [{ outcome: "sent", yocoPaymentId: "yp-1", fetches: [{ status: "successful" }] }] });
    await begunAndSent(w);
    await pollTenderResult(w.deps, BARISTA, "ord-1", 1);
    expect(await beginTender(w.deps, BARISTA, "ord-1")).toMatchObject({
      ok: false,
      code: "ALREADY_RESOLVED",
      message: "Already paid — do not charge again",
    });
  });
});

// ─── sendToTerminal ───────────────────────────────────────────────────────────

describe("sendToTerminal (T2 step 4, REQ-010, REQ-029)", () => {
  it("REQ-029: persists yoco_payment_id and sent_at immediately, before any outcome; sends 3000 cents, no ×100", async () => {
    const w = world({ sends: [{ outcome: "sent", yocoPaymentId: "yp-1" }] });
    const r = await begunAndSent(w);
    expect(r).toEqual({ ok: true, yocoPaymentId: "yp-1", sentAt: T0 });
    expect(w.pay()).toMatchObject({ status: "pending", yocoPaymentId: "yp-1", sentAt: T0 });
    expect(w.port.sends).toEqual([{ deviceId: "dev-khumo-1", amountZar: 3000, clientReference: "cu-1:1" }]);
  });

  it("REQ-029: a second send of the same (orderId, attempt) is VALIDATION and never reaches Yoco; audited", async () => {
    const w = world({ sends: [{ outcome: "sent", yocoPaymentId: "yp-1" }] });
    await begunAndSent(w);
    const again = await sendToTerminal(w.deps, BARISTA, "ord-1", 1);
    expect(again).toMatchObject({ ok: false, code: "VALIDATION" });
    expect(w.port.sends).toHaveLength(1);
    expect(w.audits("payment.send_rejected")).toMatchObject([{ reason: "second_send_refused" }]);
  });

  it("REQ-010: an error with no id is GATEWAY_UNAVAILABLE with a retry offered — and the retry is a new attempt", async () => {
    const w = world({ sends: [{ outcome: "gateway_unavailable", httpStatus: 503 }, { outcome: "sent", yocoPaymentId: "yp-2" }] });
    const r = await begunAndSent(w);
    expect(r).toEqual({
      ok: false,
      code: "GATEWAY_UNAVAILABLE",
      message: "Couldn't reach the card system — try again.",
      retryOffered: true,
    });
    expect(w.pay(1)).toMatchObject({ status: "unresolved", sentAt: null, yocoPaymentId: null });
    expect(isAttemptOpen(w.pay(1))).toBe(false);
    // Never sent: no "was the card charged?" push, not counted as needing attention.
    expect(isUnresolvedNeedingAttention(w.pay(1))).toBe(false);
    expect(w.notify.paymentUnresolved).not.toHaveBeenCalled();
    expect(w.audits("payment.closed_never_sent")).toMatchObject([{ reason: "GATEWAY_UNAVAILABLE" }]);
    expect(w.audits("payment.unresolved")).toHaveLength(0);
    const again = await beginTender(w.deps, BARISTA, "ord-1");
    expect(again).toMatchObject({ ok: true, attempt: 2, clientReference: "cu-1:2" });
    expect(await sendToTerminal(w.deps, BARISTA, "ord-1", 2)).toMatchObject({ ok: true, yocoPaymentId: "yp-2" });
  });

  it("REQ-010: a send that TIMED OUT is PAYMENT_UNKNOWN, unresolved, never re-sent, and holds the order", async () => {
    const w = world({ sends: [{ outcome: "timeout" }] });
    const r = await begunAndSent(w);
    expect(r).toMatchObject({ ok: false, code: "PAYMENT_UNKNOWN" });
    expect(r).not.toHaveProperty("retryOffered");
    expect(w.pay()).toMatchObject({ status: "unresolved", sentAt: T0, yocoPaymentId: null });
    expect(await sendToTerminal(w.deps, BARISTA, "ord-1", 1)).toMatchObject({ ok: false, code: "VALIDATION" });
    expect(await beginTender(w.deps, BARISTA, "ord-1")).toMatchObject({ ok: false, code: "TENDER_IN_PROGRESS" });
    expect(w.port.sends).toHaveLength(1);
    expect(w.notify.paymentUnresolved).toHaveBeenCalledWith({ orderId: "ord-1", attempt: 1, amountZar: 3000, cause: "send_timeout" });
  });

  it("§6.8.4: a device error is TERMINAL_UNREACHABLE — never GATEWAY_UNAVAILABLE — and the order stays re-tenderable", async () => {
    const w = world({ sends: [{ outcome: "device_error" }] });
    const r = await begunAndSent(w);
    expect(r).toMatchObject({
      ok: false,
      code: "TERMINAL_UNREACHABLE",
      message: "Card machine not responding — check it's on and on the wifi, or switch to deferred",
      retryOffered: false,
    });
    expect(w.pay()).toMatchObject({ status: "unresolved", sentAt: null });
    expect(w.notify.paymentUnresolved).not.toHaveBeenCalled();
    expect(w.audits("payment.closed_never_sent")).toMatchObject([{ reason: "TERMINAL_UNREACHABLE" }]);
    expect(await beginTender(w.deps, BARISTA, "ord-1")).toMatchObject({ ok: true, attempt: 2 });
  });

  it("REQ-010: a timed-out attempt IS unresolved needing attention (something was sent)", async () => {
    const w = world({ sends: [{ outcome: "timeout" }] });
    await begunAndSent(w);
    expect(isUnresolvedNeedingAttention(w.pay())).toBe(true);
  });

  it("§6.8.2: the device is looked up before the send; an offline device sends nothing", async () => {
    const w = world({ device: { kind: "device_error" } });
    const r = await begunAndSent(w);
    expect(r).toMatchObject({ ok: false, code: "TERMINAL_UNREACHABLE" });
    expect(w.port.sends).toHaveLength(0);
  });

  it("an exception during the send cannot establish the outcome: PAYMENT_UNKNOWN, never a retry", async () => {
    const w = world({ sends: [] }); // the fake throws: no scripted send left
    const r = await begunAndSent(w);
    expect(r).toMatchObject({ ok: false, code: "PAYMENT_UNKNOWN" });
    expect(w.pay().status).toBe("unresolved");
  });
});

// ─── pollTenderResult / recordTenderResult ────────────────────────────────────

describe("pollTenderResult + recordTenderResult (T2 steps 5–6, REQ-003/004/030)", () => {
  it("pending stays pending and writes last_checked_at", async () => {
    const w = world({ sends: [{ outcome: "sent", yocoPaymentId: "yp-1" }] });
    await begunAndSent(w);
    w.advance(2_000);
    expect(await pollTenderResult(w.deps, BARISTA, "ord-1", 1)).toEqual({ ok: true, status: "pending" });
    expect(w.pay().lastCheckedAt).toEqual(new Date(T0.getTime() + 2_000));
    expect(w.store.state.statusWrites).toHaveLength(0);
  });

  it("REQ-004: a decline is PAYMENT_DECLINED; the order stays `ordered` with its total, nothing re-rung", async () => {
    const w = world({ sends: [{ outcome: "sent", yocoPaymentId: "yp-1", fetches: [{ status: "failed" }] }] });
    await begunAndSent(w);
    const r = await pollTenderResult(w.deps, BARISTA, "ord-1", 1);
    expect(r).toEqual({ ok: false, code: "PAYMENT_DECLINED", message: "Card declined — try again or use another card." });
    expect(w.pay().status).toBe("declined");
    expect(w.store.order("ord-1")).toEqual({ id: "ord-1", state: "ordered", totalZar: 3000, clientUuid: "cu-1" });
  });

  it("successful at R30.00 records status successful and charged_amount_zar 3000", async () => {
    const w = world({ sends: [{ outcome: "sent", yocoPaymentId: "yp-1", fetches: [{ status: "successful", chargedAmountZar: 3000 }] }] });
    await begunAndSent(w);
    expect(await pollTenderResult(w.deps, BARISTA, "ord-1", 1)).toEqual({ ok: true, status: "successful" });
    expect(w.pay()).toMatchObject({ status: "successful", chargedAmountZar: 3000, yocoPaymentId: "yp-1" });
    expect(w.audits("payment.flagged")).toHaveLength(0);
  });

  it("REQ-030: a charged amount ≠ orders.total_zar is recorded AT THE CHARGED AMOUNT and flagged, never overwritten", async () => {
    const w = world({ sends: [{ outcome: "sent", yocoPaymentId: "yp-1", fetches: [{ status: "successful", chargedAmountZar: 2500 }] }] });
    await begunAndSent(w);
    await pollTenderResult(w.deps, BARISTA, "ord-1", 1);
    expect(w.pay()).toMatchObject({ status: "successful", chargedAmountZar: 2500, amountZar: 3000 });
    expect(w.audits("payment.flagged")).toMatchObject([
      { reason: "amount_mismatch", after: { orderTotalZar: 3000, amountZar: 3000, chargedAmountZar: 2500 } },
    ]);
  });

  it("REQ-003: at 180 s from the send FAVO stops waiting — unresolved, PAYMENT_UNKNOWN, Admin pushed, no further fetch", async () => {
    const w = world({ sends: [{ outcome: "sent", yocoPaymentId: "yp-1" }] });
    await begunAndSent(w);
    w.advance(179_999);
    expect(await pollTenderResult(w.deps, BARISTA, "ord-1", 1)).toEqual({ ok: true, status: "pending" });
    const fetchesBefore = w.port.fetches.length;
    w.advance(1);
    const r = await pollTenderResult(w.deps, BARISTA, "ord-1", 1);
    expect(r).toEqual({ ok: false, code: "PAYMENT_UNKNOWN", message: "We'll confirm this one shortly" });
    expect(w.pay().status).toBe("unresolved");
    expect(w.port.fetches.length).toBe(fetchesBefore);
    expect(w.port.sends).toHaveLength(1);
    expect(w.notify.paymentUnresolved).toHaveBeenCalledWith({ orderId: "ord-1", attempt: 1, amountZar: 3000, cause: "ceiling" });
  });

  it("§6.8.4: a fetch error is never a status — retried at most twice, then reported as still pending", async () => {
    const w = world({ sends: [{ outcome: "sent", yocoPaymentId: "yp-1", fetches: [{ fetchError: true }] }] });
    await begunAndSent(w);
    expect(await pollTenderResult(w.deps, BARISTA, "ord-1", 1)).toEqual({ ok: true, status: "pending", fetchError: true });
    expect(w.port.fetches).toEqual(["yp-1", "yp-1", "yp-1"]);
    expect(w.pay().status).toBe("pending");
  });

  it("recordTenderResult is idempotent on (orderId, attempt): a replay writes nothing", async () => {
    const w = world({ sends: [{ outcome: "sent", yocoPaymentId: "yp-1" }] });
    await begunAndSent(w);
    const payment = { yocoPaymentId: "yp-1", clientReference: "cu-1:1", status: "successful" as const, chargedAmountZar: 3000 };
    await recordTenderResult(w.deps, BARISTA, "ord-1", 1, { kind: "read", payment });
    const again = await recordTenderResult(w.deps, BARISTA, "ord-1", 1, { kind: "read", payment });
    expect(again).toEqual({ ok: true, status: "successful", flags: [] });
    expect(w.store.state.statusWrites).toEqual([{ id: w.pay().id, status: "successful" }]);
  });

  it("a refused transition (declined → successful) is audited, and nothing changes", async () => {
    const w = world({ sends: [{ outcome: "sent", yocoPaymentId: "yp-1", fetches: [{ status: "failed" }] }] });
    await begunAndSent(w);
    await pollTenderResult(w.deps, BARISTA, "ord-1", 1);
    const r = await recordTenderResult(w.deps, BARISTA, "ord-1", 1, {
      kind: "read",
      payment: { yocoPaymentId: "yp-1", clientReference: "cu-1:1", status: "successful", chargedAmountZar: 3000 },
    });
    expect(r).toMatchObject({ ok: false, code: "VALIDATION" });
    expect(w.pay().status).toBe("declined");
    expect(w.audits("payment.result_rejected")).toMatchObject([{ reason: "transition_refused:declined->successful" }]);
  });

  it("a read carrying another attempt's reference is refused, never attached", async () => {
    const w = world({ sends: [{ outcome: "sent", yocoPaymentId: "yp-1" }] });
    await begunAndSent(w);
    const r = await recordTenderResult(w.deps, BARISTA, "ord-1", 1, {
      kind: "read",
      payment: { yocoPaymentId: "yp-1", clientReference: "cu-OTHER:1", status: "successful", chargedAmountZar: 3000 },
    });
    expect(r).toMatchObject({ ok: false, code: "VALIDATION" });
    expect(w.pay().status).toBe("pending");
  });
});

// ─── resolveTenderByLookup ────────────────────────────────────────────────────

describe("resolveTenderByLookup (S4, REQ-008, REQ-011)", () => {
  it("REQ-008: a timed-out send is recovered by client_reference, server-side — never by a second send", async () => {
    const w = world({
      sends: [{ outcome: "timeout", createdPaymentId: "yp-late", fetches: [{ status: "successful", chargedAmountZar: 3000 }] }],
    });
    await begunAndSent(w);
    const r = await resolveTenderByLookup(w.deps, SYSTEM, "ord-1");
    expect(r).toEqual({ ok: true, attempts: [{ attempt: 1, read: "successful", status: "successful" }] });
    expect(w.port.lookups).toEqual(["cu-1:1"]);
    expect(w.port.sends).toHaveLength(1);
    expect(w.pay()).toMatchObject({ status: "successful", yocoPaymentId: "yp-late", chargedAmountZar: 3000 });
    expect(w.audits("payment.successful")).toMatchObject([{ actorRole: "system", after: { via: "lookup" } }]);
  });

  it("fetches by yoco_payment_id where FAVO holds one", async () => {
    const w = world({ sends: [{ outcome: "sent", yocoPaymentId: "yp-1", fetches: [{ status: "successful", chargedAmountZar: 3000 }] }] });
    await begunAndSent(w);
    w.advance(180_000);
    await pollTenderResult(w.deps, BARISTA, "ord-1", 1); // ceiling → unresolved, no fetch
    expect(w.pay().status).toBe("unresolved");
    await resolveTenderByLookup(w.deps, BARISTA, "ord-1");
    expect(w.port.fetches).toEqual(["yp-1"]);
    expect(w.port.lookups).toEqual([]);
    expect(w.pay()).toMatchObject({ status: "successful", chargedAmountZar: 3000 });
  });

  it("S4 step 3: `failed` declines only on two reads ≥ 60 s apart and ≥ 120 s after the send", async () => {
    const w = world({ sends: [{ outcome: "timeout", createdPaymentId: "yp-1", fetches: [{ status: "failed" }] }] });
    await begunAndSent(w);
    w.advance(30_000);
    await resolveTenderByLookup(w.deps, SYSTEM, "ord-1"); // first negative at 30 s
    expect(w.pay().status).toBe("unresolved");
    w.advance(59_999);
    await resolveTenderByLookup(w.deps, SYSTEM, "ord-1"); // 59.999 s after the last: not enough
    expect(w.pay().status).toBe("unresolved");
    w.advance(60_000);
    const r = await resolveTenderByLookup(w.deps, SYSTEM, "ord-1"); // 60 s apart, 149.999 s after the send
    expect(r).toEqual({ ok: true, attempts: [{ attempt: 1, read: "failed", status: "declined" }] });
    expect(w.audits("payment.declined")).toMatchObject([{ reason: "s4_two_negatives" }]);
    expect(w.port.sends).toHaveLength(1);
  });

  it("S4 step 3(c): two negatives inside 120 s of the send do not decline", async () => {
    const w = world({ sends: [{ outcome: "timeout", createdPaymentId: "yp-1", fetches: [{ status: "failed" }] }] });
    await begunAndSent(w);
    await resolveTenderByLookup(w.deps, SYSTEM, "ord-1"); // at 0 s
    w.advance(60_000);
    await resolveTenderByLookup(w.deps, SYSTEM, "ord-1"); // at 60 s
    expect(w.pay().status).toBe("unresolved");
  });

  it("a fetch error or nothing found resolves nothing, and last_checked_at is written", async () => {
    const w = world({ sends: [{ outcome: "timeout" }] });
    await begunAndSent(w);
    w.advance(5_000);
    const r = await resolveTenderByLookup(w.deps, SYSTEM, "ord-1");
    expect(r).toEqual({ ok: true, attempts: [{ attempt: 1, read: "not_found", status: "unresolved" }] });
    expect(w.pay().lastCheckedAt).toEqual(new Date(T0.getTime() + 5_000));
  });

  it("REQ-011: two successful payments on one reference flag duplicate_charge on the order, push both ids and the amount", async () => {
    const w = world({ sends: [{ outcome: "timeout", createdPaymentId: "yp-a", fetches: [{ status: "successful", chargedAmountZar: 3000 }] }] });
    await begunAndSent(w);
    // A second payment Yoco holds on the same reference (a double charge at the machine).
    const port = w.port as unknown as { payments: { yocoPaymentId: string; clientReference: string; amountZar: number; steps: unknown[]; cursor: number }[] };
    port.payments.push({ yocoPaymentId: "yp-b", clientReference: "cu-1:1", amountZar: 3000, steps: [{ status: "successful" }], cursor: 0 });
    await resolveTenderByLookup(w.deps, SYSTEM, "ord-1");
    expect(w.store.paymentsOf("ord-1").filter((p) => p.status === "successful")).toHaveLength(1);
    expect(w.audits("order.flagged")).toMatchObject([
      { entityKind: "order", entityId: "ord-1", reason: "duplicate_charge", after: { yocoPaymentIds: ["yp-a", "yp-b"], amountZar: 3000 } },
    ]);
    expect(w.notify.duplicateCharge).toHaveBeenCalledWith({ orderId: "ord-1", yocoPaymentIds: ["yp-a", "yp-b"], amountZar: 3000 });
  });

  it("a never-sent attempt (sent_at NULL) is not looked up — job 4 never loops on its not_found", async () => {
    const w = world({ sends: [{ outcome: "gateway_unavailable" }] });
    await begunAndSent(w);
    const r = await resolveTenderByLookup(w.deps, SYSTEM, "ord-1");
    expect(r).toEqual({ ok: true, attempts: [] });
    expect(w.port.lookups).toEqual([]);
    expect(w.port.fetches).toEqual([]);
    expect(w.notify.paymentUnresolved).not.toHaveBeenCalled();
  });

  it("REQ-003 on the lookup path: still pending at 180 s from the send → unresolved with the S4a push", async () => {
    const w = world({ sends: [{ outcome: "sent", yocoPaymentId: "yp-1" }] }); // reads pending forever
    await begunAndSent(w);
    w.advance(179_999);
    await resolveTenderByLookup(w.deps, SYSTEM, "ord-1");
    expect(w.pay().status).toBe("pending");
    expect(w.notify.paymentUnresolved).not.toHaveBeenCalled();
    w.advance(1);
    const r = await resolveTenderByLookup(w.deps, SYSTEM, "ord-1");
    expect(r).toEqual({ ok: true, attempts: [{ attempt: 1, read: "pending", status: "unresolved" }] });
    expect(w.pay().status).toBe("unresolved");
    expect(w.notify.paymentUnresolved).toHaveBeenCalledWith({ orderId: "ord-1", attempt: 1, amountZar: 3000, cause: "ceiling" });
    expect(w.port.sends).toHaveLength(1);
  });

  it("REQ-011: duplicate_charge is idempotent — job 4 re-running pushes nothing new", async () => {
    const w = world({ sends: [{ outcome: "timeout", createdPaymentId: "yp-a", fetches: [{ status: "successful", chargedAmountZar: 3000 }] }] });
    await begunAndSent(w);
    const port = w.port as unknown as { payments: { yocoPaymentId: string; clientReference: string; amountZar: number; steps: unknown[]; cursor: number }[] };
    port.payments.push({ yocoPaymentId: "yp-b", clientReference: "cu-1:1", amountZar: 3000, steps: [{ status: "successful" }], cursor: 0 });
    // Another attempt on the order is already successful (e.g. a legacy writer).
    w.store.state.payments.push({
      ...w.pay(1), id: "pmt-x", attempt: 2, clientReference: "cu-1:2", yocoPaymentId: "yp-x", status: "successful", chargedAmountZar: 3000,
    });
    await resolveTenderByLookup(w.deps, SYSTEM, "ord-1");
    expect(w.pay(1)).toMatchObject({ status: "unresolved", yocoPaymentId: "yp-a", chargedAmountZar: 3000 });
    expect(w.notify.duplicateCharge).toHaveBeenCalledTimes(1);
    expect(w.notify.duplicateCharge).toHaveBeenCalledWith({ orderId: "ord-1", yocoPaymentIds: ["yp-x", "yp-a", "yp-b"], amountZar: 3000 });
    await resolveTenderByLookup(w.deps, SYSTEM, "ord-1");
    await resolveTenderByLookup(w.deps, SYSTEM, "ord-1");
    expect(w.notify.duplicateCharge).toHaveBeenCalledTimes(1);
    expect(w.audits("order.flagged")).toHaveLength(1);
  });

  it("two successes on one reference, attached: re-running does not flag again", async () => {
    const w = world({ sends: [{ outcome: "timeout", createdPaymentId: "yp-a", fetches: [{ status: "successful", chargedAmountZar: 3000 }] }] });
    await begunAndSent(w);
    const port = w.port as unknown as { payments: { yocoPaymentId: string; clientReference: string; amountZar: number; steps: unknown[]; cursor: number }[] };
    port.payments.push({ yocoPaymentId: "yp-b", clientReference: "cu-1:1", amountZar: 3000, steps: [{ status: "successful" }], cursor: 0 });
    await resolveTenderByLookup(w.deps, SYSTEM, "ord-1");
    await resolveTenderByLookup(w.deps, SYSTEM, "ord-1");
    expect(w.notify.duplicateCharge).toHaveBeenCalledTimes(1);
  });
});

// ─── every refusal is audited ─────────────────────────────────────────────────

describe("refusals are audited (CLAUDE.md §5)", () => {
  it("pollTenderResult on a missing attempt, and on an attempt never sent", async () => {
    const w = world();
    expect(await pollTenderResult(w.deps, BARISTA, "ord-1", 9)).toMatchObject({ ok: false, code: "VALIDATION" });
    await beginTender(w.deps, BARISTA, "ord-1");
    expect(await pollTenderResult(w.deps, BARISTA, "ord-1", 1)).toMatchObject({ ok: false, code: "VALIDATION" });
    expect(w.audits("payment.poll_rejected")).toMatchObject([
      { entityKind: "order", reason: "no_such_attempt" },
      { entityKind: "payment", reason: "not_sent" },
    ]);
  });

  it("resolveTenderByLookup on an unknown order", async () => {
    const w = world();
    expect(await resolveTenderByLookup(w.deps, SYSTEM, "ord-nope")).toMatchObject({ ok: false, code: "VALIDATION" });
    expect(w.audits("payment.lookup_rejected")).toMatchObject([{ entityId: "ord-nope", reason: "order_not_found", actorRole: "system" }]);
  });
});

// ─── concurrency (the order-row lock) ─────────────────────────────────────────

describe("simultaneous calls (§6.8.4 double-tap, REQ-029)", () => {
  it("two beginTender at once: exactly one attempt, the other TENDER_IN_PROGRESS", async () => {
    const w = world();
    const [a, b] = await Promise.all([beginTender(w.deps, BARISTA, "ord-1"), beginTender(w.deps, BARISTA, "ord-1")]);
    expect([a.ok, b.ok].sort()).toEqual([false, true]);
    expect([a, b].find((r) => !r.ok)).toMatchObject({ code: "TENDER_IN_PROGRESS" });
    expect(w.store.paymentsOf("ord-1")).toHaveLength(1);
  });

  it("two sendToTerminal at once: one send reaches Yoco, the other is VALIDATION", async () => {
    const w = world({ sends: [{ outcome: "sent", yocoPaymentId: "yp-1" }, { outcome: "sent", yocoPaymentId: "yp-2" }] });
    await beginTender(w.deps, BARISTA, "ord-1");
    const [a, b] = await Promise.all([
      sendToTerminal(w.deps, BARISTA, "ord-1", 1),
      sendToTerminal(w.deps, BARISTA, "ord-1", 1),
    ]);
    expect([a.ok, b.ok].sort()).toEqual([false, true]);
    expect([a, b].find((r) => !r.ok)).toMatchObject({ code: "VALIDATION" });
    expect(w.port.sends).toHaveLength(1);
  });
});

// ─── §10.2.1: exactly two writers ─────────────────────────────────────────────

describe("§10.2.1: payments.status has exactly two writers", () => {
  it("only recordTenderResult and resolveTenderByLookup call setPaymentStatus", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const src = readFileSync(resolve(process.cwd(), "src/server/tender/tender.ts"), "utf8");
    // Split into top-level functions and find which contain a status write.
    const fns = src.split(/\n(?=(?:export )?async function )/);
    const writers = fns
      .filter((f) => f.includes("setPaymentStatus("))
      .map((f) => /async function (\w+)/.exec(f)?.[1])
      .sort();
    expect(writers).toEqual(["attachSuccessful", "recordTenderResult", "resolveTenderByLookup"]);
    const callersOfAttach = fns
      .filter((f) => /attachSuccessful\(tx/.test(f))
      .map((f) => /async function (\w+)/.exec(f)?.[1])
      .sort();
    expect(callersOfAttach).toEqual(["recordTenderResult", "resolveTenderByLookup"]);
  });
});
