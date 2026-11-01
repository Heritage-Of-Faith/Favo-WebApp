// AT-209: compOrderLine (L33, REQ-059, REQ-152, REQ-028) and abandonOrder
// (T6 step 2b, REQ-041), and cancelOrder from in_progress on (T6, REQ-040,
// REQ-063). Every refusal is returned with its reject audit COMMITTED
// (CLAUDE.md §5, REQ-064). Integer cents; literal PRD values.

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  orders, orderItems, menuItems, payments, openingSessions, auditLog, appConfig, wasteLog, stockMovements,
} from "@db/schema";

let role: "barista" | "admin" = "barista";
vi.mock("@/server/auth/guard", () => ({
  authorize: vi.fn(async () => ({ ok: true, session: { id: role === "admin" ? "staff_admin" : "staff_louis", name: "Louis", role } })),
}));
const mockWriteAudit = vi.fn(async (..._a: unknown[]) => {});
vi.mock("@/server/audit", () => ({ writeAudit: (...a: unknown[]) => mockWriteAudit(...a) }));
const mockNotify = vi.fn(async (..._a: unknown[]) => {});
vi.mock("@/server/queue/notify", () => ({ notifyOrderChange: (...a: unknown[]) => mockNotify(...a) }));
vi.mock("@/server/tender/service", () => ({ startTender: vi.fn(), TENDER_NOT_BEGUN: {} }));
const mockAlert = vi.fn(async (..._a: unknown[]) => {});
vi.mock("@/server/push/admin-alert", () => ({ alertAdmins: (...a: unknown[]) => mockAlert(...a) }));
const mockVerifyAdminPin = vi.fn();
vi.mock("@/server/auth/admin-pin", () => ({ verifyAdminPin: (...a: unknown[]) => mockVerifyAdminPin(...a) }));

type Row = Record<string, unknown>;
let rows = new Map<unknown, Row[]>();
let updates: { table: unknown; set: Row }[] = [];
let inserts: { table: unknown; values: unknown }[] = [];
let committed = false;

function selectChain() {
  let table: unknown;
  const c: Record<string, unknown> = {};
  for (const m of ["where", "orderBy", "limit", "for", "innerJoin", "leftJoin"]) c[m] = () => c;
  c.from = (t: unknown) => { table = t; return c; };
  c.then = (resolve: (v: Row[]) => void, reject: (e: unknown) => void) =>
    Promise.resolve(rows.get(table) ?? []).then(resolve, reject);
  return c;
}
const client = {
  select: () => selectChain(),
  execute: async () => [],
  update: (table: unknown) => ({ set: (set: Row) => ({ where: async () => { updates.push({ table, set }); } }) }),
  insert: (table: unknown) => ({
    values: (values: unknown) => {
      inserts.push({ table, values });
      const p = Promise.resolve();
      return Object.assign(p, { returning: async () => [{ id: "waste-1" }] });
    },
  }),
};
vi.mock("@/lib/db", () => ({
  db: {
    select: () => client.select(),
    transaction: async (cb: (tx: unknown) => Promise<unknown>) => {
      const r = await cb(client);
      committed = true;
      return r;
    },
  },
}));

import { compOrderLine, abandonOrder } from "@/server/actions/write-downs";
import { cancelOrder } from "@/server/actions/orders";
import { revenueDay } from "@/lib/format";

const SENT = new Date("2026-10-25T07:00:00Z");
// Made at 23:50 SAST on Sunday 25 Oct; the cancel below runs on a later day.
const MADE_AT = new Date("2026-10-25T21:50:00Z");

function givenComp(o: { lines?: Row[]; payments?: Row[]; priorComps?: number; sessions?: Row[]; state?: string; totalZar?: number } = {}) {
  const lines = o.lines ?? [{ id: "line-1", orderId: "ord-1", quantity: 1, unitPriceZar: 2000, modsZar: 0, discountZar: 0, compReason: null }];
  rows = new Map<unknown, Row[]>([
    [orderItems, lines],
    [orders, [{ id: "ord-1", state: o.state ?? "ordered", totalZar: o.totalZar ?? 2000, paymentMode: null }]],
    [payments, o.payments ?? []],
    [openingSessions, o.sessions ?? [{ opensAt: "00:00" }]],
    [menuItems, [{ highest: 2500 }]],
    [appConfig, []],
    [auditLog, Array.from({ length: o.priorComps ?? 0 }, (_, i) => ({ id: `a${i}` }))],
  ]);
}

beforeEach(() => {
  vi.clearAllMocks();
  role = "barista";
  updates = [];
  inserts = [];
  committed = false;
});

function lastAudit() {
  return mockWriteAudit.mock.calls.at(-1)![0] as Row;
}

describe("compOrderLine (L33, REQ-059)", () => {
  it("comps a R20 line to R0: discount_zar and comp_reason on the line, total R0, audited with the reason", async () => {
    givenComp();
    const r = await compOrderLine("line-1", "wrong_drink");
    expect(r).toEqual({
      ok: true,
      data: { orderId: "ord-1", orderItemId: "line-1", compReason: "wrong_drink", valueZar: 2000, totalZar: 0, adminOverride: false },
    });
    expect(updates).toEqual([
      { table: orderItems, set: { discountZar: 2000, compReason: "wrong_drink" } },
      { table: orders, set: { totalZar: 0, paymentMode: "free" } },
    ]);
    expect(lastAudit()).toMatchObject({
      entityKind: "order_item", entityId: "line-1", action: "comp", actorId: "staff_louis", reason: "wrong_drink",
    });
    expect(lastAudit()).not.toHaveProperty("onBehalfOfStaffId");
    // Never creates revenue: nothing is written to payments.
    expect(inserts).toEqual([]);
  });

  it("a reason outside the closed list is refused, and the refusal is audited", async () => {
    givenComp();
    const r = await compOrderLine("line-1", "friend_of_mine");
    expect(r).toMatchObject({ ok: false, code: "VALIDATION" });
    expect(updates).toEqual([]);
    expect(lastAudit()).toMatchObject({ action: "reject", reason: "VALIDATION", entityId: "line-1" });
  });

  it("a second comp on the same order → COMP_LIMIT, audited and committed", async () => {
    givenComp({
      lines: [
        { id: "line-1", orderId: "ord-1", quantity: 1, unitPriceZar: 2000, modsZar: 0, discountZar: 0, compReason: null },
        { id: "line-2", orderId: "ord-1", quantity: 1, unitPriceZar: 2000, modsZar: 0, discountZar: 2000, compReason: "spillage" },
      ],
      totalZar: 2000,
    });
    const r = await compOrderLine("line-1", "goodwill");
    expect(r).toEqual({ ok: false, code: "COMP_LIMIT", message: "Comp limit reached — needs an admin" });
    expect(updates).toEqual([]);
    expect(lastAudit()).toMatchObject({ action: "reject", reason: "COMP_LIMIT" });
    expect(committed).toBe(true);
  });

  it("L41: a line carrying the free cup is refused", async () => {
    givenComp({ lines: [{ id: "line-1", orderId: "ord-1", quantity: 2, unitPriceZar: 2000, modsZar: 0, discountZar: 2000, compReason: null }] });
    const r = await compOrderLine("line-1", "staff_error");
    expect(r).toMatchObject({ ok: false, code: "VALIDATION" });
    expect(updates).toEqual([]);
  });

  it("over the R45-a-unit ceiling is refused", async () => {
    givenComp({ lines: [{ id: "line-1", orderId: "ord-1", quantity: 1, unitPriceZar: 2500, modsZar: 2100, discountZar: 0, compReason: null }], totalZar: 4600 });
    const r = await compOrderLine("line-1", "wrong_charge");
    expect(r).toMatchObject({ ok: false, code: "VALIDATION" });
    expect(updates).toEqual([]);
  });

  for (const [label, payment] of [
    ["begun, not yet sent", { attempt: 1, status: "pending", sentAt: null, yocoPaymentId: null }],
    ["sent and unresolved", { attempt: 1, status: "unresolved", sentAt: SENT, yocoPaymentId: null }],
  ] as const) {
    it(`REQ-028: an open attempt (${label}) → TENDER_IN_PROGRESS, audited`, async () => {
      givenComp({ payments: [{ ...payment }] });
      const r = await compOrderLine("line-1", "spillage");
      expect(r).toEqual({ ok: false, code: "TENDER_IN_PROGRESS", message: "This order is at the card machine — finish or cancel the payment first" });
      expect(updates).toEqual([]);
      expect(lastAudit()).toMatchObject({ action: "reject", reason: "TENDER_IN_PROGRESS" });
      expect(committed).toBe(true);
    });
  }

  it("a paid order is not comped (L02: the remedy is a comp on a later order)", async () => {
    givenComp({ payments: [{ attempt: 1, status: "successful", sentAt: SENT, yocoPaymentId: "yp" }] });
    const r = await compOrderLine("line-1", "wrong_charge");
    expect(r).toMatchObject({ ok: false, code: "ALREADY_RESOLVED" });
    expect(updates).toEqual([]);
  });

  it("AT-203 / REQ-167: an order settled from a blessing fund is frozen → TENDER_IN_PROGRESS, audited", async () => {
    givenComp();
    rows.set(orders, [{ id: "ord-1", state: "ordered", totalZar: 2000, paymentMode: "donor_fund" }]);
    const r = await compOrderLine("line-1", "wrong_drink");
    expect(r).toEqual({ ok: false, code: "TENDER_IN_PROGRESS", message: "This order is at the card machine — finish or cancel the payment first" });
    expect(updates).toEqual([]);
    expect(inserts).toEqual([]);
    expect(lastAudit()).toMatchObject({ action: "reject", reason: "TENDER_IN_PROGRESS" });
    expect(committed).toBe(true);
  });

  it("no session today → NO_SESSION", async () => {
    givenComp({ sessions: [] });
    expect(await compOrderLine("line-1", "goodwill")).toMatchObject({ ok: false, code: "NO_SESSION" });
  });

  it("the third comp in a session without an admin PIN → COMP_LIMIT, audited", async () => {
    givenComp({ priorComps: 2 });
    const r = await compOrderLine("line-1", "goodwill");
    expect(r).toEqual({ ok: false, code: "COMP_LIMIT", message: "Comp limit reached — needs an admin" });
    expect(updates).toEqual([]);
    expect(lastAudit()).toMatchObject({ action: "reject", reason: "COMP_LIMIT", after: expect.objectContaining({ why: "session_limit" }) });
    expect(committed).toBe(true);
  });

  it("the third comp with an admin PIN: applied, on_behalf_of_staff_id names the admin, Admin pushed", async () => {
    givenComp({ priorComps: 2 });
    mockVerifyAdminPin.mockResolvedValueOnce({ ok: true, adminStaffId: "staff_admin" });
    const r = await compOrderLine("line-1", "goodwill", "9999");
    expect(r).toMatchObject({ ok: true, data: { adminOverride: true, valueZar: 2000 } });
    expect(lastAudit()).toMatchObject({ action: "comp", actorId: "staff_louis", onBehalfOfStaffId: "staff_admin" });
    expect(mockAlert).toHaveBeenCalledTimes(1);
  });

  it("a wrong admin PIN is refused before anything is locked, and audited without the PIN", async () => {
    givenComp({ priorComps: 2 });
    mockVerifyAdminPin.mockResolvedValueOnce({ ok: false, code: "INVALID_CREDENTIALS", message: "That is not an admin PIN." });
    const r = await compOrderLine("line-1", "goodwill", "1234");
    expect(r).toMatchObject({ ok: false, code: "INVALID_CREDENTIALS" });
    expect(updates).toEqual([]);
    expect(JSON.stringify(mockWriteAudit.mock.calls)).not.toContain("1234");
  });

  it("an Admin comps a third time without a PIN", async () => {
    role = "admin";
    givenComp({ priorComps: 5 });
    expect(await compOrderLine("line-1", "donation")).toMatchObject({ ok: true });
    expect(mockVerifyAdminPin).not.toHaveBeenCalled();
  });

  it("a comp on an order that already holds a payments row is not taken to R0 (REQ-153) — VALIDATION, since no tender is open", async () => {
    givenComp({ payments: [{ attempt: 1, status: "declined", sentAt: SENT, yocoPaymentId: "yp" }] });
    expect(await compOrderLine("line-1", "wrong_drink")).toMatchObject({ ok: false, code: "VALIDATION" });
    expect(lastAudit()).toMatchObject({ action: "reject", after: expect.objectContaining({ why: "order_has_payment_rows" }) });
    expect(updates).toEqual([]);
  });

  for (const state of ["in_progress", "ready"]) {
    it(`an unpaid ${state} order with no open attempt can be comped (§11.2 names no state)`, async () => {
      givenComp({ state });
      expect(await compOrderLine("line-1", "spillage")).toMatchObject({ ok: true, data: { totalZar: 0 } });
    });
  }

  for (const state of ["cancelled", "collected"]) {
    it(`a ${state} order is refused with STALE_STATE, audited`, async () => {
      givenComp({ state });
      expect(await compOrderLine("line-1", "spillage")).toMatchObject({ ok: false, code: "STALE_STATE" });
      expect(updates).toEqual([]);
      expect(lastAudit()).toMatchObject({ action: "reject", reason: "STALE_STATE" });
    });
  }

  it("an admin PIN supplied when none is needed is never checked (no lockout count)", async () => {
    givenComp({ priorComps: 1 });
    const r = await compOrderLine("line-1", "goodwill", "1234");
    expect(r).toMatchObject({ ok: true, data: { adminOverride: false } });
    expect(mockVerifyAdminPin).not.toHaveBeenCalled();
    expect(lastAudit()).not.toHaveProperty("onBehalfOfStaffId");
  });

  it("only one of two lines comped leaves the other line charged", async () => {
    givenComp({
      lines: [
        { id: "line-1", orderId: "ord-1", quantity: 1, unitPriceZar: 2000, modsZar: 0, discountZar: 0, compReason: null },
        { id: "line-2", orderId: "ord-1", quantity: 1, unitPriceZar: 2500, modsZar: 0, discountZar: 0, compReason: null },
      ],
      totalZar: 4500,
    });
    const r = await compOrderLine("line-1", "spillage");
    expect(r).toMatchObject({ ok: true, data: { totalZar: 2500 } });
    expect(updates[1]).toEqual({ table: orders, set: { totalZar: 2500, paymentMode: null } });
  });
});

describe("abandonOrder (T6 step 2b, REQ-041)", () => {
  function givenOrder(state: string) {
    rows = new Map<unknown, Row[]>([
      [orders, [{ id: "ord-1", state, totalZar: 4000 }]],
      [orderItems, [{ quantity: 2 }]],
    ]);
  }

  it("writes waste_log (abandoned, order_id, reason), releases the slot, audits an override; no stock or payment write", async () => {
    givenOrder("in_progress");
    const r = await abandonOrder("ord-1", "Customer left");
    expect(r).toEqual({ ok: true, data: { wasteLogId: "waste-1" } });
    expect(inserts).toEqual([{
      table: wasteLog,
      values: { category: "abandoned", orderId: "ord-1", inventoryLotId: null, quantity: 2, reason: "Customer left", byStaffId: "staff_louis" },
    }]);
    expect(updates).toEqual([{ table: orders, set: { state: "cancelled" } }]);
    expect(mockWriteAudit.mock.calls.map((c) => (c[0] as Row).action)).toEqual(["create", "override"]);
    expect(lastAudit()).toMatchObject({ entityKind: "order", entityId: "ord-1", action: "override", reason: "Customer left" });
    expect(mockNotify).toHaveBeenCalledWith(expect.objectContaining({ orderId: "ord-1", state: "cancelled" }));
    expect(mockVerifyAdminPin).not.toHaveBeenCalled();
  });

  it("the reason is mandatory", async () => {
    givenOrder("in_progress");
    expect(await abandonOrder("ord-1", "  ")).toMatchObject({ ok: false, code: "VALIDATION" });
    expect(inserts).toEqual([]);
    expect(lastAudit()).toMatchObject({ action: "reject" });
  });

  for (const [label, payment] of [
    ["begun, not yet sent", { attempt: 1, status: "pending", sentAt: null, yocoPaymentId: null }],
    ["sent and unresolved", { attempt: 1, status: "unresolved", sentAt: SENT, yocoPaymentId: null }],
  ] as const) {
    it(`REQ-028: an open attempt (${label}) → TENDER_IN_PROGRESS, nothing written, refusal audited and committed`, async () => {
      givenOrder("in_progress");
      rows.set(payments, [{ ...payment }]);
      const r = await abandonOrder("ord-1", "Customer left");
      expect(r).toEqual({ ok: false, code: "TENDER_IN_PROGRESS", message: "This order is at the card machine — finish or cancel the payment first" });
      expect(inserts).toEqual([]);
      expect(updates).toEqual([]);
      expect(lastAudit()).toMatchObject({ action: "reject", reason: "TENDER_IN_PROGRESS", entityId: "ord-1" });
      expect(committed).toBe(true);
    });
  }

  it("a paid order (successful attempt) is abandoned; the payment is untouched (L02)", async () => {
    givenOrder("in_progress");
    rows.set(payments, [{ attempt: 1, status: "successful", sentAt: SENT, yocoPaymentId: "yp" }]);
    expect(await abandonOrder("ord-1", "Customer left")).toMatchObject({ ok: true });
    expect(updates).toEqual([{ table: orders, set: { state: "cancelled" } }]);
  });

  it("an order not yet started is cancelled, not abandoned — refused and audited", async () => {
    givenOrder("ordered");
    expect(await abandonOrder("ord-1", "left")).toMatchObject({ ok: false, code: "STALE_STATE" });
    expect(inserts).toEqual([]);
    expect(updates).toEqual([]);
    expect(lastAudit()).toMatchObject({ action: "reject", reason: "STALE_STATE" });
    expect(committed).toBe(true);
  });
});

describe("cancelOrder from in_progress on (T6, REQ-040, REQ-063)", () => {
  function givenStarted(state = "in_progress") {
    rows = new Map<unknown, Row[]>([
      [orders, [{ id: "ord-1", state, totalZar: 2000 }]],
      [payments, [{ attempt: 1, status: "successful", sentAt: SENT, yocoPaymentId: "yp" }]],
      [stockMovements, [
        { inventoryLotId: "lot-beans", delta: -1, menuItemId: "mi-cap", at: MADE_AT },
        { inventoryLotId: "lot-cup", delta: -1, menuItemId: "mi-cap", at: MADE_AT },
      ]],
    ]);
  }

  it("a barista without an admin PIN → FORBIDDEN with the T6 copy; nothing changes; the refusal commits", async () => {
    givenStarted();
    const r = await cancelOrder("ord-1", "Wrong order");
    expect(r).toEqual({ ok: false, code: "FORBIDDEN", message: "Cancelling a started order reverses stock. Needs an admin." });
    expect(updates).toEqual([]);
    expect(inserts).toEqual([]);
    expect(lastAudit()).toMatchObject({ action: "reject", entityId: "ord-1" });
    expect(committed).toBe(true);
  });

  it("with an admin PIN: compensating stock rows (originals untouched), cancelled, on_behalf_of_staff_id = the admin; payments untouched (L02)", async () => {
    givenStarted();
    mockVerifyAdminPin.mockResolvedValueOnce({ ok: true, adminStaffId: "staff_admin" });
    const r = await cancelOrder("ord-1", "Wrong order", "9999");
    expect(r).toEqual({ ok: true, data: undefined });
    expect(inserts).toEqual([{
      table: stockMovements,
      values: [
        { inventoryLotId: "lot-beans", delta: 1, kind: "deduction", relatedOrderId: "ord-1", menuItemId: "mi-cap", byStaffId: "staff_louis", at: MADE_AT },
        { inventoryLotId: "lot-cup", delta: 1, kind: "deduction", relatedOrderId: "ord-1", menuItemId: "mi-cap", byStaffId: "staff_louis", at: MADE_AT },
      ],
    }]);
    // Only the order row is updated: no stock_movements or payments update.
    expect(updates).toEqual([{ table: orders, set: { state: "cancelled" } }]);
    expect(lastAudit()).toMatchObject({ action: "cancel", actorId: "staff_louis", onBehalfOfStaffId: "staff_admin" });
  });

  it("across a day boundary: a Monday cancel of a Sunday 23:50 drink stamps the reversal on Sunday's SAST day", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-26T08:00:00Z")); // Monday 10:00 SAST
    try {
      role = "admin";
      givenStarted();
      expect(await cancelOrder("ord-1", "Wrong order")).toEqual({ ok: true, data: undefined });
      const values = inserts[0].values as { at: Date }[];
      expect(values.map((v) => revenueDay(v.at))).toEqual(["2026-10-25", "2026-10-25"]);
      expect(revenueDay(new Date())).toBe("2026-10-26");
    } finally {
      vi.useRealTimers();
    }
  });

  it("a wrong admin PIN is refused and audited without the PIN", async () => {
    givenStarted();
    mockVerifyAdminPin.mockResolvedValueOnce({ ok: false, code: "RATE_LIMITED", message: "Too many wrong admin PINs. Try again in 5 minutes." });
    const r = await cancelOrder("ord-1", "Wrong order", "1111");
    expect(r).toMatchObject({ ok: false, code: "RATE_LIMITED" });
    expect(updates).toEqual([]);
    expect(lastAudit()).toMatchObject({ action: "reject", reason: "RATE_LIMITED" });
    expect(JSON.stringify(mockWriteAudit.mock.calls)).not.toContain("1111");
  });

  it("an Admin cancels a started order without a PIN, and the stock is still compensated", async () => {
    role = "admin";
    givenStarted("ready");
    expect(await cancelOrder("ord-1", "Wrong order")).toEqual({ ok: true, data: undefined });
    expect(inserts).toHaveLength(1);
    expect(lastAudit()).not.toHaveProperty("onBehalfOfStaffId");
  });

  it("an already-cancelled order is refused and the refusal is audited", async () => {
    givenStarted("cancelled");
    expect(await cancelOrder("ord-1", "x")).toMatchObject({ ok: false, code: "CONFLICT" });
    expect(lastAudit()).toMatchObject({ action: "reject", reason: "CONFLICT" });
    expect(committed).toBe(true);
  });
});
