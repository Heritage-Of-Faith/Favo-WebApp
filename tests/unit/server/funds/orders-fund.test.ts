// AT-203: the blessing fund inside the order actions (PRD v7.0 §6.10.5).
//   - createOrder with a chosen fund settles from it and begins NO card tender
//     (no split tender; a fund draw never writes payments — L47, REQ-162);
//   - cancelOrder on a fund-paid order writes the compensating adjustment in
//     its own transaction (REQ-168);
//   - a fund-settled order's total is frozen: applyFreeCoffee and
//     declineFreeCoffee return TENDER_IN_PROGRESS (REQ-167).
// The DB is mocked by table; the fund rules themselves are proven in
// ./funds.test.ts and are stubbed here so this file asserts the wiring only.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { orders, menuItems, menuCustomisations, customers, openingSessions, staffEntitlementLog, payments, orderItems } from "@db/schema";

vi.mock("@/server/auth/guard", () => ({
  authorize: vi.fn(async () => ({ ok: true, session: { id: "staff_louis", role: "barista" } })),
}));
vi.mock("@/server/audit", () => ({ writeAudit: vi.fn(async () => {}) }));
vi.mock("@/server/queue/notify", () => ({ notifyOrderChange: vi.fn(async () => {}) }));
vi.mock("@/server/inventory/lot-picker", () => ({ checkRecipeStock: vi.fn(async () => ({ ok: true })) }));

const startTender = vi.fn(async () => ({ ok: true as const, paymentId: "p", attempt: 1, clientReference: "c:1", amountZar: 2000 }));
vi.mock("@/server/tender/service", () => ({
  startTender: () => startTender(),
  TENDER_NOT_BEGUN: { ok: false, code: "TENDER_NOT_BEGUN", message: "x", retryOffered: true },
}));

const drawFromDonorFund = vi.fn(async (..._a: unknown[]) => ({ ok: true as const, fundId: "f1", entryId: "fe1", amountZar: 2000, balanceAfterZar: 48_000 }));
const compensateFundDraw = vi.fn(async (..._a: unknown[]) => null);
vi.mock("@/server/funds/funds", () => ({
  drawFromDonorFund: (...a: unknown[]) => drawFromDonorFund(...a),
  compensateFundDraw: (...a: unknown[]) => compensateFundDraw(...a),
}));
vi.mock("@/server/funds/runtime", () => ({ getFundDeps: () => ({ fake: "deps" }) }));
vi.mock("@/server/funds/drizzle-store", () => ({ fundTxOn: () => ({ fake: "fundTx" }) }));

type Row = Record<string, unknown>;
let rows = new Map<unknown, Row[]>();
const updates: { table: unknown; set: Row }[] = [];

function selectChain() {
  let table: unknown;
  const c: Record<string, unknown> = {};
  for (const m of ["where", "innerJoin", "leftJoin", "orderBy", "limit", "for"]) c[m] = () => c;
  c.from = (t: unknown) => { table = t; return c; };
  c.then = (res: (v: Row[]) => void, rej: (e: unknown) => void) => Promise.resolve(rows.get(table) ?? []).then(res, rej);
  return c;
}
const client = {
  select: () => selectChain(),
  insert: () => ({
    values: () => Object.assign(Promise.resolve(), {
      onConflictDoNothing: () => ({ returning: async () => [{ id: "ent_1" }] }),
      returning: async () => [{ id: "new_1" }],
    }),
  }),
  update: (table: unknown) => ({ set: (set: Row) => ({ where: async () => { updates.push({ table, set }); } }) }),
  delete: () => ({ where: () => Object.assign(Promise.resolve(), { returning: async () => [] }) }),
};
vi.mock("@/lib/db", () => ({
  db: {
    select: () => client.select(),
    insert: () => client.insert(),
    update: (t: unknown) => client.update(t),
    delete: () => client.delete(),
    transaction: async (cb: (tx: unknown) => Promise<unknown>) => cb(client),
  },
}));

import { createOrder, cancelOrder, applyFreeCoffee, declineFreeCoffee } from "@/server/actions/orders";

const DRINK = { id: "menu_cap", name: "Cappuccino", category: "coffee", currentPriceZar: 2000, recipeId: null };

beforeEach(() => {
  startTender.mockClear();
  drawFromDonorFund.mockClear();
  compensateFundDraw.mockClear();
  updates.length = 0;
  rows = new Map<unknown, Row[]>([
    [menuItems, [DRINK]],
    [menuCustomisations, []],
    [customers, []],
    [openingSessions, [{ mode: "sunday" }]],
    [staffEntitlementLog, []],
    [payments, []],
    [orderItems, []],
  ]);
});

describe("createOrder with a blessing fund chosen", () => {
  it("settles from the fund at the full R20 and begins NO card tender", async () => {
    const r = await createOrder({ notificationTarget: "none", items: [{ menuItemId: "menu_cap", quantity: 1, modifications: [] }], donorFundId: "f1" });
    expect(r).toMatchObject({
      ok: true,
      data: { totalZar: 2000, tender: null, cardCheckout: true, fundDraw: { ok: true, fundId: "f1", amountZar: 2000, balanceAfterZar: 48_000 } },
    });
    expect(drawFromDonorFund).toHaveBeenCalledWith(
      { fake: "deps" }, { kind: "staff", staffId: "staff_louis", role: "barista" }, expect.any(String), "f1"
    );
    expect(startTender).not.toHaveBeenCalled();
  });

  it("a refused draw comes back beside the committed order, which stays unpaid; still no card tender", async () => {
    drawFromDonorFund.mockResolvedValueOnce({ ok: false, code: "FUND_INSUFFICIENT", message: "This fund holds R18,00" } as never);
    const r = await createOrder({ notificationTarget: "none", items: [{ menuItemId: "menu_cap", quantity: 1, modifications: [] }], donorFundId: "f1" });
    expect(r).toMatchObject({ ok: true, data: { cardCheckout: false, tender: null, fundDraw: { ok: false, code: "FUND_INSUFFICIENT" } } });
    expect(startTender).not.toHaveBeenCalled();
  });

  it("without a fund the card tender begins as before, and no fundDraw key appears", async () => {
    const r = await createOrder({ notificationTarget: "none", items: [{ menuItemId: "menu_cap", quantity: 1, modifications: [] }] });
    expect(startTender).toHaveBeenCalledTimes(1);
    expect(drawFromDonorFund).not.toHaveBeenCalled();
    expect(r.ok && "fundDraw" in r.data).toBe(false);
  });
});

describe("cancelOrder on a fund-paid order (REQ-168)", () => {
  it("writes the compensating adjustment inside the cancel's transaction, then cancels", async () => {
    rows.set(orders, [{ id: "ord-1", state: "ordered", totalZar: 2000, paymentMode: "donor_fund" }]);
    expect(await cancelOrder("ord-1", "customer left")).toEqual({ ok: true, data: undefined });
    expect(compensateFundDraw).toHaveBeenCalledWith(
      { fake: "fundTx" }, { kind: "staff", staffId: "staff_louis", role: "barista" }, "ord-1", "customer left", expect.any(Date)
    );
    expect(updates).toContainEqual({ table: orders, set: { state: "cancelled" } });
  });

  it("an order the fund did not pay writes no adjustment", async () => {
    rows.set(orders, [{ id: "ord-2", state: "ordered", totalZar: 2000, paymentMode: null }]);
    await cancelOrder("ord-2", "x");
    expect(compensateFundDraw).not.toHaveBeenCalled();
  });
});

describe("REQ-167: a fund-settled order's total is frozen", () => {
  it("applyFreeCoffee and declineFreeCoffee return TENDER_IN_PROGRESS and write nothing", async () => {
    rows.set(orders, [{ id: "ord-1", state: "ordered", totalZar: 2000, paymentMode: "donor_fund", isStaffDiscount: false }]);
    expect(await applyFreeCoffee("ord-1", "cust_thabo")).toMatchObject({ ok: false, code: "TENDER_IN_PROGRESS" });
    expect(await declineFreeCoffee("ord-1")).toMatchObject({ ok: false, code: "TENDER_IN_PROGRESS" });
    expect(updates).toEqual([]);
  });
});
