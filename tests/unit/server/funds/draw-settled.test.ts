// drawFromDonorFund refuses a deferred order already settled on the standalone
// machine (PRD v7.0 §6.7 path B, §10.3 settled_at, S1 ALREADY_RESOLVED
// "Already paid — do not charge again"). Literal scenario: the order is
// slip-settled with settleDeferredOrder, then a fund draw is tried — refused,
// no fund debit, payment_mode not flipped. In-memory stores only; integer cents.

import { describe, it, expect, vi } from "vitest";
import { FakeYocoWebPosPort } from "@/server/yoco/webpos-fake";
import { drawFromDonorFund, type StaffActor } from "@/server/funds/funds";
import type { FundDeps } from "@/server/funds/types";
import type { TenderDeps } from "@/server/tender/types";
import { settleDeferredOrder } from "@/server/deferred/settle";
import { MemoryTenderStore } from "../tender/memory-store";
import { MemoryFundStore } from "./memory-fund-store";

const LOUIS: StaffActor = { kind: "staff", staffId: "staff_louis", role: "barista" };
const T0 = new Date("2026-11-08T07:00:00.000Z");

describe("drawFromDonorFund on a slip-settled deferred order", () => {
  it("slip-settle first, then a fund draw → ALREADY_RESOLVED; no spend entry, balance unchanged, payment_mode stays 'yoco_deferred'", async () => {
    // 1. The slip settle, through the real settleDeferredOrder.
    const tenderStore = new MemoryTenderStore([
      { id: "ord-1", state: "ordered", totalZar: 4500, clientUuid: "cu-1", deferred: true, settledAt: null },
    ]);
    const tenderDeps: TenderDeps = {
      store: tenderStore, port: new FakeYocoWebPosPort(), now: () => T0,
      readDeviceId: async () => "dev-khumo-1",
      notify: { paymentUnresolved: vi.fn(async () => {}), duplicateCharge: vi.fn(async () => {}), standaloneSettled: vi.fn(async () => {}) },
    };
    expect(await settleDeferredOrder(tenderDeps, LOUIS, "ord-1", "SLIP-4471")).toMatchObject({ ok: true, path: "standalone" });
    const settledAt = tenderStore.order("ord-1")!.settledAt!;

    // 2. The same order, as the fund store's lockOrder reads it.
    const store = new MemoryFundStore({ customers: [] });
    const deps: FundDeps = {
      store, now: () => T0,
      readConfig: async () => ({ ceilingZar: 200_000, dormancyDays: 180 }),
      randomCode: () => "FVO-7K2M", newClientUuid: () => "cu-topup-1",
      notify: { unnamedFundCreated: vi.fn(async () => {}) },
      tender: { port: new FakeYocoWebPosPort(), readDeviceId: async () => "dev-khumo-1", notify: tenderDeps.notify },
    };
    const at = new Date("2026-10-01T08:00:00Z");
    store.addFund({ id: "f1", code: "FVO-AAAA", displayName: "Fund f1", at });
    store.addEntry({ fundId: "f1", kind: "top_up", amountZar: 50_000, at });
    store.state.orders.push({ id: "ord-1", state: "ordered", totalZar: 4500, paymentMode: "yoco_deferred", customerId: null, writtenOff: false, settledAt });

    const r = await drawFromDonorFund(deps, LOUIS, "ord-1", "f1");
    expect(r).toEqual({ ok: false, code: "ALREADY_RESOLVED", message: "Already paid — do not charge again" });
    expect(store.entriesOf("f1").filter((e) => e.kind === "spend")).toEqual([]);
    expect(store.entriesOf("f1").reduce((s, e) => s + e.amountZar, 0)).toBe(50_000);
    expect(store.order("ord-1")).toMatchObject({ paymentMode: "yoco_deferred", totalZar: 4500 });
    expect(store.audits("fund.draw_rejected")).toMatchObject([{ reason: "already_settled", after: { code: "ALREADY_RESOLVED" } }]);
  });
});
