// AT-207: drawFromDonorFund refuses an order the close has written off (PRD
// §10.3.3, §6.0.5): the write-off is the order's outcome, and a fund paying it
// afterwards would make the day's written-off sum drift from daily_closes.
// Refused under the order lock, before any entry is written; the refusal is
// audited. In-memory store only — never live Yoco. Amounts in integer cents.

import { describe, it, expect, vi } from "vitest";
import { FakeYocoWebPosPort } from "@/server/yoco/webpos-fake";
import { drawFromDonorFund, type StaffActor } from "@/server/funds/funds";
import type { FundDeps } from "@/server/funds/types";
import { MemoryFundStore } from "./memory-fund-store";

const LOUIS: StaffActor = { kind: "staff", staffId: "staff_louis", role: "barista" };
const T0 = new Date("2026-10-25T07:00:00.000Z");

function world(writtenOff: boolean) {
  const store = new MemoryFundStore({ customers: [] });
  const deps: FundDeps = {
    store,
    now: () => T0,
    readConfig: async () => ({ ceilingZar: 200_000, dormancyDays: 180 }),
    randomCode: () => "FVO-7K2M",
    newClientUuid: () => "cu-topup-1",
    notify: { unnamedFundCreated: vi.fn(async () => {}) },
    tender: {
      port: new FakeYocoWebPosPort(),
      readDeviceId: async () => "dev-khumo-1",
      notify: { paymentUnresolved: vi.fn(async () => {}), duplicateCharge: vi.fn(async () => {}) },
    },
  };
  const at = new Date("2026-10-01T08:00:00Z");
  store.addFund({ id: "f1", code: "FVO-AAAA", displayName: "Fund f1", at });
  store.addEntry({ fundId: "f1", kind: "top_up", amountZar: 50_000, at });
  store.state.orders.push({ id: "ord-1", state: "ordered", totalZar: 2000, paymentMode: null, customerId: null, writtenOff });
  return { store, deps };
}

describe("drawFromDonorFund on a written-off order (AT-207)", () => {
  it("→ ORDER_WRITTEN_OFF: no spend entry, payment_mode untouched, no payments row, the refusal audited", async () => {
    const w = world(true);
    const r = await drawFromDonorFund(w.deps, LOUIS, "ord-1", "f1");
    expect(r).toMatchObject({ ok: false, code: "ORDER_WRITTEN_OFF" });
    expect(w.store.entriesOf("f1").filter((e) => e.kind === "spend")).toEqual([]);
    expect(w.store.order("ord-1")).toMatchObject({ paymentMode: null, totalZar: 2000 });
    expect(w.store.allPaymentRows()).toEqual([]);
    expect(w.store.audits("fund.spend")).toEqual([]);
    expect(w.store.audits("fund.draw_rejected")).toMatchObject([
      { entityKind: "order", entityId: "ord-1", actorId: "staff_louis", reason: "order_written_off", after: { code: "ORDER_WRITTEN_OFF", fundId: "f1" } },
    ]);
  });

  it("an order that is not written off is drawn as before", async () => {
    const w = world(false);
    expect(await drawFromDonorFund(w.deps, LOUIS, "ord-1", "f1")).toMatchObject({ ok: true, amountZar: 2000, balanceAfterZar: 48_000 });
  });
});
