// A slip-settled deferred order's total is frozen (PRD v7.0 §6.7 path B, §10.3
// settled_at, REQ-167 / P4 — the same freeze a fund-settled order gets). Literal
// scenario: an order settled on the standalone machine at R45.00 (4500) whose
// free cup would, if declined, take it back to its R80.00 gross (8000). Every
// total-changing path is refused with the lock's own code; nothing is written.
//
// The DB is mocked as in free-cup-actions.test.ts: selects resolve rows by table.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { orders, orderItems, payments, staffEntitlementLog, voucherRedemptions } from "@db/schema";

vi.mock("@/server/auth/guard", () => ({
  authorize: vi.fn(async () => ({ ok: true, session: { id: "staff_louis", role: "barista" } })),
}));
const mockWriteAudit = vi.fn(async (..._a: unknown[]) => {});
vi.mock("@/server/audit", () => ({ writeAudit: (...a: unknown[]) => mockWriteAudit(...a) }));
vi.mock("@/server/queue/notify", () => ({ notifyOrderChange: vi.fn(async () => {}) }));

type Row = Record<string, unknown>;
let rows = new Map<unknown, Row[]>();
const writes: { kind: string; table: unknown; v?: unknown }[] = [];
let paymentsRead = 0;

function selectChain() {
  let table: unknown;
  const c: Record<string, unknown> = {};
  for (const m of ["where", "innerJoin", "leftJoin", "orderBy", "limit", "for", "groupBy"]) c[m] = () => c;
  c.from = (t: unknown) => { table = t; if (t === payments) paymentsRead += 1; return c; };
  c.then = (resolve: (v: Row[]) => void, reject: (e: unknown) => void) =>
    Promise.resolve(rows.get(table) ?? []).then(resolve, reject);
  return c;
}
const client = {
  select: () => selectChain(),
  insert: (table: unknown) => ({ values: (v: unknown) => { writes.push({ kind: "insert", table, v }); return Object.assign(Promise.resolve(), { returning: async () => [{ id: "x" }] }); } }),
  update: (table: unknown) => ({ set: (v: unknown) => ({ where: async () => { writes.push({ kind: "update", table, v }); } }) }),
  delete: (table: unknown) => ({ where: () => { writes.push({ kind: "delete", table }); return Object.assign(Promise.resolve(), { returning: async () => [] }); } }),
};
vi.mock("@/lib/db", () => ({
  db: {
    select: () => client.select(),
    insert: (t: unknown) => client.insert(t),
    update: (t: unknown) => client.update(t),
    delete: (t: unknown) => client.delete(t),
    transaction: async (cb: (tx: unknown) => Promise<unknown>) => cb(client),
  },
}));

import { declineFreeCoffee } from "@/server/actions/orders";
import { removeVoucher } from "@/server/actions/vouchers";
import { lockPaymentForTotalChange, CHECKOUT_EXISTS } from "@/server/orders/payment-lock";

const SETTLED_AT = new Date("2026-11-08T08:15:00Z");
const SETTLED_ORDER = {
  id: "ord-45", state: "ordered", totalZar: 4500, paymentMode: "yoco_deferred", settledAt: SETTLED_AT,
  customerId: "cust_thabo", isStaffDiscount: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  writes.length = 0;
  paymentsRead = 0;
  rows = new Map<unknown, Row[]>([
    [orders, [SETTLED_ORDER]],
    // R80.00 gross: one line at 8000, R35.00 off → R45.00 net.
    [orderItems, [{ id: "oi-1", orderId: "ord-45", quantity: 1, unitPriceZar: 8000, modsZar: 0, surchargeZar: 0, discountZar: 3500, compReason: null }]],
    [staffEntitlementLog, [{ id: "ent_1", customerId: "cust_thabo", day: "2026-11-08" }]],
    [voucherRedemptions, [{ id: "vr-1", orderItemId: "oi-1", discountZar: 3500, reversedAt: null }]],
    [payments, []],
  ]);
});

describe("REQ-167 / P4: settled_at freezes the total", () => {
  it("the lock refuses a settled order with the fund-settled code, before reading payments", async () => {
    const r = await lockPaymentForTotalChange(client as never, { id: "ord-45", paymentMode: "yoco_deferred", settledAt: SETTLED_AT });
    expect(r).toEqual({ hasPayments: false, refusal: CHECKOUT_EXISTS });
    expect(CHECKOUT_EXISTS.code).toBe("TENDER_IN_PROGRESS");
    expect(paymentsRead).toBe(0);
  });

  it("an open (unsettled) deferred order is not frozen by this rule", async () => {
    const r = await lockPaymentForTotalChange(client as never, { id: "ord-45", paymentMode: "yoco_deferred", settledAt: null });
    expect(r.refusal).toBeNull();
  });

  it("the slip-settled R45.00 order cannot grow to R80.00 by declining the free cup", async () => {
    const r = await declineFreeCoffee("ord-45");
    expect(r).toMatchObject({ ok: false, code: "TENDER_IN_PROGRESS" });
    expect(writes).toEqual([]);
  });

  it("…nor by removing a voucher", async () => {
    const r = await removeVoucher("oi-1");
    expect(r).toMatchObject({ ok: false, code: "TENDER_IN_PROGRESS" });
    expect(writes.filter((w) => w.kind !== "insert")).toEqual([]);
  });
});
