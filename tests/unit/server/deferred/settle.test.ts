// settleDeferredOrder — PRD v7.0 §6.0.4 T3 steps 3a/3b, §6.7 paths A and B,
// §11.2 ("Queries Yoco before it sends (T3 3a). Rejects an order already
// settled or written off. Audited"), S1 ALREADY_RESOLVED ("Already paid — do
// not charge again"), §10.2.1 (exactly two writers of payments.status), §10.3
// (settled_at and written_off_at mutually exclusive), §15 "Deferred
// settlement" ("a settle on an order whose earlier payment actually succeeded
// is refused with ALREADY_RESOLVED"). FakeYocoWebPosPort only — never Yoco.
// Integer cents: R30.00 is 3000.

import { describe, it, expect, vi } from "vitest";
import { FakeYocoWebPosPort, type FakeSendScript } from "@/server/yoco/webpos-fake";
import { beginTender, pollTenderResult, resolveTenderByLookup, sendToTerminal } from "@/server/tender/tender";
import type { TenderActor, TenderDeps, TenderOrder } from "@/server/tender/types";
import { settleDeferredOrder } from "@/server/deferred/settle";
import { MemoryTenderStore } from "../tender/memory-store";

const BARISTA: TenderActor = { kind: "staff", staffId: "staff_thandeka", role: "barista" };
const T0 = new Date("2026-11-08T07:00:00.000Z"); // Sunday 09:00 SAST

function world(order: Partial<TenderOrder> = {}, sends: FakeSendScript[] = [], extra: TenderOrder[] = []) {
  const store = new MemoryTenderStore([
    { id: "ord-1", state: "ordered", totalZar: 3000, clientUuid: "cu-1", deferred: true, settledAt: null, ...order },
    ...extra,
  ]);
  const port = new FakeYocoWebPosPort({ sends });
  let now = T0;
  const standaloneSettled = vi.fn(async (_info: { orderId: string; amountZar: number; settlementRef: string; staffId: string | null }) => {});
  const deps: TenderDeps = {
    store,
    port,
    now: () => now,
    readDeviceId: vi.fn(async () => "dev-khumo-1"),
    notify: { paymentUnresolved: vi.fn(async () => {}), duplicateCharge: vi.fn(async () => {}), standaloneSettled },
  };
  return {
    store,
    port,
    deps,
    standaloneSettled,
    advance(ms: number) { now = new Date(now.getTime() + ms); },
    order: () => store.order("ord-1")!,
    audits: (action: string) => store.state.audit.filter((a) => a.action === action),
  };
}

describe("T3 3b / §6.7 path B — the standalone machine's reference", () => {
  it("stamps settled_at and settlement_ref on the ORDER; writes no payments row and no payment status", async () => {
    const w = world();
    const r = await settleDeferredOrder(w.deps, BARISTA, "ord-1", "  TXN-88341 ");
    expect(r).toEqual({ ok: true, path: "standalone", settledAt: T0, settlementRef: "TXN-88341" });
    expect(w.order().settledAt).toEqual(T0);
    expect(w.store.state.settlementRefs["ord-1"]).toBe("TXN-88341");
    expect(w.store.state.payments).toEqual([]);
    expect(w.store.state.statusWrites).toEqual([]);
    expect(w.port.sends).toEqual([]);
    expect(w.audits("order.settled")).toMatchObject([
      { entityKind: "order", entityId: "ord-1", actorId: "staff_thandeka", actorRole: "barista",
        after: { path: "standalone", settlementRef: "TXN-88341", settledAt: T0.toISOString() } },
    ]);
  });

  it("an empty reference is VALIDATION, audited, and nothing is settled", async () => {
    const w = world();
    const r = await settleDeferredOrder(w.deps, BARISTA, "ord-1", "   ");
    expect(r).toMatchObject({ ok: false, code: "VALIDATION" });
    expect(w.order().settledAt).toBeNull();
    expect(w.audits("order.settle_rejected")).toHaveLength(1);
  });

  it("a reference needs at least 4 non-space characters; spaces are trimmed and collapsed", async () => {
    const w = world();
    expect(await settleDeferredOrder(w.deps, BARISTA, "ord-1", " A B 1 ")).toMatchObject({
      ok: false, code: "VALIDATION", message: "Enter the slip's reference — at least 4 characters.",
    });
    const r = await settleDeferredOrder(w.deps, BARISTA, "ord-1", "  AB   12 ");
    expect(r).toMatchObject({ ok: true, path: "standalone", settlementRef: "AB 12" });
    expect(w.store.state.settlementRefs["ord-1"]).toBe("AB 12");
  });

  it("a reference already on another order is refused, audited, and settles nothing", async () => {
    const w = world({}, [], [{ id: "ord-2", state: "ordered", totalZar: 2000, clientUuid: "cu-2", deferred: true, settledAt: null }]);
    expect((await settleDeferredOrder(w.deps, BARISTA, "ord-2", "TXN-777")).ok).toBe(true);
    const r = await settleDeferredOrder(w.deps, BARISTA, "ord-1", "  TXN-777 ");
    expect(r).toEqual({ ok: false, code: "VALIDATION", message: "This reference is already on another order — check the slip." });
    expect(w.order().settledAt).toBeNull();
    expect(w.audits("order.settle_rejected")).toMatchObject([{ reason: "settlement_ref_in_use" }]);
  });

  it("a unique-index refusal from the database (two settles racing on one slip) becomes the same refusal", async () => {
    const w = world();
    const inner = w.store.transaction.bind(w.store);
    // Simulate the race: the pre-check sees nothing, the index then refuses the write.
    w.deps.store = {
      transaction: (fn) => inner((tx) => fn({ ...tx, settlementRefTaken: async () => false, markOrderSettled: async () => {
        throw Object.assign(new Error("duplicate key"), { constraint_name: "orders_settlement_ref_unique" });
      } })),
    };
    const r = await settleDeferredOrder(w.deps, BARISTA, "ord-1", "TXN-RACE");
    expect(r).toMatchObject({ ok: false, code: "VALIDATION", message: "This reference is already on another order — check the slip." });
    expect(w.standaloneSettled).not.toHaveBeenCalled();
  });

  it("EVERY path-B settle pushes the Admin: the order, the amount, the reference and the barista", async () => {
    const w = world();
    await settleDeferredOrder(w.deps, BARISTA, "ord-1", "TXN-88341");
    expect(w.standaloneSettled).toHaveBeenCalledTimes(1);
    expect(w.standaloneSettled).toHaveBeenCalledWith({ orderId: "ord-1", amountZar: 3000, settlementRef: "TXN-88341", staffId: "staff_thandeka" });
  });

  it("a failed push never undoes the settle; the audit row stands", async () => {
    const w = world();
    w.standaloneSettled.mockRejectedValueOnce(new Error("push down"));
    vi.spyOn(console, "error").mockImplementationOnce(() => {});
    const r = await settleDeferredOrder(w.deps, BARISTA, "ord-1", "TXN-88341");
    expect(r).toMatchObject({ ok: true, path: "standalone" });
    expect(w.order().settledAt).toEqual(T0);
    expect(w.audits("order.settled")).toHaveLength(1);
  });

  it("path A pushes nothing on the standalone channel", async () => {
    const w = world();
    expect(await settleDeferredOrder(w.deps, BARISTA, "ord-1")).toMatchObject({ ok: true, path: "card" });
    expect(w.standaloneSettled).not.toHaveBeenCalled();
  });
});

describe("double charge: a path-B settled order is never charged again", () => {
  it("beginTender refuses a settled order ALREADY_RESOLVED 'Already paid — do not charge again'; no payments row", async () => {
    const w = world();
    await settleDeferredOrder(w.deps, BARISTA, "ord-1", "TXN-1");
    const r = await beginTender(w.deps, BARISTA, "ord-1");
    expect(r).toEqual({ ok: false, code: "ALREADY_RESOLVED", message: "Already paid — do not charge again" });
    expect(w.store.state.payments).toEqual([]);
    expect(w.audits("payment.tender_rejected")).toMatchObject([{ reason: "already_settled" }]);
  });

  it("the race: path B commits between path A's decision and its beginTender — path A is refused, nothing begun or sent", async () => {
    const w = world();
    const inner = w.store.transaction.bind(w.store);
    const innerDeps: TenderDeps = { ...w.deps, store: { transaction: inner } };
    let calls = 0;
    let pathB: Awaited<ReturnType<typeof settleDeferredOrder>> | null = null;
    // Path A's transactions: 1 lock/read, 2 lookup read, 3 decide, 4 beginTender.
    // Before the 4th, a second barista's path B settle runs to completion.
    w.deps.store = {
      transaction: async (fn) => {
        calls += 1;
        if (calls === 4) pathB = await settleDeferredOrder(innerDeps, { kind: "staff", staffId: "staff_nkuli", role: "barista" }, "ord-1", "TXN-RACE-B");
        return inner(fn);
      },
    };
    const pathA = await settleDeferredOrder(w.deps, BARISTA, "ord-1");
    expect(pathB).toMatchObject({ ok: true, path: "standalone" });
    expect(pathA).toEqual({ ok: false, code: "ALREADY_RESOLVED", message: "Already paid — do not charge again" });
    expect(w.store.state.payments).toEqual([]);
    expect(w.port.sends).toEqual([]);
  });

  it("the other order: path A's attempt begun first blocks path B (TENDER_IN_PROGRESS)", async () => {
    const w = world();
    expect(await settleDeferredOrder(w.deps, BARISTA, "ord-1")).toMatchObject({ ok: true, path: "card", attempt: 1 });
    expect(await settleDeferredOrder(w.deps, BARISTA, "ord-1", "TXN-LATE")).toMatchObject({ ok: false, code: "TENDER_IN_PROGRESS" });
    expect(w.order().settledAt).toBeNull();
  });

  it("a card success that lands on a slip-settled order is recorded as Yoco reports it, flagged duplicate_charge_after_slip_settle and pushed", async () => {
    const w = world({}, [{ outcome: "timeout", createdPaymentId: "yp-late", fetches: [{ status: "successful", chargedAmountZar: 3000 }] }]);
    await beginTender(w.deps, BARISTA, "ord-1");
    await sendToTerminal(w.deps, BARISTA, "ord-1", 1);
    const slipAt = new Date(T0.getTime() + 10_000);
    w.order().settledAt = slipAt; // the slip settle happened (edge: the attempt was already out)
    await resolveTenderByLookup(w.deps, { kind: "system" }, "ord-1");
    expect(w.store.paymentsOf("ord-1")[0]).toMatchObject({ status: "successful", chargedAmountZar: 3000 });
    expect(w.order().settledAt).toEqual(slipAt);
    expect(w.audits("duplicate_charge_after_slip_settle")).toMatchObject([
      { entityKind: "order", entityId: "ord-1", reason: "duplicate_charge_after_slip_settle", after: { chargedAmountZar: 3000 } },
    ]);
    expect(w.audits("order.settled")).toEqual([]);
    expect(w.deps.notify.duplicateCharge).toHaveBeenCalledWith({
      orderId: "ord-1", yocoPaymentIds: [`slip-settled ${slipAt.toISOString()}`, "yp-late"], amountZar: 3000,
    });
  });

  it("sendToTerminal refuses an attempt on an order that became settled", async () => {
    const w = world();
    await beginTender(w.deps, BARISTA, "ord-1");
    w.order().settledAt = T0; // defence in depth: cannot happen through settleDeferredOrder
    expect(await sendToTerminal(w.deps, BARISTA, "ord-1", 1)).toMatchObject({ ok: false, code: "ALREADY_RESOLVED" });
    expect(w.port.sends).toEqual([]);
  });
});

describe("§11.2: rejects an order already settled or written off (S1 ALREADY_RESOLVED)", () => {
  it("a second settle is refused 'Already paid — do not charge again', naming when, and audited", async () => {
    const w = world();
    await settleDeferredOrder(w.deps, BARISTA, "ord-1", "TXN-1");
    w.advance(60_000);
    const r = await settleDeferredOrder(w.deps, BARISTA, "ord-1", "TXN-2");
    expect(r).toEqual({ ok: false, code: "ALREADY_RESOLVED", message: "Already paid — do not charge again", settledAt: T0 });
    expect(w.store.state.settlementRefs["ord-1"]).toBe("TXN-1");
    expect(w.audits("order.settle_rejected")).toMatchObject([{ reason: "already_settled", after: { code: "ALREADY_RESOLVED" } }]);
  });

  it("a written-off order is refused ALREADY_RESOLVED and never settled (settled_at and written_off_at are exclusive)", async () => {
    const w = world({ writtenOff: true });
    const r = await settleDeferredOrder(w.deps, BARISTA, "ord-1", "TXN-1");
    expect(r).toMatchObject({ ok: false, code: "ALREADY_RESOLVED", message: "Already paid — do not charge again" });
    expect(w.order().settledAt).toBeNull();
    expect(w.store.state.payments).toEqual([]);
  });

  it("an order not taken in deferred mode is not settled here", async () => {
    const w = world({ deferred: false });
    const r = await settleDeferredOrder(w.deps, BARISTA, "ord-1", "TXN-1");
    expect(r).toMatchObject({ ok: false, code: "VALIDATION" });
    expect(w.order().settledAt).toBeNull();
  });
});

describe("T3 3a — query before sending: the guard is the query, not FAVO's own rows", () => {
  // An earlier attempt timed out (PAYMENT_UNKNOWN), FAVO holds it `unresolved`,
  // but Yoco has it `successful`. The barista taps Settle.
  const lostSuccess: FakeSendScript[] = [
    { outcome: "timeout", createdPaymentId: "yp-lost", fetches: [{ status: "successful", chargedAmountZar: 3000 }] },
  ];

  async function earlierAttemptTimedOut(w: ReturnType<typeof world>) {
    expect((await beginTender(w.deps, BARISTA, "ord-1")).ok).toBe(true);
    expect(await sendToTerminal(w.deps, BARISTA, "ord-1", 1)).toMatchObject({ ok: false, code: "PAYMENT_UNKNOWN" });
    expect(w.store.paymentsOf("ord-1")[0].status).toBe("unresolved");
  }

  it("path A: refused ALREADY_RESOLVED, the payment attached, settled_at stamped, and NOTHING sent again", async () => {
    const w = world({}, lostSuccess);
    await earlierAttemptTimedOut(w);
    w.advance(30_000);
    const r = await settleDeferredOrder(w.deps, BARISTA, "ord-1");
    expect(r).toMatchObject({ ok: false, code: "ALREADY_RESOLVED", message: "Already paid — do not charge again" });
    expect(w.port.sends).toHaveLength(1);
    expect(w.store.paymentsOf("ord-1")).toHaveLength(1);
    expect(w.store.paymentsOf("ord-1")[0]).toMatchObject({ status: "successful", chargedAmountZar: 3000, yocoPaymentId: "yp-lost" });
    expect(w.order().settledAt).toEqual(new Date(T0.getTime() + 30_000));
    expect(w.audits("order.settled")).toMatchObject([{ after: { path: "card", via: "lookup" } }]);
  });

  it("path B: the same lookup runs first — a standalone settle is refused when Yoco already holds the money", async () => {
    const w = world({}, lostSuccess);
    await earlierAttemptTimedOut(w);
    const r = await settleDeferredOrder(w.deps, BARISTA, "ord-1", "TXN-DOUBLE");
    expect(r).toMatchObject({ ok: false, code: "ALREADY_RESOLVED" });
    // Settled by the attached card payment, never by the barista's reference.
    expect(w.store.state.settlementRefs["ord-1"]).toBeNull();
    expect(w.audits("order.settled")).toMatchObject([{ after: { path: "card", via: "lookup" } }]);
    expect(w.store.paymentsOf("ord-1")[0].status).toBe("successful");
  });

  it("an attempt still pending at Yoco blocks both paths with TENDER_IN_PROGRESS; nothing new is begun", async () => {
    const w = world({}, [{ outcome: "timeout", createdPaymentId: "yp-1", fetches: [{ status: "pending" }] }]);
    await earlierAttemptTimedOut(w);
    for (const ref of [undefined, "TXN-1"]) {
      const r = await settleDeferredOrder(w.deps, BARISTA, "ord-1", ref);
      expect(r).toMatchObject({ ok: false, code: "TENDER_IN_PROGRESS" });
    }
    expect(w.store.paymentsOf("ord-1")).toHaveLength(1);
    expect(w.order().settledAt).toBeNull();
  });

  it("S4 step 3: only after two negatives ≥ 60 s apart and ≥ 120 s after the send does path A begin a NEW attempt", async () => {
    const w = world({}, [{ outcome: "timeout", createdPaymentId: "yp-1", fetches: [{ status: "failed" }] }]);
    await earlierAttemptTimedOut(w);
    w.advance(60_000);
    expect(await settleDeferredOrder(w.deps, BARISTA, "ord-1")).toMatchObject({ ok: false, code: "TENDER_IN_PROGRESS" });
    w.advance(60_000); // 120 s after the send, 60 s after the first negative
    const r = await settleDeferredOrder(w.deps, BARISTA, "ord-1");
    expect(r).toEqual({ ok: true, path: "card", attempt: 2, amountZar: 3000 });
    expect(w.store.paymentsOf("ord-1").map((p) => p.status)).toEqual(["declined", "pending"]);
    expect(w.port.sends).toHaveLength(1); // begun, not sent: the screen sends it
  });
});

describe("T3 3a — the machine answers again: a fresh attempt through the existing chain", () => {
  it("no earlier attempt: begins attempt 1; a successful poll stamps settled_at (writer 1 sets the status)", async () => {
    const w = world({}, [{ outcome: "sent", yocoPaymentId: "yp-1", fetches: [{ status: "successful", chargedAmountZar: 3000 }] }]);
    const r = await settleDeferredOrder(w.deps, BARISTA, "ord-1");
    expect(r).toEqual({ ok: true, path: "card", attempt: 1, amountZar: 3000 });
    expect(w.order().settledAt).toBeNull();

    await sendToTerminal(w.deps, BARISTA, "ord-1", 1);
    w.advance(2_000);
    expect(await pollTenderResult(w.deps, BARISTA, "ord-1", 1)).toEqual({ ok: true, status: "successful" });
    expect(w.order().settledAt).toEqual(new Date(T0.getTime() + 2_000));
    expect(w.store.state.settlementRefs["ord-1"]).toBeNull();
    expect(w.store.state.statusWrites).toEqual([{ id: w.store.paymentsOf("ord-1")[0].id, status: "successful" }]);
    expect(w.audits("order.settled")).toMatchObject([{ after: { path: "card", attempt: 1, via: "poll" } }]);
  });

  it("a successful payment on a NON-deferred order never stamps settled_at", async () => {
    const w = world({ deferred: false }, [{ outcome: "sent", yocoPaymentId: "yp-1", fetches: [{ status: "successful", chargedAmountZar: 3000 }] }]);
    await beginTender(w.deps, BARISTA, "ord-1");
    await sendToTerminal(w.deps, BARISTA, "ord-1", 1);
    await pollTenderResult(w.deps, BARISTA, "ord-1", 1);
    expect(w.order().settledAt).toBeNull();
    expect(w.audits("order.settled")).toEqual([]);
  });

  it("a late success on a written-off deferred order is recorded but never stamps settled_at", async () => {
    const w = world({}, [{ outcome: "timeout", createdPaymentId: "yp-1", fetches: [{ status: "successful", chargedAmountZar: 3000 }] }]);
    await beginTender(w.deps, BARISTA, "ord-1");
    await sendToTerminal(w.deps, BARISTA, "ord-1", 1);
    w.order().writtenOff = true;
    await resolveTenderByLookup(w.deps, { kind: "system" }, "ord-1");
    expect(w.store.paymentsOf("ord-1")[0].status).toBe("successful");
    expect(w.order().settledAt).toBeNull();
  });
});
