// AT-203: the blessing fund's rules, against an in-memory store and
// FakeYocoWebPosPort only — never live Yoco. Spec: PRD v7.0 §6.10, §11.2,
// §15.1's three fund rows, L44–L47, REQ-161…177. Amounts are the PRD's own,
// in integer cents: a R20 drink is 2000, a R500 gift 50000, T13's R2,000
// ceiling 200000, the R5,000 typo 500000. Nothing is ×100.

import { describe, it, expect, vi } from "vitest";
import { FakeYocoWebPosPort, type FakeSendScript } from "@/server/yoco/webpos-fake";
import {
  addFundName,
  beginFundTender,
  compensateFundDraw,
  createDonorFund,
  drawFromDonorFund,
  fundBalanceZar,
  fundOptions,
  readFundBalance,
  sweepDonorFund,
  topUpDonorFund,
  FUND_CODE_RE,
  type StaffActor,
} from "@/server/funds/funds";
import { beginTender, pollTenderResult, resolveTenderByLookup, sendToTerminal } from "@/server/tender/tender";
import type { FundDeps, FundTx } from "@/server/funds/types";
import type { TenderDeps } from "@/server/tender/types";
import { MemoryFundStore } from "./memory-fund-store";
import { MemoryTenderStore } from "../tender/memory-store";

const LOUIS: StaffActor = { kind: "staff", staffId: "staff_louis", role: "barista" };
const ADMIN: StaffActor = { kind: "staff", staffId: "staff_admin", role: "admin" };
const T0 = new Date("2026-10-25T07:00:00.000Z"); // Sunday 09:00 SAST
const DAY = 86_400_000;

function world(opts: { sends?: FakeSendScript[]; codes?: string[]; config?: { ceilingZar: number; dormancyDays: number } | null } = {}) {
  const store = new MemoryFundStore({ customers: ["cust_thandeka", "cust_sipho", "cust_lerato", "cust_naledi"] });
  const port = new FakeYocoWebPosPort({ sends: opts.sends ?? [] });
  let now = T0;
  const codes = [...(opts.codes ?? ["FVO-7K2M", "FVO-9PQR", "FVO-3XYZ"])];
  const notify = { unnamedFundCreated: vi.fn(async () => {}) };
  const tenderNotify = { paymentUnresolved: vi.fn(async () => {}), duplicateCharge: vi.fn(async () => {}) };
  let uuid = 0;
  const deps: FundDeps = {
    store,
    now: () => now,
    readConfig: async () => (opts.config === undefined ? { ceilingZar: 200_000, dormancyDays: 180 } : opts.config),
    randomCode: () => codes.shift() ?? "FVO-ZZZZ",
    newClientUuid: () => `cu-topup-${++uuid}`,
    notify,
    tender: { port, readDeviceId: async () => "dev-khumo-1", notify: tenderNotify },
  };
  const topupDeps = (): TenderDeps => ({ store: store.topups, port, now: () => now, readDeviceId: async () => "dev-khumo-1", notify: tenderNotify });
  return {
    store, port, deps, notify, tenderNotify, topupDeps,
    advance(ms: number) { now = new Date(now.getTime() + ms); },
    addOrder(id: string, totalZar: number, customerId: string | null = null) {
      store.state.orders.push({ id, state: "ordered", totalZar, paymentMode: totalZar === 0 ? "free" : null, customerId });
    },
    balance(fundId: string) {
      return fundBalanceZar(store.entriesOf(fundId).map((e) => ({
        ...e,
        topupPayments: store.topups.paymentsOf(e.id).map((p) => ({
          status: p.status, sentAt: p.sentAt, yocoPaymentId: p.yocoPaymentId, chargedAmountZar: p.chargedAmountZar,
        })),
      })));
    },
  };
}

/** A fund for anyone holding `zar` from a cash gift recorded on 1 March. */
function openFund(w: ReturnType<typeof world>, id: string, zar: number, at = new Date("2026-10-01T08:00:00Z"), code = "FVO-AAAA") {
  w.store.addFund({ id, code, displayName: `Fund ${id}`, at });
  if (zar > 0) w.store.addEntry({ fundId: id, kind: "top_up", amountZar: zar, at });
}

// ─── money OUT ────────────────────────────────────────────────────────────────

describe("drawFromDonorFund — a tender, not a discount (L47, §6.10.5)", () => {
  it("REQ-162: settles the order at its FULL price, writes one spend entry and payment_mode, and NO payments row", async () => {
    const w = world();
    openFund(w, "f1", 50_000);
    w.addOrder("ord-1", 2000);
    const r = await drawFromDonorFund(w.deps, LOUIS, "ord-1", "f1");
    expect(r).toEqual({ ok: true, fundId: "f1", entryId: expect.any(String), amountZar: 2000, balanceAfterZar: 48_000 });
    expect(w.store.order("ord-1")).toMatchObject({ totalZar: 2000, paymentMode: "donor_fund" });
    expect(w.store.entriesOf("f1").filter((e) => e.kind === "spend")).toMatchObject([{ amountZar: -2000, orderId: "ord-1", recordedByStaffId: "staff_louis" }]);
    expect(w.store.allPaymentRows()).toEqual([]);
    expect(w.store.audits("fund.spend")).toMatchObject([{ actorId: "staff_louis", after: { orderId: "ord-1", amountZar: 2000, balanceZar: 48_000 } }]);
  });

  it("§15.1: twenty fund orders leave the payments table untouched", async () => {
    const w = world();
    openFund(w, "f1", 50_000);
    for (let i = 1; i <= 20; i++) {
      w.addOrder(`ord-${i}`, 2000);
      expect(await drawFromDonorFund(w.deps, LOUIS, `ord-${i}`, "f1")).toMatchObject({ ok: true });
    }
    expect(w.store.allPaymentRows()).toEqual([]);
    expect(w.balance("f1")).toBe(10_000);
  });

  it("REQ-163: two simultaneous draws against a fund holding one drink's worth — one succeeds, one FUND_INSUFFICIENT, never below zero", async () => {
    const w = world();
    openFund(w, "f1", 2000);
    w.addOrder("ord-a", 2000);
    w.addOrder("ord-b", 2000);
    const [a, b] = await Promise.all([
      drawFromDonorFund(w.deps, LOUIS, "ord-a", "f1"),
      drawFromDonorFund(w.deps, { ...LOUIS, staffId: "staff_thandeka" }, "ord-b", "f1"),
    ]);
    expect([a.ok, b.ok].sort()).toEqual([false, true]);
    expect([a, b].find((r) => !r.ok)).toMatchObject({ code: "FUND_INSUFFICIENT" });
    expect(w.balance("f1")).toBe(0);
    expect(w.store.entriesOf("f1").filter((e) => e.kind === "spend")).toHaveLength(1);
  });

  it("all or nothing: R18 left cannot pay a R20 drink, and nothing is written but the audited refusal", async () => {
    const w = world();
    openFund(w, "f1", 1800);
    w.addOrder("ord-1", 2000);
    const r = await drawFromDonorFund(w.deps, LOUIS, "ord-1", "f1");
    expect(r).toMatchObject({ ok: false, code: "FUND_INSUFFICIENT" });
    expect(w.store.order("ord-1")?.paymentMode).toBeNull();
    expect(w.store.entriesOf("f1")).toHaveLength(1);
    expect(w.store.audits("fund.draw_rejected")).toMatchObject([{ reason: "insufficient", after: { balanceZar: 1800, totalZar: 2000 } }]);
  });

  it("§6.10.6: no fund draw on an order with no net charge — FUND_UNAVAILABLE, named", async () => {
    const w = world();
    openFund(w, "f1", 50_000);
    w.addOrder("ord-free", 0);
    expect(await drawFromDonorFund(w.deps, LOUIS, "ord-free", "f1")).toMatchObject({ ok: false, code: "FUND_UNAVAILABLE", message: expect.stringContaining("R0") });
    expect(w.balance("f1")).toBe(50_000);
  });

  it("REQ-164: a fund with linked names refuses anyone not on the list (FUND_NOT_LINKED) and pays for a linked person", async () => {
    const w = world();
    const oct = new Date("2026-10-01T08:00:00Z");
    w.store.addFund({ id: "grp", code: "FVO-GRP2", displayName: "Thandeka's group", at: oct }, ["cust_thandeka", "cust_sipho", "cust_lerato"]);
    w.store.addEntry({ fundId: "grp", kind: "top_up", amountZar: 18_000, at: oct });
    w.addOrder("ord-4th", 2000, "cust_naledi");
    w.addOrder("ord-none", 2000, null);
    w.addOrder("ord-linked", 2000, "cust_sipho");
    expect(await drawFromDonorFund(w.deps, LOUIS, "ord-4th", "grp")).toEqual({
      ok: false, code: "FUND_NOT_LINKED", message: "This fund is for a set group — they're not on it",
    });
    expect(await drawFromDonorFund(w.deps, LOUIS, "ord-none", "grp")).toMatchObject({ ok: false, code: "FUND_NOT_LINKED" });
    expect(await drawFromDonorFund(w.deps, LOUIS, "ord-linked", "grp")).toMatchObject({ ok: true, balanceAfterZar: 16_000 });
  });

  it("an order with an open card attempt is TENDER_IN_PROGRESS; one already paid by card is ALREADY_RESOLVED", async () => {
    const w = world();
    openFund(w, "f1", 50_000);
    w.addOrder("ord-open", 2000);
    w.addOrder("ord-paid", 2000);
    w.store.state.orderAttempts.push(
      { orderId: "ord-open", attempt: 1, status: "pending", sentAt: null, yocoPaymentId: null },
      { orderId: "ord-paid", attempt: 1, status: "successful", sentAt: T0, yocoPaymentId: "yp-1" },
    );
    expect(await drawFromDonorFund(w.deps, LOUIS, "ord-open", "f1")).toMatchObject({ ok: false, code: "TENDER_IN_PROGRESS" });
    expect(await drawFromDonorFund(w.deps, LOUIS, "ord-paid", "f1")).toMatchObject({ ok: false, code: "ALREADY_RESOLVED" });
    expect(w.balance("f1")).toBe(50_000);
  });

  it("an order settled from a fund cannot be drawn again, nor tendered by card (§11.2 beginTender)", async () => {
    const w = world();
    openFund(w, "f1", 50_000);
    w.addOrder("ord-1", 2000);
    await drawFromDonorFund(w.deps, LOUIS, "ord-1", "f1");
    expect(await drawFromDonorFund(w.deps, LOUIS, "ord-1", "f1")).toMatchObject({ ok: false, code: "FUND_UNAVAILABLE" });

    const card = new MemoryTenderStore([{ id: "ord-1", state: "ordered", totalZar: 2000, clientUuid: "cu-1", fundSettled: true }]);
    const port = new FakeYocoWebPosPort();
    const r = await beginTender(
      { store: card, port, now: () => T0, readDeviceId: async () => "dev-khumo-1", notify: { paymentUnresolved: vi.fn(), duplicateCharge: vi.fn() } },
      LOUIS,
      "ord-1"
    );
    expect(r).toMatchObject({ ok: false, code: "ALREADY_RESOLVED" });
    expect(card.paymentsOf("ord-1")).toEqual([]);
    expect(port.sends).toEqual([]);
  });

  it("T14: a dormant fund is FUND_UNAVAILABLE", async () => {
    const w = world();
    openFund(w, "f1", 50_000, new Date(T0.getTime() - 181 * DAY));
    w.addOrder("ord-1", 2000);
    expect(await drawFromDonorFund(w.deps, LOUIS, "ord-1", "f1")).toMatchObject({ ok: false, code: "FUND_UNAVAILABLE", message: expect.stringContaining("dormant") });
  });
});

describe("cancelling a fund-paid order (REQ-168)", () => {
  async function cancel(w: ReturnType<typeof world>, orderId: string) {
    return w.store.transaction((tx: FundTx) => compensateFundDraw(tx, LOUIS, orderId, "customer left", T0));
  }

  it("writes a compensating adjustment restoring the pre-draw balance; the spend entry is never edited", async () => {
    const w = world();
    openFund(w, "f1", 50_000);
    w.addOrder("ord-1", 2000);
    await drawFromDonorFund(w.deps, LOUIS, "ord-1", "f1");
    const spendBefore = structuredClone(w.store.entriesOf("f1").find((e) => e.kind === "spend"));
    const adj = await cancel(w, "ord-1");
    expect(adj).toMatchObject({ kind: "adjustment", amountZar: 2000, orderId: "ord-1", reason: "customer left" });
    expect(w.balance("f1")).toBe(50_000);
    expect(w.store.entriesOf("f1").find((e) => e.kind === "spend")).toEqual(spendBefore);
    expect(w.store.audits("fund.draw_reversed")).toHaveLength(1);
  });

  it("is idempotent, and a no-op for an order the fund did not pay", async () => {
    const w = world();
    openFund(w, "f1", 50_000);
    w.addOrder("ord-1", 2000);
    w.addOrder("ord-card", 2000);
    await drawFromDonorFund(w.deps, LOUIS, "ord-1", "f1");
    await cancel(w, "ord-1");
    await cancel(w, "ord-1");
    expect(w.store.entriesOf("f1").filter((e) => e.kind === "adjustment")).toHaveLength(1);
    expect(await cancel(w, "ord-card")).toBeNull();
    expect(w.balance("f1")).toBe(50_000);
  });
});

// ─── money IN: the counter card top-up ────────────────────────────────────────

describe("beginFundTender → the unchanged tender chain (§6.10.3, REQ-173/174/175)", () => {
  it("writes a pending top_up entry and ONE payments row keyed on the top-up (own client_uuid:1), before any send", async () => {
    const w = world();
    openFund(w, "f1", 0);
    const r = await beginFundTender(w.deps, LOUIS, "f1", 50_000);
    expect(r).toMatchObject({ ok: true, attempt: 1, clientReference: "cu-topup-1:1", amountZar: 50_000 });
    const topupId = (r as { fundTopupId: string }).fundTopupId;
    expect(w.store.entriesOf("f1")).toMatchObject([{ kind: "top_up", fundingMethod: "card", amountZar: 50_000, clientUuid: "cu-topup-1" }]);
    expect(w.store.topups.paymentsOf(topupId)).toMatchObject([{ status: "pending", amountZar: 50_000, webposDeviceId: "dev-khumo-1" }]);
    expect(w.port.sends).toEqual([]);
    expect(w.balance("f1")).toBe(0);
  });

  it("§15.1 / REQ-173: a declined top-up leaves the balance at zero and the fund not drawable", async () => {
    const w = world({ sends: [{ outcome: "sent", yocoPaymentId: "yp-gift", fetches: [{ status: "failed" }] }] });
    openFund(w, "f1", 0);
    const r = (await beginFundTender(w.deps, LOUIS, "f1", 50_000)) as { fundTopupId: string };
    await sendToTerminal(w.topupDeps(), LOUIS, r.fundTopupId, 1);
    expect(await pollTenderResult(w.topupDeps(), LOUIS, r.fundTopupId, 1)).toMatchObject({ ok: false, code: "PAYMENT_DECLINED" });
    expect(w.balance("f1")).toBe(0);
    w.addOrder("ord-1", 2000);
    expect(await drawFromDonorFund(w.deps, LOUIS, "ord-1", "f1")).toMatchObject({ ok: false, code: "FUND_INSUFFICIENT" });
    expect(await readFundBalance(w.deps, "f1")).toMatchObject({ balanceZar: 0, pendingTopups: [] });
  });

  it("§15.1 / REQ-173: a timed-out top-up shows pending, contributes zero, and becomes drawable ONLY after resolveTenderByLookup confirms it", async () => {
    const w = world({ sends: [{ outcome: "timeout", createdPaymentId: "yp-late", fetches: [{ status: "successful", chargedAmountZar: 50_000 }] }] });
    openFund(w, "f1", 0);
    const r = (await beginFundTender(w.deps, LOUIS, "f1", 50_000)) as { fundTopupId: string };
    expect(await sendToTerminal(w.topupDeps(), LOUIS, r.fundTopupId, 1)).toMatchObject({ ok: false, code: "PAYMENT_UNKNOWN" });
    expect(await readFundBalance(w.deps, "f1")).toMatchObject({ balanceZar: 0, pendingTopups: [{ amountZar: 50_000, status: "unresolved" }] });
    w.addOrder("ord-1", 2000);
    expect(await drawFromDonorFund(w.deps, LOUIS, "ord-1", "f1")).toMatchObject({ ok: false, code: "FUND_INSUFFICIENT" });

    w.advance(60_000);
    const sendsBefore = w.port.sends.length;
    expect(await resolveTenderByLookup(w.topupDeps(), { kind: "system" }, r.fundTopupId)).toMatchObject({ ok: true });
    expect(w.port.sends.length).toBe(sendsBefore); // never by sending again
    expect(w.balance("f1")).toBe(50_000);
    expect(await drawFromDonorFund(w.deps, LOUIS, "ord-1", "f1")).toMatchObject({ ok: true, balanceAfterZar: 48_000 });
  });

  it("§10.2.1: only the chain's two writers set the top-up's payments.status", async () => {
    const w = world({ sends: [{ outcome: "sent", yocoPaymentId: "yp-gift", fetches: [{ status: "successful", chargedAmountZar: 50_000 }] }] });
    openFund(w, "f1", 0);
    const r = (await beginFundTender(w.deps, LOUIS, "f1", 50_000)) as { fundTopupId: string };
    await sendToTerminal(w.topupDeps(), LOUIS, r.fundTopupId, 1);
    expect(await pollTenderResult(w.topupDeps(), LOUIS, r.fundTopupId, 1)).toEqual({ ok: true, status: "successful" });
    expect(w.store.topups.state.statusWrites).toEqual([{ id: expect.any(String), status: "successful" }]);
    expect(w.balance("f1")).toBe(50_000);
  });

  it("L44: a short charge counts only what arrived — R500 tendered, R300 charged → balance R300, amount_mismatch flagged", async () => {
    const w = world({ sends: [{ outcome: "sent", yocoPaymentId: "yp-short", fetches: [{ status: "successful", chargedAmountZar: 30_000 }] }] });
    openFund(w, "f1", 0);
    const r = (await beginFundTender(w.deps, LOUIS, "f1", 50_000)) as { fundTopupId: string };
    await sendToTerminal(w.topupDeps(), LOUIS, r.fundTopupId, 1);
    expect(await pollTenderResult(w.topupDeps(), LOUIS, r.fundTopupId, 1)).toEqual({ ok: true, status: "successful" });
    expect(w.balance("f1")).toBe(30_000);
    expect((await readFundBalance(w.deps, "f1"))?.balanceZar).toBe(30_000);
    expect(w.store.topups.state.audit.filter((a) => a.action === "payment.flagged" && a.reason === "amount_mismatch")).toHaveLength(1);
  });

  it("R23 / REQ-175: R5,000 is VALIDATION — no entry, no payment row, nothing sent to the terminal", async () => {
    const w = world();
    openFund(w, "f1", 0);
    const r = await beginFundTender(w.deps, LOUIS, "f1", 500_000);
    expect(r).toMatchObject({ ok: false, code: "VALIDATION", message: expect.stringContaining("R") });
    expect(w.store.entriesOf("f1")).toEqual([]);
    expect(w.store.topups.state.payments).toEqual([]);
    expect(w.port.sends).toEqual([]);
    expect(w.store.audits("fund.topup_rejected")).toMatchObject([{ reason: "over_ceiling" }]);
  });

  it("T13 counts what the fund already holds: R1,800 held + R500 is over R2,000; R200 is exactly at it", async () => {
    const w = world();
    openFund(w, "f1", 180_000);
    expect(await beginFundTender(w.deps, LOUIS, "f1", 50_000)).toMatchObject({ ok: false, code: "VALIDATION" });
    expect(await beginFundTender(w.deps, LOUIS, "f1", 20_000)).toMatchObject({ ok: true, amountZar: 20_000 });
  });

  it("serialised per fund: a second top-up while one is open is TENDER_IN_PROGRESS", async () => {
    const w = world();
    openFund(w, "f1", 0);
    expect(await beginFundTender(w.deps, LOUIS, "f1", 50_000)).toMatchObject({ ok: true });
    expect(await beginFundTender(w.deps, LOUIS, "f1", 50_000)).toMatchObject({ ok: false, code: "TENDER_IN_PROGRESS" });
    expect(w.store.entriesOf("f1")).toHaveLength(1);
  });

  it("no machine configured: the chain refuses, the whole top-up rolls back (no entry, no payment), and the refusal is audited", async () => {
    const w = world();
    w.deps.tender.readDeviceId = async () => null;
    openFund(w, "f1", 0);
    expect(await beginFundTender(w.deps, LOUIS, "f1", 50_000)).toMatchObject({ ok: false, code: "TERMINAL_UNREACHABLE" });
    expect(w.store.entriesOf("f1")).toEqual([]);
    expect(w.store.topups.state.payments).toEqual([]);
    expect(w.store.audits("fund.topup_rejected")).toMatchObject([{ reason: "tender_refused:TERMINAL_UNREACHABLE" }]);
  });
});

// ─── money IN: the Admin's cash / EFT path ────────────────────────────────────

describe("topUpDonorFund (REQ-161)", () => {
  const base = { fundId: "f1", amountZar: 50_000, fundingMethod: "eft" as const, reference: "EFT 2026-10-24 HOFMI", reason: "gift from Mrs Meyer" };

  it("records a cash/EFT gift with its reference; it counts at once", async () => {
    const w = world();
    openFund(w, "f1", 0);
    expect(await topUpDonorFund(w.deps, ADMIN, base)).toMatchObject({ ok: true, balanceZar: 50_000 });
    expect(w.store.entriesOf("f1")).toMatchObject([{ kind: "top_up", fundingMethod: "eft", reference: "EFT 2026-10-24 HOFMI", recordedByStaffId: "staff_admin" }]);
    expect(w.store.audits("fund.topup_recorded")).toMatchObject([{ actorId: "staff_admin", reason: "gift from Mrs Meyer" }]);
  });

  for (const [label, patch] of [
    ["no funding_method", { fundingMethod: undefined }],
    ["no reference", { reference: "  " }],
    ["above T13", { amountZar: 200_001 }],
    ["card (that path is beginFundTender)", { fundingMethod: "card" }],
  ] as const) {
    it(`${label}: VALIDATION and writes NOTHING — no entry, no audit row`, async () => {
      const w = world();
      openFund(w, "f1", 0);
      const auditsBefore = w.store.state.audit.length;
      expect(await topUpDonorFund(w.deps, ADMIN, { ...base, ...patch } as typeof base)).toMatchObject({ ok: false, code: "VALIDATION" });
      expect(w.store.entriesOf("f1")).toEqual([]);
      expect(w.store.state.audit.length).toBe(auditsBefore);
    });
  }
});

// ─── createDonorFund ──────────────────────────────────────────────────────────

describe("createDonorFund (§6.10.2, §6.10.3, L45, REQ-176)", () => {
  it("REQ-176: an unnamed fund gets a unique code, an immediate Admin push naming the barista, the amount and the code, and succeeds", async () => {
    const w = world();
    const r = await createDonorFund(w.deps, LOUIS, { forSpecificPeople: false, customerIds: [], nonRefundableAcknowledged: true, amountZar: 50_000 });
    expect(r).toEqual({ ok: true, fundId: expect.any(String), code: "FVO-7K2M", displayName: null });
    expect(FUND_CODE_RE.test("FVO-7K2M")).toBe(true);
    expect(w.notify.unnamedFundCreated).toHaveBeenCalledWith({ fundId: expect.any(String), code: "FVO-7K2M", staffId: "staff_louis", amountZar: 50_000 });
  });

  it("the push failing never blocks the creation", async () => {
    const w = world();
    w.notify.unnamedFundCreated.mockRejectedValueOnce(new Error("push down"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await createDonorFund(w.deps, LOUIS, { forSpecificPeople: false, customerIds: [], nonRefundableAcknowledged: true, amountZar: 50_000 })).toMatchObject({ ok: true });
    spy.mockRestore();
  });

  it("a named fund pushes nothing; the code retries past a taken one; the acknowledgement is recorded", async () => {
    const w = world({ codes: ["FVO-7K2M", "FVO-7K2M", "FVO-9PQR"] });
    await createDonorFund(w.deps, LOUIS, { displayName: "Louis Meyer", forSpecificPeople: false, customerIds: [], nonRefundableAcknowledged: true, amountZar: 50_000 });
    const second = await createDonorFund(w.deps, LOUIS, { displayName: "Second", forSpecificPeople: false, customerIds: [], nonRefundableAcknowledged: true, amountZar: 50_000 });
    expect(second).toMatchObject({ ok: true, code: "FVO-9PQR" });
    expect(w.notify.unnamedFundCreated).not.toHaveBeenCalled();
    expect(w.store.state.funds.map((f) => f.nonRefundableAckBy)).toEqual(["staff_louis", "staff_louis"]);
  });

  it("L45: without the non-refundable acknowledgement nothing is created", async () => {
    const w = world();
    expect(await createDonorFund(w.deps, LOUIS, { forSpecificPeople: false, customerIds: [], nonRefundableAcknowledged: false, amountZar: 50_000 })).toMatchObject({ ok: false, code: "VALIDATION" });
    expect(w.store.state.funds).toEqual([]);
  });

  it("REQ-172 (application half): a person already linked to an active fund cannot be linked to a second; nothing is created", async () => {
    const w = world();
    await createDonorFund(w.deps, LOUIS, { displayName: "Group A", forSpecificPeople: true, customerIds: ["cust_thandeka"], nonRefundableAcknowledged: true, amountZar: 18_000 });
    const r = await createDonorFund(w.deps, LOUIS, { displayName: "Group B", forSpecificPeople: true, customerIds: ["cust_sipho", "cust_thandeka"], nonRefundableAcknowledged: true, amountZar: 18_000 });
    expect(r).toMatchObject({ ok: false, code: "VALIDATION" });
    expect(w.store.state.funds).toHaveLength(1);
    expect(w.store.state.members.map((m) => m.customerId)).toEqual(["cust_thandeka"]);
    expect(await addFundName(w.deps, ADMIN, w.store.state.funds[0].id, "cust_thandeka")).toMatchObject({ ok: false, code: "VALIDATION" });
  });
});

// ─── sweepDonorFund ───────────────────────────────────────────────────────────

describe("sweepDonorFund (§6.10.4, REQ-177)", () => {
  it("an Admin sweeps a dormant balance to ministry income as one audited sweep entry", async () => {
    const w = world();
    openFund(w, "f1", 34_000, new Date(T0.getTime() - 181 * DAY));
    expect(await sweepDonorFund(w.deps, ADMIN, "f1", "donor moved churches; asked, agreed")).toEqual({ ok: true, entryId: expect.any(String), sweptZar: 34_000 });
    expect(w.balance("f1")).toBe(0);
    expect(w.store.audits("fund.swept")).toMatchObject([{ actorId: "staff_admin", after: { sweptZar: 34_000, to: "ministry_income" } }]);
  });

  it("refuses a fund that is not dormant, and a sweep with no reason", async () => {
    const w = world();
    openFund(w, "f1", 34_000, new Date(T0.getTime() - 10 * DAY));
    expect(await sweepDonorFund(w.deps, ADMIN, "f1", "tidy up")).toMatchObject({ ok: false, code: "VALIDATION" });
    expect(await sweepDonorFund(w.deps, ADMIN, "f1", "  ")).toMatchObject({ ok: false, code: "VALIDATION" });
    expect(w.balance("f1")).toBe(34_000);
  });
});

// ─── the footer (§6.10.6) ─────────────────────────────────────────────────────

describe("fundOptions — oldest unspent gift first, at most two chips (REQ-169, REQ-170)", () => {
  it("§15.1: March, June and August funds — March is offered and drawn; dropped below the order, June is offered", async () => {
    const w = world();
    openFund(w, "mar", 2500, new Date("2026-03-15T08:00:00Z"), "FVO-MAR2");
    openFund(w, "jun", 50_000, new Date("2026-06-15T08:00:00Z"), "FVO-JUN2");
    openFund(w, "aug", 50_000, new Date("2026-08-15T08:00:00Z"), "FVO-AUG2");
    // keep March active within T14
    w.store.addEntry({ fundId: "mar", kind: "spend", amountZar: -500, orderId: "old", at: new Date("2026-10-01T08:00:00Z") });
    let o = await fundOptions(w.deps, { customerId: null, netZar: 2000 });
    expect(o.open).toMatchObject({ fundId: "mar", balanceZar: 2000, behind: 2 });
    w.addOrder("ord-1", 2000);
    await drawFromDonorFund(w.deps, LOUIS, "ord-1", o.open!.fundId);
    o = await fundOptions(w.deps, { customerId: null, netZar: 2000 });
    expect(o.open).toMatchObject({ fundId: "jun", behind: 1 });
    expect(o.openList.map((c) => c.fundId)).toEqual(["jun", "aug"]);
  });

  it("five funds, two linked and three open: at most two chips; the override list carries the three open ones and no linked one", async () => {
    const w = world();
    w.store.addFund({ id: "g1", code: "FVO-GGG2", at: new Date("2026-10-01T08:00:00Z") }, ["cust_thandeka"]);
    w.store.addFund({ id: "g2", code: "FVO-HHH2", at: new Date("2026-10-01T08:00:00Z") }, ["cust_sipho"]);
    for (const g of ["g1", "g2"]) w.store.addEntry({ fundId: g, kind: "top_up", amountZar: 18_000, at: new Date("2026-10-01T08:00:00Z") });
    openFund(w, "o1", 50_000, new Date("2026-10-02T08:00:00Z"), "FVO-OOO2");
    openFund(w, "o2", 50_000, new Date("2026-10-03T08:00:00Z"), "FVO-PPP2");
    openFund(w, "o3", 50_000, new Date("2026-10-04T08:00:00Z"), "FVO-QQQ2");
    const o = await fundOptions(w.deps, { customerId: "cust_thandeka", netZar: 2000 });
    expect(o.linked).toMatchObject({ fundId: "g1", lit: true, canCover: true });
    expect(o.open).toMatchObject({ fundId: "o1", behind: 2 });
    expect(o.openList.map((c) => c.fundId)).toEqual(["o1", "o2", "o3"]);
    const chips = [o.linked, o.open].filter(Boolean);
    expect(chips.length).toBeLessThanOrEqual(2);
  });

  it("L48: an order owing nothing offers no fund; a fund that cannot cover is never offered; a short linked fund is shown, not lit", async () => {
    const w = world();
    openFund(w, "small", 1000, new Date("2026-10-01T08:00:00Z"), "FVO-SSS2");
    w.store.addFund({ id: "g1", code: "FVO-GGG2", at: new Date("2026-10-01T08:00:00Z") }, ["cust_thandeka"]);
    w.store.addEntry({ fundId: "g1", kind: "top_up", amountZar: 1000, at: new Date("2026-10-01T08:00:00Z") });
    expect(await fundOptions(w.deps, { customerId: "cust_thandeka", netZar: 0 })).toEqual({ linked: null, open: null, openList: [] });
    const o = await fundOptions(w.deps, { customerId: "cust_thandeka", netZar: 2000 });
    expect(o.open).toBeNull();
    expect(o.linked).toMatchObject({ fundId: "g1", balanceZar: 1000, canCover: false, lit: false });
  });
});
