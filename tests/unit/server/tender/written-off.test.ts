// AT-207 — a written-off order is not tendered again (PRD §10.3.3: settled_at
// and written_off_at are mutually exclusive; §11.2 settleDeferredOrder
// "rejects an order already settled or written off"). Proven against the
// in-memory store and FakeYocoWebPosPort only — never live Yoco.

import { describe, it, expect, vi } from "vitest";
import { FakeYocoWebPosPort } from "@/server/yoco/webpos-fake";
import { beginTender, recordTenderResult, sendToTerminal } from "@/server/tender/tender";
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
      payment: { yocoPaymentId: "yp-1", clientReference: "cu-1:1", status: "successful", chargedAmountZar: 3000, tipZar: 0 },
    });
    expect(r).toEqual({ ok: true, status: "successful", flags: [] });
    expect(w.store.paymentsOf("ord-1")[0].status).toBe("successful");
  });
});
