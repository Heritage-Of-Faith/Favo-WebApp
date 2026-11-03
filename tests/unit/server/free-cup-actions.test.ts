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
// AT-201 part 2b: createOrder begins the tender through the tender service
// (beginTender writes the pending payments row). Stubbed here; the chain itself
// is proven in tests/unit/server/tender/. `seq` records the order of events.
// Like the real beginTender, the stub reads the order's COMMITTED total (the
// orders row as inserted, then as updated) — so `tender.amountZar` is what the
// payments row would carry, and tests assert it against the PRD's literal cents.
const seq: string[] = [];
function committedOrderTotal(): number {
  const inserted = inserts.filter((i) => i.table === orders).map((i) => i.values as Row);
  let total = inserted[inserted.length - 1]?.totalZar as number;
  for (const u of updates) if (u.table === orders && typeof u.set.totalZar === "number") total = u.set.totalZar;
  return total;
}
const mockStartTender = vi.fn(async (..._a: unknown[]) => {
  seq.push("beginTender");
  return { ok: true as const, paymentId: "pmt_1", attempt: 1, clientReference: "cu-1:1", amountZar: committedOrderTotal() };
});
vi.mock("@/server/tender/service", () => ({
  startTender: (...a: unknown[]) => mockStartTender(...a),
  TENDER_NOT_BEGUN: {
    ok: false, code: "TENDER_NOT_BEGUN",
    message: "Couldn't start the card payment — nothing was sent. Try again.", retryOffered: true,
  },
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
      if (table === orders) seq.push("insert:orders");
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
    transaction: async (cb: (tx: unknown) => Promise<unknown>) => {
      const r = await cb(client);
      seq.push("commit");
      return r;
    },
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
/** REQ-026: the order commits, THEN beginTender writes the pending row — never the reverse. */
function expectOrderCommittedBeforeTender() {
  expect(seq.indexOf("insert:orders")).toBeGreaterThanOrEqual(0);
  expect(seq.lastIndexOf("commit")).toBeLessThan(seq.indexOf("beginTender"));
}
// Sent attempts (yoco ids) vs a begun-but-unsent one — the shapes isAttemptOpen reads.
const SENT = new Date("2026-10-08T07:00:00Z");
const auditActions = () => mockWriteAudit.mock.calls.map((c) => (c[0] as { action: string }).action);
const one = (id: string, quantity = 1) => ({ menuItemId: id, quantity, modifications: [] as string[] });

beforeEach(() => {
  vi.clearAllMocks();
  inserts.length = 0; updates.length = 0; deletes.length = 0; seq.length = 0;
  entitlementConflict = false;
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(THURSDAY);
});
afterEach(() => vi.useRealTimers());

// ─── createOrder: automatic application ──────────────────────────────────────
describe("createOrder applies the free weekday cup automatically (L03, REQ-024)", () => {
  it("1. weekday + office_staff + coffee line → applied with no tap; one entitlement row", async () => {
    given({ customer: OFFICE });
    const res = await createOrder({ notificationTarget: "customer", customerId: OFFICE.id, items: [one(AMERICANO.id)] });

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

  // CHANGED (AT-212, DEC-18 revised 29 Oct 2026 / REQ-025): the second drink is
  // now REFUSED and never charged (was: "the order continues PAID" with a tender).
  it("2. second order the same day → ENTITLEMENT_USED; the drink is REFUSED, nothing written but the 'reject' audit (DEC-18)", async () => {
    given({ customer: OFFICE, claimedToday: true });
    const res = await createOrder({ notificationTarget: "customer", customerId: OFFICE.id, items: [one(AMERICANO.id)] });

    expect(res).toEqual({ ok: false, code: "ENTITLEMENT_USED", message: "Free cup already claimed today" });
    expect(inserts).toEqual([]); // no order, no items, no entitlement row
    expect(updates).toEqual([]);
    expect(insertsInto(payments)).toEqual([]);
    expect(mockStartTender).not.toHaveBeenCalled(); // never charged
    expect(auditActions()).toEqual(["reject"]);
    const audit = mockWriteAudit.mock.calls[0][0] as { after: Row; reason: string };
    expect(audit.reason).toBe("ENTITLEMENT_USED");
    expect(audit.after).toMatchObject({ code: "ENTITLEMENT_USED", beneficiaryCustomerId: "cust_thabo", day: "2026-10-08" });
  });

  // CHANGED (AT-212, DEC-18): a lost race is a second drink too — refused, not paid.
  it("2b. lost UNIQUE(customer_id, day) race → ENTITLEMENT_USED; the transaction rolls back; the reject audit is written outside it", async () => {
    given({ customer: OFFICE });
    entitlementConflict = true; // the pre-check saw nothing; the DB said no
    const res = await createOrder({ notificationTarget: "customer", customerId: OFFICE.id, items: [one(AMERICANO.id)] });

    expect(res).toEqual({ ok: false, code: "ENTITLEMENT_USED", message: "Free cup already claimed today" });
    expect(seq).not.toContain("commit"); // the transaction threw: everything in it rolls back
    expect(insertsInto(payments)).toEqual([]);
    expect(mockStartTender).not.toHaveBeenCalled();
    // Whatever was audited inside the transaction rolled back with it; the one
    // audit written with the plain db handle (so it commits) is the reject.
    const outsideTx = mockWriteAudit.mock.calls.filter((c) => c[1] !== client).map((c) => (c[0] as { action: string }).action);
    expect(outsideTx).toEqual(["reject"]);
  });

  // CHANGED (AT-212, L19 / DEC-18): on a weekday nobody pays (was: charged R30,00 with a tender).
  it("3. church_member → NOT_ELIGIBLE for the cup; on a weekday the order is still free (L19), no tender", async () => {
    given({ customer: CHURCH });
    const res = await createOrder({ notificationTarget: "customer", customerId: CHURCH.id, items: [one(AMERICANO.id)] });

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.freeCup).toMatchObject({ applied: false, code: "NOT_ELIGIBLE", message: "Not eligible for the free cup" });
    expect(res.data.totalZar).toBe(0);
    expect(insertsInto(staffEntitlementLog)).toEqual([]);
    expect(insertsInto(orders)[0]).toMatchObject({ paymentMode: "free", totalZar: 0, isStaffDiscount: false });
    expect(insertsInto(orderItems)[0]).toEqual([expect.objectContaining({ unitPriceZar: 3000, discountZar: 3000 })]);
    expect(mockStartTender).not.toHaveBeenCalled();
    expect(res.data.tender).toBeNull();
  });

  it("4. sunday mode or event mode → NOT_ELIGIBLE (weekday mode only)", async () => {
    for (const [now, modes] of [[SUNDAY, ["sunday"]], [THURSDAY, ["event"]]] as const) {
      inserts.length = 0;
      vi.setSystemTime(now);
      given({ customer: OFFICE, modes: [...modes] });
      const res = await createOrder({ notificationTarget: "customer", customerId: OFFICE.id, items: [one(AMERICANO.id)] });
      expect(res.ok).toBe(true);
      if (!res.ok) return;
      expect(res.data.freeCup).toMatchObject({ applied: false, code: "NOT_ELIGIBLE" });
      expect(res.data.totalZar).toBe(3000);
      expect(insertsInto(staffEntitlementLog)).toEqual([]);
    }
  });

  it("4b. no opening session today → NO_SESSION (PRD S1), audited; the order is not blocked (round-2 item 5)", async () => {
    given({ customer: OFFICE, modes: [] });
    const res = await createOrder({ notificationTarget: "customer", customerId: OFFICE.id, items: [one(AMERICANO.id)] });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.freeCup).toEqual({
      applied: false, code: "NO_SESSION", message: "Open today's session first", discountZar: 0,
    });
    expect(res.data.totalZar).toBe(3000);
    expect(insertsInto(staffEntitlementLog)).toEqual([]);
    expect(auditActions()).toContain("reject");
  });

  // CHANGED (AT-212, L19 / DEC-18): weekday walk-in is free (was: total 3000).
  it("5. no customer bound → no entitlement; barista told to pick the customer; on a weekday the order is free", async () => {
    given({ customer: null });
    const res = await createOrder({ notificationTarget: "none", items: [one(AMERICANO.id)] });

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.freeCup).toEqual({
      applied: false, code: "NOT_ELIGIBLE", message: FREE_CUP_COPY.noCustomer, discountZar: 0,
    });
    expect(res.data.totalZar).toBe(0);
    expect(insertsInto(orders)[0]).toMatchObject({ paymentMode: "free", totalZar: 0 });
    expect(insertsInto(staffEntitlementLog)).toEqual([]);
    expect(mockStartTender).not.toHaveBeenCalled();
  });

  // CHANGED (AT-212, DEC-18): "discount_zar zeroes each line, so orders.total_zar
  // is R0" (was: the second unit charged R30,00). The entitlement is still ONE
  // row worth ONE unit (REQ-115).
  it("6. two coffees on one line → one entitlement row worth one unit; discount_zar zeroes the line; total R0", async () => {
    given({ customer: OFFICE });
    const res = await createOrder({ notificationTarget: "customer", customerId: OFFICE.id, items: [one(AMERICANO.id, 2)] });

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.totalZar).toBe(0);
    expect(res.data.freeCup).toMatchObject({ applied: true, discountZar: 3000 }); // one unit, never more
    expect(insertsInto(staffEntitlementLog)).toHaveLength(1);
    expect(insertsInto(orderItems)[0]).toEqual([expect.objectContaining({ quantity: 2, unitPriceZar: 3000, discountZar: 6000 })]);
    expect(insertsInto(orders)[0]).toMatchObject({ totalZar: 0, paymentMode: "free" });
    expect(mockStartTender).not.toHaveBeenCalled();
  });

  // CHANGED (AT-212, DEC-18): every weekday line zeroed (was: [3800, 0], R60,00 on the machine).
  it("7. weekday: every line keeps its menu price and discount_zar zeroes it; total R0; nothing on the machine", async () => {
    given({ customer: OFFICE, menu: [CAPPUCCINO, AMERICANO] });
    const res = await createOrder({
      notificationTarget: "customer",
      customerId: OFFICE.id,
      items: [one(CAPPUCCINO.id, 1), one(AMERICANO.id, 2)],
    });

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const lines = insertsInto(orderItems)[0] as Row[];
    expect(lines.map((l) => l.unitPriceZar)).toEqual([3800, 3000]);
    expect(lines.map((l) => l.discountZar)).toEqual([3800, 6000]); // 1×3800, 2×3000
    expect(res.data.totalZar).toBe(0);
    expect(res.data.freeCup).toMatchObject({ applied: true, discountZar: 3800 }); // the entitlement: one unit
    expect(insertsInto(orders)[0]).toMatchObject({ totalZar: 0, paymentMode: "free" });
    expect(mockStartTender).not.toHaveBeenCalled();
    expect(res.data.tender).toBeNull();
  });

  // CHANGED (AT-212, L19): the order is free on a weekday (was: total 3500).
  it("9. only coffee is eligible: a non-coffee-only order → NOT_ELIGIBLE, no entitlement, audited; still free on a weekday", async () => {
    given({ customer: OFFICE, menu: [CHAI] });
    const res = await createOrder({ notificationTarget: "customer", customerId: OFFICE.id, items: [one(CHAI.id)] });

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.freeCup).toMatchObject({ applied: false, code: "NOT_ELIGIBLE" });
    expect(res.data.totalZar).toBe(0);
    expect(insertsInto(orders)[0]).toMatchObject({ totalZar: 0, paymentMode: "free" });
    expect(insertsInto(staffEntitlementLog)).toEqual([]);
    expect(auditActions()).toContain("reject");
    expect(mockStartTender).not.toHaveBeenCalled();
  });
});

// ─── AT-212: weekday orders never take a payment (L19, S7a, DEC-18, DEC-19) ───
describe("AT-212: weekday orders never take a payment", () => {
  // R38,00 and R45,00, both coffee.
  const MOCHA = { id: "menu_mocha", name: "Mocha", category: "coffee", currentPriceZar: 4500, recipeId: null };

  it("R38 + R45 for a first-time office_staff person → payment_mode 'free', total R0, no payments row, no tender", async () => {
    given({ customer: OFFICE, menu: [CAPPUCCINO, MOCHA] });
    const res = await createOrder({
      notificationTarget: "customer", customerId: OFFICE.id, items: [one(CAPPUCCINO.id), one(MOCHA.id)],
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.totalZar).toBe(0);
    expect(insertsInto(orders)[0]).toMatchObject({ totalZar: 0, paymentMode: "free", isStaffDiscount: true });
    expect(insertsInto(orderItems)[0]).toEqual([
      expect.objectContaining({ unitPriceZar: 3800, discountZar: 3800 }),
      expect.objectContaining({ unitPriceZar: 4500, discountZar: 4500 }),
    ]);
    expect(insertsInto(staffEntitlementLog)).toEqual([
      { customerId: "cust_thabo", appliedByStaffId: "staff_louis", orderId: res.data.orderId, day: "2026-10-08" },
    ]);
    expect(insertsInto(payments)).toEqual([]);
    expect(mockStartTender).not.toHaveBeenCalled();
    expect(res.data.tender).toBeNull();
    expect(res.data.cardCheckout).toBe(false);
  });

  it("DEC-19 override: 'Give another free cup' → an R0 order, NO second entitlement row, ONE audit row 'extra_free_cup'", async () => {
    given({ customer: OFFICE, menu: [CAPPUCCINO], claimedToday: true });
    const res = await createOrder({
      notificationTarget: "customer", customerId: OFFICE.id, items: [one(CAPPUCCINO.id)], extraFreeCup: true,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.extraFreeCup).toBe(true);
    expect(res.data.totalZar).toBe(0);
    expect(insertsInto(orders)[0]).toMatchObject({ totalZar: 0, paymentMode: "free", isStaffDiscount: false });
    expect(insertsInto(orderItems)[0]).toEqual([expect.objectContaining({ unitPriceZar: 3800, discountZar: 3800 })]);
    expect(insertsInto(staffEntitlementLog)).toEqual([]);
    expect(insertsInto(payments)).toEqual([]);
    expect(mockStartTender).not.toHaveBeenCalled();
    const extra = mockWriteAudit.mock.calls.map((c) => c[0] as { action: string; actorId: string; after: Row })
      .filter((a) => a.action === "extra_free_cup");
    expect(extra).toHaveLength(1);
    expect(extra[0].actorId).toBe("staff_louis");
    expect(extra[0].after).toMatchObject({
      baristaStaffId: "staff_louis", beneficiaryCustomerId: "cust_thabo",
      orderId: res.data.orderId, day: "2026-10-08", grossZar: 3800,
    });
    expect(auditActions()).not.toContain("reject");
  });

  it("DEC-19: the override is weekday-only and needs a customer → MODE_FORBIDDEN, nothing written", async () => {
    vi.setSystemTime(SUNDAY);
    given({ customer: OFFICE, modes: ["sunday"] });
    const sunday = await createOrder({
      notificationTarget: "customer", customerId: OFFICE.id, items: [one(AMERICANO.id)], extraFreeCup: true,
    });
    expect(sunday).toMatchObject({ ok: false, code: "MODE_FORBIDDEN" });

    vi.setSystemTime(THURSDAY);
    given({ customer: null });
    const noCustomer = await createOrder({ notificationTarget: "none", items: [one(AMERICANO.id)], extraFreeCup: true });
    expect(noCustomer).toMatchObject({ ok: false, code: "MODE_FORBIDDEN" });

    expect(inserts).toEqual([]);
    expect(mockStartTender).not.toHaveBeenCalled();
  });

  it("Sunday behaviour unchanged: an R38 order is charged — the order commits, then ONE tender begins", async () => {
    vi.setSystemTime(SUNDAY);
    given({ customer: null, menu: [CAPPUCCINO], modes: ["sunday"] });
    const res = await createOrder({ notificationTarget: "none", items: [one(CAPPUCCINO.id)] });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(insertsInto(orders)[0]).toMatchObject({ totalZar: 3800, paymentMode: null });
    expect(mockStartTender).toHaveBeenCalledTimes(1);
    expectOrderCommittedBeforeTender();
    expect(res.data.tender).toEqual({ ok: true, attempt: 1, amountZar: 3800 });
  });

  it("declining the cup on a weekday gives the entitlement back but the order stays R0 'free' (L19)", async () => {
    rows = new Map<unknown, Row[]>([
      [orders, [{
        id: "ord_w", state: "ordered", totalZar: 0, customerId: OFFICE.id, isStaffDiscount: true,
        paymentMode: "free", revenueDay: "2026-10-08", placedAt: THURSDAY,
      }]],
      [orderItems, [{ id: "oi_w", quantity: 1, unitPriceZar: 3000, discountZar: 3000 }]],
      [staffEntitlementLog, [{ id: "ent_1", customerId: OFFICE.id, day: "2026-10-08" }]],
      [openingSessions, [{ mode: "weekday" }]],
      [payments, []],
    ]);
    const res = await declineFreeCoffee("ord_w");
    expect(res).toEqual({ ok: true, data: { totalZar: 0 } });
    expect(deletes.map((d) => d.table)).toEqual([staffEntitlementLog]);
    expect(updatesOf(orderItems)).toEqual([]); // the line stays zeroed
    expect(updatesOf(orders)).toEqual([{ isStaffDiscount: false }]); // total and payment_mode untouched
    expect(insertsInto(payments)).toEqual([]);
    expect(mockStartTender).not.toHaveBeenCalled();
    expect(auditActions()).toEqual(["decline_free_cup"]);
  });
});

// ─── REQ-153 / AT-186: a net-R0 order never touches payments ────────────────
describe("REQ-153: a net-R0 order writes no payments row and sends nothing (round-2 item 3)", () => {
  it("weekday free cup → 0 payments rows, no tender begun, payment_mode='free'", async () => {
    given({ customer: OFFICE });
    const res = await createOrder({ notificationTarget: "customer", customerId: OFFICE.id, items: [one(AMERICANO.id)] });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.totalZar).toBe(0);
    expect(res.data.tender).toBeNull();
    expect(res.data.cardCheckout).toBe(false);
    expect(insertsInto(payments)).toEqual([]);
    expect(mockStartTender).not.toHaveBeenCalled();
    expect(insertsInto(orders)[0]).toMatchObject({ paymentMode: "free" });
  });

  // CHANGED (AT-212, L19): the three tender cases below now run on a SUNDAY —
  // a weekday order has no tender at all. Their assertions are unchanged.
  it("a non-R0 order: the order commits, then ONE tender begins on it; createOrder writes no payments row itself (REQ-026)", async () => {
    vi.setSystemTime(SUNDAY);
    given({ customer: null, modes: ["sunday"] });
    const res = await createOrder({ notificationTarget: "none", items: [one(AMERICANO.id)] });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(insertsInto(payments)).toEqual([]);
    expect(mockStartTender).toHaveBeenCalledTimes(1);
    expect(mockStartTender).toHaveBeenCalledWith(expect.anything(), res.data.orderId);
    expectOrderCommittedBeforeTender();
    expect(insertsInto(orders)[0]).toMatchObject({ paymentMode: null, totalZar: 3000 });
    expect(res.data.tender).toEqual({ ok: true, attempt: 1, amountZar: 3000 });
    expect(res.data.cardCheckout).toBe(true);
  });

  it("a refused tender (no machine configured) is returned beside the committed order, never thrown", async () => {
    vi.setSystemTime(SUNDAY);
    given({ customer: null, modes: ["sunday"] });
    mockStartTender.mockResolvedValueOnce({
      ok: false, code: "TERMINAL_UNREACHABLE",
      message: "Card machine not responding — check it's on and on the wifi, or switch to deferred",
    } as never);
    const res = await createOrder({ notificationTarget: "none", items: [one(AMERICANO.id)] });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.tender).toEqual({
      ok: false, code: "TERMINAL_UNREACHABLE",
      message: "Card machine not responding — check it's on and on the wifi, or switch to deferred",
    });
    expect(res.data.cardCheckout).toBe(false);
    expect(insertsInto(orders)).toHaveLength(1);
  });

  it("an exception inside beginTender (e.g. a DB outage) → TENDER_NOT_BEGUN with a retry, beside the committed order — never STALE_STATE or PAYMENT_UNKNOWN", async () => {
    vi.setSystemTime(SUNDAY);
    given({ customer: null, modes: ["sunday"] });
    mockStartTender.mockRejectedValueOnce(new Error("connection refused"));
    const res = await createOrder({ notificationTarget: "none", items: [one(AMERICANO.id)] });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.tender).toEqual({
      ok: false, code: "TENDER_NOT_BEGUN",
      message: "Couldn't start the card payment — nothing was sent. Try again.", retryOffered: true,
    });
    expect(res.data.cardCheckout).toBe(false);
    expect(insertsInto(orders)).toHaveLength(1);
    expect(insertsInto(payments)).toEqual([]);
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

  it("oat-milk Cappuccino, weekday, office_staff → total 0, no payments row, no tender, payment_mode='free'", async () => {
    givenOat();
    const res = await createOrder({ notificationTarget: "customer", customerId: OFFICE.id, items: [oatCappuccino()] });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.totalZar).toBe(0);
    expect(res.data.freeCup).toEqual({ applied: true, code: null, message: "Free cup applied", discountZar: 4600 });
    expect(insertsInto(payments)).toEqual([]);
    expect(mockStartTender).not.toHaveBeenCalled();
    expect(res.data.tender).toBeNull();
    expect(insertsInto(orders)[0]).toMatchObject({ totalZar: 0, paymentMode: "free", isStaffDiscount: true });
    const [line] = insertsInto(orderItems)[0] as Row[];
    expect(line).toMatchObject({ unitPriceZar: 3800, modsZar: 800, discountZar: 4600 });
  });

  // CHANGED (AT-212, DEC-18): the whole weekday line is zeroed, R0 (was: second
  // unit charged R46,00). The entitlement itself is still one unit (4600).
  it("two oat Cappuccinos → the entitlement is one unit (4600); discount_zar zeroes the line (9200); total R0", async () => {
    givenOat();
    const res = await createOrder({ notificationTarget: "customer", customerId: OFFICE.id, items: [oatCappuccino(2)] });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const [line] = insertsInto(orderItems)[0] as Row[];
    expect(line).toMatchObject({ quantity: 2, unitPriceZar: 3800, modsZar: 800, discountZar: 9200 });
    expect(res.data.freeCup).toMatchObject({ applied: true, discountZar: 4600 }); // never more than one unit
    expect(res.data.totalZar).toBe(0);
    expect(insertsInto(orders)[0]).toMatchObject({ totalZar: 0, paymentMode: "free" });
    expect(mockStartTender).not.toHaveBeenCalled();
  });

  // CHANGED (AT-212): run on a Sunday, where no weekday discount applies (intent unchanged).
  it("a plain line snapshots mods_zar = 0", async () => {
    vi.setSystemTime(SUNDAY);
    given({ customer: null, menu: [CAPPUCCINO], modes: ["sunday"] });
    const res = await createOrder({ notificationTarget: "none", items: [one(CAPPUCCINO.id)] });
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
      [payments, []],
    ]);
    const res = await applyFreeCoffee("ord_b1", OFFICE.id);
    expect(res).toEqual({ ok: true, data: { totalZar: 4600 } });
    expect(updatesOf(orderItems)).toContainEqual({ discountZar: 4600 });
    expect(updatesOf(payments)).toEqual([]); // an attempt's amount is never rewritten (P4)
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

  it("a FREE order (no payments row): removes the entitlement row, reverts discount + total; writes NO payments row (the screen then begins a tender)", async () => {
    givenAppliedOrder();
    const res = await declineFreeCoffee("ord_1");

    expect(res).toEqual({ ok: true, data: { totalZar: 3000 } });
    expect(deletes.map((d) => d.table)).toEqual([staffEntitlementLog]);
    expect(updatesOf(orderItems)).toContainEqual({ discountZar: 0 });
    expect(updatesOf(orders)).toContainEqual({ totalZar: 3000, isStaffDiscount: false, paymentMode: null });
    expect(insertsInto(payments)).toEqual([]);
    expect(updatesOf(payments)).toEqual([]);
    expect(mockStartTender).not.toHaveBeenCalled();
    expect(auditActions()).toEqual(["decline_free_cup"]);
  });

  it("REQ-028: refused with TENDER_IN_PROGRESS while an attempt is open — begun, sent and pending, or sent and unresolved", async () => {
    for (const payment of [
      { id: "pay_1", status: "pending", sentAt: null, yocoPaymentId: null },
      { id: "pay_1", status: "pending", sentAt: SENT, yocoPaymentId: "p_yoco_1" },
      { id: "pay_1", status: "unresolved", sentAt: SENT, yocoPaymentId: "p_yoco_1" },
    ]) {
      deletes.length = 0; updates.length = 0; inserts.length = 0;
      givenAppliedOrder({ totalZar: 3000, paymentMode: null, payment, lines: [{ id: "oi_1", quantity: 2, unitPriceZar: 3000, discountZar: 3000 }] });
      const res = await declineFreeCoffee("ord_1");
      expect(res).toEqual(CANCEL_AND_RERING);
      expect(deletes).toEqual([]);
      expect(updates).toEqual([]);
      expect(inserts).toEqual([]);
    }
  });

  it("a declined or never-sent closed-out attempt does not freeze the total; no payments row is written or repriced", async () => {
    for (const payment of [
      { id: "pay_1", status: "declined", sentAt: SENT, yocoPaymentId: "p_yoco_1" },
      { id: "pay_1", status: "unresolved", sentAt: null, yocoPaymentId: null },
    ]) {
      deletes.length = 0; updates.length = 0; inserts.length = 0;
      givenAppliedOrder({ totalZar: 3000, paymentMode: null, payment, lines: [{ id: "oi_1", quantity: 2, unitPriceZar: 3000, discountZar: 3000 }] });
      const res = await declineFreeCoffee("ord_1");
      expect(res).toEqual({ ok: true, data: { totalZar: 6000 } });
      expect(updatesOf(payments)).toEqual([]);
      expect(insertsInto(payments)).toEqual([]);
    }
  });

  it("a chargeable order with no attempt yet (beginTender refused, e.g. no machine) may still change: nothing to freeze", async () => {
    givenAppliedOrder({ totalZar: 3000, paymentMode: null, payment: null, lines: [{ id: "oi_1", quantity: 2, unitPriceZar: 3000, discountZar: 3000 }] });
    const res = await declineFreeCoffee("ord_1");
    expect(res).toEqual({ ok: true, data: { totalZar: 6000 } });
    expect(insertsInto(payments)).toEqual([]);
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
    givenAppliedOrder({ totalZar: 3000, paymentMode: null, payment: { id: "pay_1", status: "successful", sentAt: SENT, yocoPaymentId: "p_1" } });
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
      [payments, opts.payment ? [opts.payment] : []],
    ]);
  }

  it("applies one unit to an order with no tender attempt, keys the row on the customer, writes no payments row", async () => {
    givenOrder(OFFICE);
    const res = await applyFreeCoffee("ord_9", OFFICE.id);
    expect(res).toEqual({ ok: true, data: { totalZar: 3000 } });
    expect(insertsInto(staffEntitlementLog)).toEqual([
      { customerId: "cust_thabo", appliedByStaffId: "staff_louis", orderId: "ord_9", day: "2026-10-08" },
    ]);
    expect(updatesOf(orderItems)).toContainEqual({ discountZar: 3000 });
    expect(updatesOf(orders)).toContainEqual({ totalZar: 3000, isStaffDiscount: true, paymentMode: null });
    expect(updatesOf(payments)).toEqual([]);
    expect(mockStartTender).not.toHaveBeenCalled();
    const audit = mockWriteAudit.mock.calls.map((c) => c[0] as { action: string; after?: Row });
    expect(audit[0].action).toBe("free_cup");
    expect(audit[0].after).toMatchObject({ beneficiaryCustomerId: "cust_thabo" });
  });

  it("REQ-028: refused with TENDER_IN_PROGRESS while an attempt is open (owner rule)", async () => {
    givenOrder(OFFICE, { payment: { id: "pay_9", status: "pending", sentAt: SENT, yocoPaymentId: "p_9" } });
    const res = await applyFreeCoffee("ord_9", OFFICE.id);
    expect(res).toEqual(CANCEL_AND_RERING);
    expect(insertsInto(staffEntitlementLog)).toEqual([]);
    expect(updates).toEqual([]);
  });

  it("never deletes a payments row: taking a row-carrying order to R0 is refused instead", async () => {
    givenOrder(OFFICE, { quantity: 1, payment: { id: "pay_9", status: "declined", sentAt: SENT, yocoPaymentId: "p_9" } });
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
