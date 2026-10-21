// AT-183 / AT-184 — the free weekday cup (L03), end to end through the server
// actions: createOrder applies it automatically, declineFreeCoffee removes it
// in one tap, applyFreeCoffee is the PRD-named action (§11, was
// applyStaffDiscount). Owner-approved acceptance tests 1–9 (Jira AT-181,
// comment 50720). Literal values: an Americano is R30,00 = 3000 cents.
//
// The DB is mocked: every select resolves rows by the table it reads, and
// every write is recorded so the test asserts what was written.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  orders, orderItems, menuItems, menuCustomisations, customers, payments,
  staffEntitlementLog, openingSessions,
} from "@db/schema";

vi.mock("@/server/auth/guard", () => ({
  authorize: vi.fn(async () => ({ ok: true, session: { id: "staff_louis", role: "barista" } })),
}));

const mockWriteAudit = vi.fn(async (..._a: unknown[]) => {});
vi.mock("@/server/audit", () => ({ writeAudit: (...a: unknown[]) => mockWriteAudit(...a) }));
vi.mock("@/server/queue/notify", () => ({ notifyOrderChange: vi.fn(async () => {}) }));
vi.mock("@/server/inventory/lot-picker", () => ({ checkRecipeStock: vi.fn(async () => ({ ok: true })) }));
const mockCreatePaymentIntent = vi.fn(async (..._a: unknown[]) => ({ id: "ch_1", clientSecret: "cs_1" }));
vi.mock("@/server/yoco/client", () => ({
  createPaymentIntent: (...a: unknown[]) => mockCreatePaymentIntent(...a),
}));

// ─── Table-aware DB mock ──────────────────────────────────────────────────────
type Row = Record<string, unknown>;
let rows = new Map<unknown, Row[]>();
let entitlementConflict = false;
const inserts: { table: unknown; values: unknown }[] = [];
const updates: { table: unknown; set: Row }[] = [];
const deletes: { table: unknown }[] = [];

function selectChain() {
  let table: unknown;
  const c: Record<string, unknown> = {};
  for (const m of ["where", "innerJoin", "leftJoin", "orderBy", "limit", "for"]) {
    c[m] = () => c;
  }
  c.from = (t: unknown) => { table = t; return c; };
  c.then = (resolve: (v: Row[]) => void, reject: (e: unknown) => void) =>
    Promise.resolve(rows.get(table) ?? []).then(resolve, reject);
  return c;
}

function insertChain(table: unknown) {
  return {
    values: (values: unknown) => {
      inserts.push({ table, values });
      const done = Promise.resolve();
      return Object.assign(done, {
        onConflictDoNothing: () => ({
          returning: async () =>
            table === staffEntitlementLog && entitlementConflict ? [] : [{ id: "ent_1" }],
        }),
        returning: async () => [{ id: "new_1" }],
      });
    },
  };
}

const client = {
  select: () => selectChain(),
  insert: (t: unknown) => insertChain(t),
  update: (table: unknown) => ({
    set: (set: Row) => ({ where: async () => { updates.push({ table, set }); } }),
  }),
  delete: (table: unknown) => ({
    where: () => {
      deletes.push({ table });
      return Object.assign(Promise.resolve(), { returning: async () => [{ id: "ent_1" }] });
    },
  }),
};

// Lazy: vi.mock is hoisted above `client`'s initialisation.
vi.mock("@/lib/db", () => ({
  db: {
    select: () => client.select(),
    insert: (t: unknown) => client.insert(t),
    update: (t: unknown) => client.update(t),
    delete: (t: unknown) => client.delete(t),
    transaction: async (cb: (tx: unknown) => Promise<unknown>) => cb(client),
  },
}));

import { createOrder, declineFreeCoffee, applyFreeCoffee } from "@/server/actions/orders";
import { FREE_CUP_COPY } from "@/server/orders/free-coffee";

// ─── Fixtures ─────────────────────────────────────────────────────────────────
const AMERICANO = { id: "menu_americano", name: "Americano", category: "coffee", currentPriceZar: 3000, recipeId: null };
const CAPPUCCINO = { id: "menu_cappuccino", name: "Cappuccino", category: "coffee", currentPriceZar: 3800, recipeId: null };
const CHAI = { id: "menu_chai", name: "Chai Latte", category: "tea", currentPriceZar: 3500, recipeId: null };
const OFFICE = { id: "cust_thabo", name: "Thabo", status: "office_staff" };
const CHURCH = { id: "cust_naledi", name: "Naledi", status: "church_member" };

// Thu 8 Oct 2026, 09:00 SAST; Sun 11 Oct 2026, 09:00 SAST.
const THURSDAY = new Date("2026-10-08T09:00:00+02:00");
const SUNDAY = new Date("2026-10-11T09:00:00+02:00");

function given(opts: {
  menu?: Row[]; customer?: Row | null; modes?: string[]; claimedToday?: boolean;
}) {
  rows = new Map<unknown, Row[]>([
    [menuItems, opts.menu ?? [AMERICANO]],
    [menuCustomisations, []],
    [customers, opts.customer ? [opts.customer] : []],
    [openingSessions, (opts.modes ?? ["weekday"]).map((mode) => ({ mode }))],
    [staffEntitlementLog, opts.claimedToday ? [{ id: "ent_earlier" }] : []],
  ]);
}

const insertsInto = (t: unknown) => inserts.filter((i) => i.table === t).map((i) => i.values);
const updatesOf = (t: unknown) => updates.filter((u) => u.table === t).map((u) => u.set);
const auditActions = () => mockWriteAudit.mock.calls.map((c) => (c[0] as { action: string }).action);
const one = (id: string, quantity = 1) => ({ menuItemId: id, quantity, modifications: [] as string[] });

beforeEach(() => {
  vi.clearAllMocks();
  inserts.length = 0; updates.length = 0; deletes.length = 0;
  entitlementConflict = false;
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(THURSDAY);
});
afterEach(() => vi.useRealTimers());

// ─── createOrder: automatic application ──────────────────────────────────────
describe("createOrder applies the free weekday cup automatically (L03, REQ-024)", () => {
  it("1. weekday + office_staff + coffee line → applied with no tap; one entitlement row", async () => {
    given({ customer: OFFICE });
    const res = await createOrder({ customerId: OFFICE.id, items: [one(AMERICANO.id)] });

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.freeCup).toEqual({
      applied: true, code: null, message: "Free cup applied", discountZar: 3000,
    });
    expect(insertsInto(staffEntitlementLog)).toEqual([
      { customerId: "cust_thabo", appliedByStaffId: "staff_louis", orderId: res.data.orderId, day: "2026-10-08" },
    ]);
    expect(insertsInto(orders)[0]).toMatchObject({ totalZar: 0, isStaffDiscount: true });
    expect(res.data.totalZar).toBe(0);
  });

  it("2. second order the same day → ENTITLEMENT_USED; the order continues PAID; refusal audited 'reject'", async () => {
    given({ customer: OFFICE, claimedToday: true });
    const res = await createOrder({ customerId: OFFICE.id, items: [one(AMERICANO.id)] });

    expect(res.ok).toBe(true); // not blocked
    if (!res.ok) return;
    expect(res.data.freeCup).toEqual({
      applied: false, code: "ENTITLEMENT_USED", message: "Free cup already claimed today", discountZar: 0,
    });
    expect(res.data.totalZar).toBe(3000); // not zeroed
    expect(insertsInto(orders)[0]).toMatchObject({ totalZar: 3000, isStaffDiscount: false });
    expect(insertsInto(staffEntitlementLog)).toEqual([]);
    expect(auditActions()).toContain("reject");
    // The reject audit is written inside the order's transaction, which COMMITS
    // (the order is created) — it is never discarded by a rollback.
    expect(insertsInto(payments)[0]).toMatchObject({ amountZar: 3000 });
  });

  it("2b. lost UNIQUE(customer_id, day) race → paid; checkout = payments.amount_zar = order total (round-2 item 1)", async () => {
    given({ customer: OFFICE });
    entitlementConflict = true; // the pre-check saw nothing; the DB said no
    const res = await createOrder({ customerId: OFFICE.id, items: [one(AMERICANO.id)] });

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.freeCup.code).toBe("ENTITLEMENT_USED");
    expect(res.data.totalZar).toBe(3000);
    expect(updatesOf(orderItems)).toContainEqual({ discountZar: 0 });
    expect(updatesOf(orders)).toContainEqual({ totalZar: 3000, isStaffDiscount: false, paymentMode: null });
    // The three amounts agree: the order's final total, the payments row, the checkout.
    expect(insertsInto(payments)).toEqual([
      { orderId: res.data.orderId, amountZar: 3000, status: "pending", yocoCheckoutId: "ch_1" },
    ]);
    expect(mockCreatePaymentIntent).toHaveBeenCalledTimes(1);
    expect(mockCreatePaymentIntent).toHaveBeenCalledWith({ amountZar: 3000, metadata: { orderId: res.data.orderId } });
    expect(auditActions()).toContain("reject");
  });

  it("3. church_member → NOT_ELIGIBLE; the order continues normally (and is charged as before)", async () => {
    given({ customer: CHURCH });
    const res = await createOrder({ customerId: CHURCH.id, items: [one(AMERICANO.id)] });

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.freeCup).toMatchObject({ applied: false, code: "NOT_ELIGIBLE", message: "Not eligible for the free cup" });
    expect(res.data.totalZar).toBe(3000);
    expect(insertsInto(staffEntitlementLog)).toEqual([]);
    expect(insertsInto(orders)[0]).toMatchObject({ paymentMode: null });
    expect(insertsInto(payments)).toHaveLength(1);
    expect(mockCreatePaymentIntent).toHaveBeenCalledWith(expect.objectContaining({ amountZar: 3000 }));
  });

  it("4. sunday mode or event mode → NOT_ELIGIBLE (weekday mode only)", async () => {
    for (const [now, modes] of [[SUNDAY, ["sunday"]], [THURSDAY, ["event"]]] as const) {
      inserts.length = 0;
      vi.setSystemTime(now);
      given({ customer: OFFICE, modes: [...modes] });
      const res = await createOrder({ customerId: OFFICE.id, items: [one(AMERICANO.id)] });
      expect(res.ok).toBe(true);
      if (!res.ok) return;
      expect(res.data.freeCup).toMatchObject({ applied: false, code: "NOT_ELIGIBLE" });
      expect(res.data.totalZar).toBe(3000);
      expect(insertsInto(staffEntitlementLog)).toEqual([]);
    }
  });

  it("4b. no opening session today → NO_SESSION (PRD S1), audited; the order is not blocked (round-2 item 5)", async () => {
    given({ customer: OFFICE, modes: [] });
    const res = await createOrder({ customerId: OFFICE.id, items: [one(AMERICANO.id)] });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.freeCup).toEqual({
      applied: false, code: "NO_SESSION", message: "Open today's session first", discountZar: 0,
    });
    expect(res.data.totalZar).toBe(3000);
    expect(insertsInto(staffEntitlementLog)).toEqual([]);
    expect(auditActions()).toContain("reject");
  });

  it("5. no customer bound → no entitlement; barista told to pick the customer; order continues", async () => {
    given({ customer: null });
    const res = await createOrder({ items: [one(AMERICANO.id)] });

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.freeCup).toEqual({
      applied: false, code: "NOT_ELIGIBLE", message: FREE_CUP_COPY.noCustomer, discountZar: 0,
    });
    expect(res.data.totalZar).toBe(3000);
    expect(insertsInto(staffEntitlementLog)).toEqual([]);
  });

  it("6. two coffees → ONE unit free, the second still charged (never the whole order)", async () => {
    given({ customer: OFFICE });
    const res = await createOrder({ customerId: OFFICE.id, items: [one(AMERICANO.id, 2)] });

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.totalZar).toBe(3000); // 2 × 3000 − 3000
    expect(insertsInto(orders)[0]).toMatchObject({ totalZar: 3000, paymentMode: null });
  });

  it("7. discount_zar on exactly one eligible line = that line's unit_price_zar; total = Σ qty×unit − Σ discount", async () => {
    given({ customer: OFFICE, menu: [CAPPUCCINO, AMERICANO] });
    const res = await createOrder({
      customerId: OFFICE.id,
      items: [one(CAPPUCCINO.id, 1), one(AMERICANO.id, 2)],
    });

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const lines = insertsInto(orderItems)[0] as Row[];
    expect(lines.map((l) => l.discountZar)).toEqual([3800, 0]); // first eligible line, one unit
    // 1×3800 + 2×3000 − 3800 = 6000
    expect(res.data.totalZar).toBe(6000);
    expect(insertsInto(payments)[0]).toMatchObject({ amountZar: 6000 });
    expect(mockCreatePaymentIntent).toHaveBeenCalledWith(expect.objectContaining({ amountZar: 6000 }));
  });

  it("9. only coffee is eligible: a non-coffee-only order → NOT_ELIGIBLE, no entitlement, audited", async () => {
    given({ customer: OFFICE, menu: [CHAI] });
    const res = await createOrder({ customerId: OFFICE.id, items: [one(CHAI.id)] });

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.freeCup).toMatchObject({ applied: false, code: "NOT_ELIGIBLE" });
    expect(res.data.totalZar).toBe(3500);
    expect(insertsInto(staffEntitlementLog)).toEqual([]);
    expect(auditActions()).toContain("reject");
  });
});

// ─── REQ-153 / AT-186: a net-R0 order never touches payments ────────────────
describe("REQ-153: a net-R0 order writes no payments row and sends nothing (round-2 item 3)", () => {
  it("weekday free cup → 0 payments rows, Yoco not called, payment_mode='free'", async () => {
    given({ customer: OFFICE });
    const res = await createOrder({ customerId: OFFICE.id, items: [one(AMERICANO.id)] });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.totalZar).toBe(0);
    expect(res.data.yocoClientSecret).toBe("");
    expect(insertsInto(payments)).toEqual([]);
    expect(mockCreatePaymentIntent).not.toHaveBeenCalled();
    expect(insertsInto(orders)[0]).toMatchObject({ paymentMode: "free" });
  });

  it("a non-R0 order is unchanged: one pending payments row and one checkout at its total", async () => {
    given({ customer: null });
    const res = await createOrder({ items: [one(AMERICANO.id)] });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(insertsInto(payments)).toEqual([
      { orderId: res.data.orderId, amountZar: 3000, status: "pending", yocoCheckoutId: "ch_1" },
    ]);
    expect(mockCreatePaymentIntent).toHaveBeenCalledTimes(1);
    expect(insertsInto(orders)[0]).toMatchObject({ paymentMode: null });
    expect(res.data.yocoClientSecret).toBe("cs_1");
  });
});

// ─── B1 (Nikao, PR #257, option A): the free cup covers priced mods ──────────
// Oat milk is seeded at +R8,00 (800 cents) on every espresso drink
// (db/seed/customisations.ts). A Cappuccino is R38,00 (3800). One unit of an
// oat Cappuccino is therefore 3800 + 800 = 4600, and the free cup discounts
// exactly that — unit_price_zar + mods_zar, one unit, never more.
describe("B1: the free cup discounts unit_price_zar + mods_zar (oat milk)", () => {
  const OAT = { id: "mod_cappuccino_oat_milk", name: "Oat Milk", priceDeltaZar: 800 };
  const oatCappuccino = (quantity = 1) => ({ menuItemId: CAPPUCCINO.id, quantity, modifications: [OAT.id] });
  function givenOat() {
    given({ customer: OFFICE, menu: [CAPPUCCINO] });
    rows.set(menuCustomisations, [OAT]);
  }

  it("oat-milk Cappuccino, weekday, office_staff → total 0, no payments row, Yoco not called, payment_mode='free'", async () => {
    givenOat();
    const res = await createOrder({ customerId: OFFICE.id, items: [oatCappuccino()] });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.totalZar).toBe(0);
    expect(res.data.freeCup).toEqual({ applied: true, code: null, message: "Free cup applied", discountZar: 4600 });
    expect(insertsInto(payments)).toEqual([]);
    expect(mockCreatePaymentIntent).not.toHaveBeenCalled();
    expect(res.data.yocoClientSecret).toBe("");
    expect(insertsInto(orders)[0]).toMatchObject({ totalZar: 0, paymentMode: "free", isStaffDiscount: true });
    const [line] = insertsInto(orderItems)[0] as Row[];
    expect(line).toMatchObject({ unitPriceZar: 3800, modsZar: 800, discountZar: 4600 });
  });

  it("two oat Cappuccinos → one unit free (4600), the second still charged 4600", async () => {
    givenOat();
    const res = await createOrder({ customerId: OFFICE.id, items: [oatCappuccino(2)] });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const [line] = insertsInto(orderItems)[0] as Row[];
    // Never more than one unit's (unit_price + mods) price.
    expect(line).toMatchObject({ quantity: 2, unitPriceZar: 3800, modsZar: 800, discountZar: 4600 });
    expect(res.data.totalZar).toBe(4600); // 2 × 4600 − 4600
    expect(insertsInto(orders)[0]).toMatchObject({ totalZar: 4600, paymentMode: null });
    expect(insertsInto(payments)[0]).toMatchObject({ amountZar: 4600 });
    expect(mockCreatePaymentIntent).toHaveBeenCalledWith(expect.objectContaining({ amountZar: 4600 }));
  });

  it("a plain line snapshots mods_zar = 0", async () => {
    given({ customer: null, menu: [CAPPUCCINO] });
    const res = await createOrder({ items: [one(CAPPUCCINO.id)] });
    expect(res.ok).toBe(true);
    const [line] = insertsInto(orderItems)[0] as Row[];
    expect(line).toMatchObject({ unitPriceZar: 3800, modsZar: 0, discountZar: 0 });
  });

  it("applyFreeCoffee on a 2× oat Cappuccino line discounts one unit incl. mods (4600)", async () => {
    rows = new Map<unknown, Row[]>([
      [orders, [{ id: "ord_b1", state: "ordered", totalZar: 9200, customerId: OFFICE.id, isStaffDiscount: false, paymentMode: null }]],
      [orderItems, [{ id: "oi_b1", quantity: 2, unitPriceZar: 3800, modsZar: 800, discountZar: 0, category: "coffee" }]],
      [customers, [OFFICE]],
      [openingSessions, [{ mode: "weekday" }]],
      [staffEntitlementLog, []],
      [payments, [{ id: "pay_b1", status: "pending", yocoCheckoutId: null, yocoPaymentId: null }]],
    ]);
    const res = await applyFreeCoffee("ord_b1", OFFICE.id);
    expect(res).toEqual({ ok: true, data: { totalZar: 4600 } });
    expect(updatesOf(orderItems)).toContainEqual({ discountZar: 4600 });
    expect(updatesOf(payments)).toEqual([{ amountZar: 4600 }]);
  });
});

// ─── declineFreeCoffee: one tap ──────────────────────────────────────────────
const CANCEL_AND_RERING = {
  ok: false, code: "TENDER_IN_PROGRESS", message: "Cancel and re-ring the order to change the free cup.",
};

describe("8. declineFreeCoffee — one tap to decline (REQ-024)", () => {
  function givenAppliedOrder(opts: {
    state?: string; payment?: Row | null; totalZar?: number; lines?: Row[]; paymentMode?: string | null;
  } = {}) {
    rows = new Map<unknown, Row[]>([
      [orders, [{
        id: "ord_1", state: opts.state ?? "ordered", totalZar: opts.totalZar ?? 0,
        customerId: OFFICE.id, isStaffDiscount: true,
        paymentMode: opts.paymentMode === undefined ? "free" : opts.paymentMode,
      }]],
      [orderItems, opts.lines ?? [{ id: "oi_1", quantity: 1, unitPriceZar: 3000, discountZar: 3000 }]],
      [staffEntitlementLog, [{ id: "ent_1", customerId: OFFICE.id, day: "2026-10-08" }]],
      [payments, opts.payment ? [opts.payment] : []],
    ]);
  }

  it("a FREE order (no payments row): removes the entitlement row, reverts discount + total, writes the pending row FIRST, then the checkout", async () => {
    givenAppliedOrder();
    const res = await declineFreeCoffee("ord_1");

    expect(res).toEqual({ ok: true, data: { totalZar: 3000, yocoClientSecret: "cs_1" } });
    expect(deletes.map((d) => d.table)).toEqual([staffEntitlementLog]);
    expect(updatesOf(orderItems)).toContainEqual({ discountZar: 0 });
    expect(updatesOf(orders)).toContainEqual({ totalZar: 3000, isStaffDiscount: false, paymentMode: null });
    expect(insertsInto(payments)).toEqual([{ orderId: "ord_1", amountZar: 3000, status: "pending" }]);
    expect(mockCreatePaymentIntent).toHaveBeenCalledWith({ amountZar: 3000, metadata: { orderId: "ord_1" } });
    expect(updatesOf(payments)).toEqual([{ yocoCheckoutId: "ch_1" }]); // checkout id recorded on that row
    expect(auditActions()).toEqual(["decline_free_cup"]);
  });

  it("refused once a checkout exists — even with status pending and no Yoco payment id (owner rule)", async () => {
    for (const payment of [
      { id: "pay_1", status: "pending", yocoCheckoutId: "ch_old", yocoPaymentId: null },
      { id: "pay_1", status: "pending", yocoCheckoutId: null, yocoPaymentId: "p_yoco_1" },
      { id: "pay_1", status: "failed", yocoCheckoutId: "ch_old", yocoPaymentId: "p_yoco_1" },
    ]) {
      deletes.length = 0; updates.length = 0; inserts.length = 0;
      givenAppliedOrder({ totalZar: 3000, paymentMode: null, payment, lines: [{ id: "oi_1", quantity: 2, unitPriceZar: 3000, discountZar: 3000 }] });
      const res = await declineFreeCoffee("ord_1");
      expect(res).toEqual(CANCEL_AND_RERING);
      expect(deletes).toEqual([]);
      expect(updates).toEqual([]);
      expect(inserts).toEqual([]);
      expect(mockCreatePaymentIntent).not.toHaveBeenCalled();
    }
  });

  it("a pending row with NO checkout (Yoco was down at ring-up) is repriced, no checkout made", async () => {
    givenAppliedOrder({
      totalZar: 3000, paymentMode: null,
      payment: { id: "pay_1", status: "pending", yocoCheckoutId: null, yocoPaymentId: null },
      lines: [{ id: "oi_1", quantity: 2, unitPriceZar: 3000, discountZar: 3000 }],
    });
    const res = await declineFreeCoffee("ord_1");
    expect(res).toEqual({ ok: true, data: { totalZar: 6000, yocoClientSecret: "" } });
    expect(updatesOf(payments)).toEqual([{ amountZar: 6000 }]);
    expect(insertsInto(payments)).toEqual([]);
    expect(mockCreatePaymentIntent).not.toHaveBeenCalled();
  });

  it("a chargeable order whose payments row createOrder hasn't written yet → STALE_STATE, nothing written (round-3 item 3)", async () => {
    givenAppliedOrder({ totalZar: 3000, paymentMode: null, payment: null, lines: [{ id: "oi_1", quantity: 2, unitPriceZar: 3000, discountZar: 3000 }] });
    const res = await declineFreeCoffee("ord_1");
    expect(res).toEqual({ ok: false, code: "STALE_STATE", message: "This order just changed — reloading" });
    expect(deletes).toEqual([]);
    expect(updates).toEqual([]);
    expect(inserts).toEqual([]);
  });

  it("clears the line the cup paid for — not simply the first line (round-2 item 6)", async () => {
    givenAppliedOrder({
      totalZar: 0,
      lines: [
        { id: "oi_tea", quantity: 1, unitPriceZar: 0, discountZar: 0 },
        { id: "oi_cap", quantity: 1, unitPriceZar: 3500, discountZar: 3500 },
      ],
    });
    const res = await declineFreeCoffee("ord_1");
    expect(res.ok).toBe(true);
    const audit = mockWriteAudit.mock.calls[0][0] as { before: Row };
    expect(audit.before).toMatchObject({ orderItemId: "oi_cap", beneficiaryCustomerId: OFFICE.id, discountZar: 3500 });
  });

  it("refuses once the order has moved on from 'ordered'", async () => {
    givenAppliedOrder({ state: "in_progress" });
    const res = await declineFreeCoffee("ord_1");
    expect(res.ok).toBe(false);
    expect(deletes).toEqual([]);
  });

  it("refuses once the order is paid", async () => {
    givenAppliedOrder({ totalZar: 3000, paymentMode: null, payment: { id: "pay_1", status: "successful", yocoCheckoutId: "ch_1", yocoPaymentId: "p_1" } });
    const res = await declineFreeCoffee("ord_1");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("ALREADY_RESOLVED");
    expect(deletes).toEqual([]);
  });
});

// ─── applyFreeCoffee: the PRD-named action ───────────────────────────────────
describe("applyFreeCoffee(orderId, beneficiaryCustomerId) — was applyStaffDiscount", () => {
  function givenOrder(customer: Row | null, opts: { claimedToday?: boolean; payment?: Row | null; quantity?: number } = {}) {
    const quantity = opts.quantity ?? 2;
    rows = new Map<unknown, Row[]>([
      [orders, [{ id: "ord_9", state: "ordered", totalZar: 3000 * quantity, customerId: OFFICE.id, isStaffDiscount: false, paymentMode: null }]],
      [orderItems, [{ id: "oi_9", quantity, unitPriceZar: 3000, discountZar: 0, category: "coffee", modifications: [] }]],
      [customers, customer ? [customer] : []],
      [openingSessions, [{ mode: "weekday" }]],
      [staffEntitlementLog, opts.claimedToday ? [{ id: "ent_earlier" }] : []],
      [payments, opts.payment === null ? [] : [opts.payment ?? { id: "pay_9", status: "pending", yocoCheckoutId: null, yocoPaymentId: null }]],
    ]);
  }

  it("applies one unit to an order with no checkout, keys the row on the customer, keeps the payment amount equal", async () => {
    givenOrder(OFFICE);
    const res = await applyFreeCoffee("ord_9", OFFICE.id);
    expect(res).toEqual({ ok: true, data: { totalZar: 3000 } });
    expect(insertsInto(staffEntitlementLog)).toEqual([
      { customerId: "cust_thabo", appliedByStaffId: "staff_louis", orderId: "ord_9", day: "2026-10-08" },
    ]);
    expect(updatesOf(orderItems)).toContainEqual({ discountZar: 3000 });
    expect(updatesOf(orders)).toContainEqual({ totalZar: 3000, isStaffDiscount: true, paymentMode: null });
    expect(updatesOf(payments)).toEqual([{ amountZar: 3000 }]);
    expect(mockCreatePaymentIntent).not.toHaveBeenCalled();
    const audit = mockWriteAudit.mock.calls.map((c) => c[0] as { action: string; after?: Row });
    expect(audit[0].action).toBe("free_cup");
    expect(audit[0].after).toMatchObject({ beneficiaryCustomerId: "cust_thabo" });
  });

  it("refused when a checkout exists (owner rule)", async () => {
    givenOrder(OFFICE, { payment: { id: "pay_9", status: "pending", yocoCheckoutId: "ch_9", yocoPaymentId: null } });
    const res = await applyFreeCoffee("ord_9", OFFICE.id);
    expect(res).toEqual(CANCEL_AND_RERING);
    expect(insertsInto(staffEntitlementLog)).toEqual([]);
    expect(updates).toEqual([]);
  });

  it("never deletes a payments row: taking a row-carrying order to R0 is refused instead", async () => {
    givenOrder(OFFICE, { quantity: 1 });
    const res = await applyFreeCoffee("ord_9", OFFICE.id);
    expect(res).toEqual(CANCEL_AND_RERING);
    expect(deletes).toEqual([]);
    expect(updates).toEqual([]);
    expect(insertsInto(staffEntitlementLog)).toEqual([]);
  });

  it("rejects a FAVO-staff id (not a customer) with NOT_ELIGIBLE", async () => {
    givenOrder(null);
    const res = await applyFreeCoffee("ord_9", "staff_barista_sam");
    expect(res).toEqual({ ok: false, code: "NOT_ELIGIBLE", message: "Not eligible for the free cup" });
    expect(insertsInto(staffEntitlementLog)).toEqual([]);
  });

  it("ENTITLEMENT_USED is returned AND audited 'reject' — the audit is not rolled back", async () => {
    givenOrder(OFFICE, { claimedToday: true });
    const res = await applyFreeCoffee("ord_9", OFFICE.id);
    expect(res).toEqual({ ok: false, code: "ENTITLEMENT_USED", message: "Free cup already claimed today" });
    expect(auditActions()).toEqual(["reject"]);
    expect(updatesOf(orders)).toEqual([]);
  });
});
