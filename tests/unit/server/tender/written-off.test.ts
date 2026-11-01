// AT-207 — a written-off order is not tendered again (PRD §10.3.3: settled_at
// and written_off_at are mutually exclusive; §11.2 settleDeferredOrder
// "rejects an order already settled or written off"). Proven against the
// in-memory store and FakeYocoWebPosPort only — never live Yoco.

import { describe, it, expect, vi } from "vitest";
import { FakeYocoWebPosPort } from "@/server/yoco/webpos-fake";
import { beginTender, recordTenderResult, resolveTenderByLookup, sendToTerminal } from "@/server/tender/tender";
import { lateSuccessOnWrittenOffAlert } from "@/server/tender/admin-notifier";
import type { TenderActor, TenderDeps } from "@/server/tender/types";
import { MemoryTenderStore } from "./memory-store";

const BARISTA: TenderActor = { kind: "staff", staffId: "staff_louis", role: "barista" };
const T0 = new Date("2026-10-25T07:00:00.000Z");

function world(writtenOff: boolean) {
  const store = new MemoryTenderStore([
    { id: "ord-1", state: "ordered", totalZar: 3000, clientUuid: "cu-1", writtenOff },
  ]);
  const port = new FakeYocoWebPosPort({ sends: [{ outcome: "sent", yocoPaymentId: "yp-1" }] });
  const deps: TenderDeps = {
    store,
    port,
    now: () => T0,
    readDeviceId: vi.fn(async () => "dev-khumo-1"),
    notify: { paymentUnresolved: vi.fn(async () => {}), duplicateCharge: vi.fn(async () => {}) },
  };
  return { store, port, deps };
}

describe("beginTender on a written-off order (AT-207)", () => {
  it("is refused with ORDER_WRITTEN_OFF: no payments row, nothing sent, the refusal audited", async () => {
    const w = world(true);
    const r = await beginTender(w.deps, BARISTA, "ord-1");
    expect(r).toMatchObject({ ok: false, code: "ORDER_WRITTEN_OFF" });
    expect(w.store.paymentsOf("ord-1")).toHaveLength(0);
    expect(w.port.sends).toHaveLength(0);
    expect(w.store.state.audit.filter((a) => a.action === "payment.tender_rejected")).toMatchObject([
      { reason: "order_written_off" },
    ]);
  });

  it("an order that is not written off is tendered as before", async () => {
    const w = world(false);
    expect(await beginTender(w.deps, BARISTA, "ord-1")).toMatchObject({ ok: true, attempt: 1 });
  });
});

describe("a result arriving after a write-off (REQ-034 is AT-207 part 2)", () => {
  it("recordTenderResult is untouched: a late successful read is still recorded on its attempt", async () => {
    const w = world(false);
    await beginTender(w.deps, BARISTA, "ord-1");
    await sendToTerminal(w.deps, BARISTA, "ord-1", 1);
    // The close writes the order off while the attempt is still open.
    w.store.order("ord-1")!.writtenOff = true;
    const r = await recordTenderResult(w.deps, BARISTA, "ord-1", 1, {
      kind: "read",
      payment: { yocoPaymentId: "yp-1", clientReference: "cu-1:1", status: "successful", chargedAmountZar: 3000 },
    });
    expect(r).toEqual({ ok: true, status: "successful", flags: [] });
    expect(w.store.paymentsOf("ord-1")[0].status).toBe("successful");
  });
});

describe("sendToTerminal on an attempt begun before the write-off (AT-207)", () => {
  it("is refused with ORDER_WRITTEN_OFF: nothing sent, the attempt left unclaimed, the refusal audited", async () => {
    const w = world(false);
    await beginTender(w.deps, BARISTA, "ord-1");
    // The close writes the order off between beginTender and the send.
    w.store.order("ord-1")!.writtenOff = true;
    const r = await sendToTerminal(w.deps, BARISTA, "ord-1", 1);
    expect(r).toMatchObject({ ok: false, code: "ORDER_WRITTEN_OFF" });
    expect(w.port.sends).toHaveLength(0);
    expect(w.store.paymentsOf("ord-1")[0]).toMatchObject({ status: "pending", sentAt: null, yocoPaymentId: null });
    expect(w.store.state.audit.filter((a) => a.action === "payment.send_claimed")).toHaveLength(0);
    expect(w.store.state.audit.filter((a) => a.action === "payment.send_rejected")).toMatchObject([
      { reason: "order_written_off", actorId: "staff_louis" },
    ]);
  });
});

describe("a late success on a written-off order is flagged, never reversed (AT-207; REQ-034 is part 2)", () => {
  function lateWorld(alert: () => Promise<void>, sends?: ConstructorParameters<typeof FakeYocoWebPosPort>[0]) {
    const w = world(false);
    const port = new FakeYocoWebPosPort(sends ?? { sends: [{ outcome: "sent", yocoPaymentId: "yp-1" }] });
    const lateSuccessOnWrittenOff = vi.fn(alert);
    const deps: TenderDeps = { ...w.deps, port, notify: { ...w.deps.notify, lateSuccessOnWrittenOff } };
    return { ...w, port, deps, lateSuccessOnWrittenOff };
  }

  it("recordTenderResult: the payment is recorded successful, written-off stays, an audit row and one Admin alert", async () => {
    const w = lateWorld(async () => {});
    await beginTender(w.deps, BARISTA, "ord-1");
    await sendToTerminal(w.deps, BARISTA, "ord-1", 1);
    w.store.order("ord-1")!.writtenOff = true;
    const r = await recordTenderResult(w.deps, BARISTA, "ord-1", 1, {
      kind: "read",
      payment: { yocoPaymentId: "yp-1", clientReference: "cu-1:1", status: "successful", chargedAmountZar: 3000 },
    });
    expect(r).toEqual({ ok: true, status: "successful", flags: [] });
    expect(w.store.paymentsOf("ord-1")[0]).toMatchObject({ status: "successful", chargedAmountZar: 3000 });
    expect(w.store.order("ord-1")!.writtenOff).toBe(true);
    const paymentId = w.store.paymentsOf("ord-1")[0].id;
    expect(w.store.state.audit.filter((a) => a.action === "payment.late_success_on_written_off")).toMatchObject([
      {
        entityKind: "order",
        entityId: "ord-1",
        reason: "late_success_on_written_off",
        after: { orderId: "ord-1", paymentId, attempt: 1, chargedAmountZar: 3000, orderTotalZar: 3000, via: "poll" },
      },
    ]);
    expect(w.lateSuccessOnWrittenOff).toHaveBeenCalledTimes(1);
    expect(w.lateSuccessOnWrittenOff).toHaveBeenCalledWith({
      orderId: "ord-1", paymentId, attempt: 1, chargedAmountZar: 3000, orderTotalZar: 3000,
    });
  });

  it("a failing Admin alert never fails the payment recording", async () => {
    const w = lateWorld(async () => { throw new Error("push down"); });
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    await beginTender(w.deps, BARISTA, "ord-1");
    await sendToTerminal(w.deps, BARISTA, "ord-1", 1);
    w.store.order("ord-1")!.writtenOff = true;
    const r = await recordTenderResult(w.deps, BARISTA, "ord-1", 1, {
      kind: "read",
      payment: { yocoPaymentId: "yp-1", clientReference: "cu-1:1", status: "successful", chargedAmountZar: 3000 },
    });
    expect(r).toEqual({ ok: true, status: "successful", flags: [] });
    expect(w.store.paymentsOf("ord-1")[0].status).toBe("successful");
    expect(w.store.state.audit.filter((a) => a.action === "payment.late_success_on_written_off")).toHaveLength(1);
    expect(w.lateSuccessOnWrittenOff).toHaveBeenCalledTimes(1);
    err.mockRestore();
  });

  it("resolveTenderByLookup: the same audit row (via lookup) and alert", async () => {
    const w = lateWorld(async () => {}, {
      sends: [{ outcome: "timeout", createdPaymentId: "yp-late", fetches: [{ status: "successful", chargedAmountZar: 3000 }] }],
    });
    await beginTender(w.deps, BARISTA, "ord-1");
    await sendToTerminal(w.deps, BARISTA, "ord-1", 1);
    w.store.order("ord-1")!.writtenOff = true;
    const r = await resolveTenderByLookup(w.deps, { kind: "system" }, "ord-1");
    expect(r).toEqual({ ok: true, attempts: [{ attempt: 1, read: "successful", status: "successful" }] });
    expect(w.store.order("ord-1")!.writtenOff).toBe(true);
    expect(w.store.state.audit.filter((a) => a.action === "payment.late_success_on_written_off")).toMatchObject([
      { entityId: "ord-1", actorRole: "system", after: { attempt: 1, chargedAmountZar: 3000, via: "lookup" } },
    ]);
    expect(w.lateSuccessOnWrittenOff).toHaveBeenCalledTimes(1);
  });

  it("a success on an order that is not written off writes no such row and sends no such alert", async () => {
    const w = lateWorld(async () => {});
    await beginTender(w.deps, BARISTA, "ord-1");
    await sendToTerminal(w.deps, BARISTA, "ord-1", 1);
    await recordTenderResult(w.deps, BARISTA, "ord-1", 1, {
      kind: "read",
      payment: { yocoPaymentId: "yp-1", clientReference: "cu-1:1", status: "successful", chargedAmountZar: 3000 },
    });
    expect(w.store.state.audit.filter((a) => a.action === "payment.late_success_on_written_off")).toHaveLength(0);
    expect(w.lateSuccessOnWrittenOff).not.toHaveBeenCalled();
  });

  it("the Admin alert names the amount, the attempt and that the write-off stands", () => {
    const a = lateSuccessOnWrittenOffAlert("ord-1abc", {
      orderId: "ord-1abcdef", paymentId: "pay-1", attempt: 2, chargedAmountZar: 3000, orderTotalZar: 3000,
    });
    expect(a.title).toBe("Paid after write-off — order ord-1abc");
    expect(a.body).toContain("attempt 2");
    expect(a.body).toContain("the write-off still stands");
    expect(a.data).toMatchObject({ orderId: "ord-1abcdef", chargedAmountZar: 3000 });
  });
});
