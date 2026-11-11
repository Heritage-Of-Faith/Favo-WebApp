// REQ-034 (PRD v7.0 T4 / §6.0.5): "Given a write-off with reason
// `unresolved_at_close` · When the next reconciliation runs · Then it stays an
// open T10 item until Yoco's record confirms no payment or produces one — in
// which case the write-off is reversed and the payment attached."
//
// The reversal runs inside the tender chain's two payments.status writers
// (recordTenderResult, resolveTenderByLookup) — nothing else attaches a
// payment. In-memory store and FakeYocoWebPosPort only — never live Yoco.
// R45.00 is 4500 cents.

import { describe, it, expect, vi } from "vitest";
import { FakeYocoWebPosPort, type FakeSendScript } from "@/server/yoco/webpos-fake";
import {
  beginTender,
  recordTenderResult,
  resolveTenderByLookup,
  sendToTerminal,
  REVERSIBLE_WRITE_OFF_REASON,
  WRITE_OFF_REVERSED_ACTION,
} from "@/server/tender/tender";
import { lateSuccessOnWrittenOffAlert } from "@/server/tender/admin-notifier";
import { WRITE_OFF_REASONS } from "@/server/close/write-offs";
import type { TenderActor, TenderDeps } from "@/server/tender/types";
import { MemoryTenderStore } from "./memory-store";

const SYSTEM: TenderActor = { kind: "system" };
const BARISTA: TenderActor = { kind: "staff", staffId: "staff_nkuli", role: "barista" };
const T0 = new Date("2026-10-25T07:00:00.000Z"); // Sunday 09:00 SAST

function world(sends: FakeSendScript[], opts: { deferred?: boolean } = {}) {
  const store = new MemoryTenderStore([
    { id: "ord-1", state: "ordered", totalZar: 4500, clientUuid: "cu-1", deferred: opts.deferred },
  ]);
  const port = new FakeYocoWebPosPort({ sends });
  let now = T0;
  const lateSuccessOnWrittenOff = vi.fn(async () => {});
  const deps: TenderDeps = {
    store,
    port,
    now: () => now,
    readDeviceId: async () => "dev-khumo-1",
    notify: { paymentUnresolved: vi.fn(async () => {}), duplicateCharge: vi.fn(async () => {}), lateSuccessOnWrittenOff },
  };
  return {
    store, port, deps, lateSuccessOnWrittenOff,
    advance(ms: number) { now = new Date(now.getTime() + ms); },
    audits: (action: string) => store.state.audit.filter((a) => a.action === action),
    /** What closeDaily's sweep does to this order: written_off_at + the reason on its audit row. */
    writeOff(reason: string) {
      store.order("ord-1")!.writtenOff = true;
      store.state.writeOffReasons["ord-1"] = reason;
    },
  };
}

describe("REQ-034: an unresolved_at_close write-off", () => {
  it("the reversible reason is exactly the sweep's unresolved_at_close", () => {
    expect(REVERSIBLE_WRITE_OFF_REASON).toBe("unresolved_at_close");
    expect(REVERSIBLE_WRITE_OFF_REASON).toBe(WRITE_OFF_REASONS.unresolvedAtClose);
  });

  it("Yoco's record produces the payment (lookup) → the payment is attached and the write-off reversed, audited", async () => {
    const w = world([{ outcome: "timeout", createdPaymentId: "yp-1", fetches: [{ status: "successful", chargedAmountZar: 4500 }] }]);
    await beginTender(w.deps, BARISTA, "ord-1");
    await sendToTerminal(w.deps, BARISTA, "ord-1", 1); // timeout → unresolved
    w.writeOff("unresolved_at_close");

    const r = await resolveTenderByLookup(w.deps, SYSTEM, "ord-1");

    expect(r).toEqual({ ok: true, attempts: [{ attempt: 1, read: "successful", status: "successful" }] });
    const [pay] = w.store.paymentsOf("ord-1");
    expect(pay).toMatchObject({ status: "successful", yocoPaymentId: "yp-1", chargedAmountZar: 4500 });
    expect(w.store.order("ord-1")!.writtenOff).toBe(false);
    expect(w.audits(WRITE_OFF_REVERSED_ACTION)).toMatchObject([
      {
        entityKind: "order", entityId: "ord-1", actorRole: "system", reason: "unresolved_at_close",
        before: { writtenOff: true },
        after: { writtenOffAt: null, paymentId: pay.id, attempt: 1, chargedAmountZar: 4500, via: "lookup" },
      },
    ]);
    expect(w.lateSuccessOnWrittenOff).toHaveBeenCalledWith({
      orderId: "ord-1", paymentId: pay.id, attempt: 1, chargedAmountZar: 4500, orderTotalZar: 4500, reversed: true,
    });
  });

  it("the same through recordTenderResult (a poll read) — still only the two writers set payments.status", async () => {
    const w = world([{ outcome: "sent", yocoPaymentId: "yp-1" }]);
    await beginTender(w.deps, BARISTA, "ord-1");
    await sendToTerminal(w.deps, BARISTA, "ord-1", 1);
    w.writeOff("unresolved_at_close");
    const r = await recordTenderResult(w.deps, BARISTA, "ord-1", 1, {
      kind: "read",
      payment: { yocoPaymentId: "yp-1", clientReference: "cu-1:1", status: "successful", chargedAmountZar: 4500 },
    });
    expect(r).toEqual({ ok: true, status: "successful", flags: [] });
    expect(w.store.order("ord-1")!.writtenOff).toBe(false);
    expect(w.audits(WRITE_OFF_REVERSED_ACTION)).toHaveLength(1);
    expect(w.store.state.statusWrites).toEqual([{ id: w.store.paymentsOf("ord-1")[0].id, status: "successful" }]);
  });

  it("a deferred order whose write-off is reversed is settled by that payment (settled_at, after the write-off is cleared)", async () => {
    const w = world([{ outcome: "timeout", createdPaymentId: "yp-1", fetches: [{ status: "successful", chargedAmountZar: 4500 }] }], { deferred: true });
    await beginTender(w.deps, BARISTA, "ord-1");
    await sendToTerminal(w.deps, BARISTA, "ord-1", 1);
    w.writeOff("unresolved_at_close");
    await resolveTenderByLookup(w.deps, SYSTEM, "ord-1");
    const o = w.store.order("ord-1")!;
    expect(o.writtenOff).toBe(false);
    expect(o.settledAt).toEqual(T0);
  });

  it("while Yoco's record is still pending, the write-off stays (an open item) and nothing is sent", async () => {
    const w = world([{ outcome: "timeout", createdPaymentId: "yp-1", fetches: [{ status: "pending" }] }]);
    await beginTender(w.deps, BARISTA, "ord-1");
    await sendToTerminal(w.deps, BARISTA, "ord-1", 1);
    w.writeOff("unresolved_at_close");
    await resolveTenderByLookup(w.deps, SYSTEM, "ord-1");
    expect(w.store.order("ord-1")!.writtenOff).toBe(true);
    expect(w.store.paymentsOf("ord-1")[0].status).toBe("unresolved");
    expect(w.audits(WRITE_OFF_REVERSED_ACTION)).toHaveLength(0);
    expect(w.port.sends).toHaveLength(1);
  });

  it("a fetch error is never a status: the write-off stays", async () => {
    const w = world([{ outcome: "timeout", createdPaymentId: "yp-1", fetches: [{ fetchError: true }] }]);
    await beginTender(w.deps, BARISTA, "ord-1");
    await sendToTerminal(w.deps, BARISTA, "ord-1", 1);
    w.writeOff("unresolved_at_close");
    await resolveTenderByLookup(w.deps, SYSTEM, "ord-1");
    expect(w.store.order("ord-1")!.writtenOff).toBe(true);
    expect(w.audits(WRITE_OFF_REVERSED_ACTION)).toHaveLength(0);
  });

  it("Yoco's record confirms no payment (S4 step 3's two negatives) → declined, the write-off stands, nothing reversed or sent", async () => {
    const w = world([{ outcome: "sent", yocoPaymentId: "yp-1", fetches: [{ status: "failed" }] }]);
    await beginTender(w.deps, BARISTA, "ord-1");
    await sendToTerminal(w.deps, BARISTA, "ord-1", 1);
    w.advance(180_000);
    await resolveTenderByLookup(w.deps, SYSTEM, "ord-1"); // first negative (also passes the ceiling)
    w.writeOff("unresolved_at_close");
    w.advance(60_000);
    await resolveTenderByLookup(w.deps, SYSTEM, "ord-1"); // second negative, ≥ 60 s later
    expect(w.store.paymentsOf("ord-1")[0].status).toBe("declined");
    expect(w.store.order("ord-1")!.writtenOff).toBe(true);
    expect(w.audits(WRITE_OFF_REVERSED_ACTION)).toHaveLength(0);
    expect(w.port.sends).toHaveLength(1);
  });
});

describe("REQ-034 names one reason: every other write-off stands when money turns up", () => {
  for (const reason of [WRITE_OFF_REASONS.deferredUnsettled, WRITE_OFF_REASONS.declinedNotRetendered]) {
    it(`${reason}: payment attached, write-off NOT reversed, Admin told it stands`, async () => {
      const w = world([{ outcome: "timeout", createdPaymentId: "yp-1", fetches: [{ status: "successful", chargedAmountZar: 4500 }] }]);
      await beginTender(w.deps, BARISTA, "ord-1");
      await sendToTerminal(w.deps, BARISTA, "ord-1", 1);
      w.writeOff(reason);
      await resolveTenderByLookup(w.deps, SYSTEM, "ord-1");
      expect(w.store.paymentsOf("ord-1")[0].status).toBe("successful");
      expect(w.store.order("ord-1")!.writtenOff).toBe(true);
      expect(w.audits(WRITE_OFF_REVERSED_ACTION)).toHaveLength(0);
      expect(w.lateSuccessOnWrittenOff).toHaveBeenCalledWith(expect.not.objectContaining({ reversed: true }));
    });
  }
});

describe("the Admin alert says which happened", () => {
  const info = { orderId: "ord-1abcdef", paymentId: "pay-1", attempt: 1, chargedAmountZar: 4500, orderTotalZar: 4500 };
  it("reversed", () => {
    const a = lateSuccessOnWrittenOffAlert("ord-1abc", { ...info, reversed: true });
    expect(a.body).toContain("was charged on attempt 1 of an order the daily close wrote off. The payment is recorded; the write-off is reversed.");
    expect(a.body).not.toContain("still stands");
  });
  it("stands", () => {
    expect(lateSuccessOnWrittenOffAlert("ord-1abc", info).body).toContain("the write-off still stands");
  });
});
