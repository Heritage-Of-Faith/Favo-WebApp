// AT-204 — vouchers at order placement (createOrder). PRD §6.9.1, §6.9.2a,
// L41, L42, REQ-149, REQ-150, REQ-151, REQ-153. Literal money: a Cappuccino is
// R38,00 = 3800 cents, a Hot Chocolate R32,00 = 3200 cents (test fixtures).
//
// The DB is mocked as in free-cup-actions.test.ts: every select resolves rows
// by the table it reads; every write is recorded so the test asserts it.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  orders, orderItems, menuItems, menuCustomisations, customers, payments,
  staffEntitlementLog, openingSessions, voucherRedemptions,
} from "@db/schema";

vi.mock("@/server/auth/guard", () => ({
  authorize: vi.fn(async () => ({ ok: true, session: { id: "staff_louis", role: "barista" } })),
}));
const mockWriteAudit = vi.fn(async (..._a: unknown[]) => {});
vi.mock("@/server/audit", () => ({ writeAudit: (...a: unknown[]) => mockWriteAudit(...a) }));
vi.mock("@/server/queue/notify", () => ({ notifyOrderChange: vi.fn(async () => {}) }));
vi.mock("@/server/inventory/lot-picker", () => ({ checkRecipeStock: vi.fn(async () => ({ ok: true })) }));
// AT-201 part 2b: createOrder begins the tender through the chain (beginTender
// writes the pending row inside src/server/tender/, at the committed total).
// createOrder itself never writes payments and never creates a Yoco checkout.
const mockStartTender = vi.fn(async (_actor: unknown, _orderId: string) => ({
  ok: true as const, paymentId: "pmt_1", attempt: 1, clientReference: "cu:1", amountZar: 3800,
}));
vi.mock("@/server/tender/service", () => ({
  startTender: (actor: unknown, orderId: string) => mockStartTender(actor, orderId),
}));

type Row = Record<string, unknown>;
let rows = new Map<unknown, Row[]>();
const inserts: { table: unknown; values: unknown }[] = [];
const updates: { table: unknown; set: Row }[] = [];

function selectChain() {
  let table: unknown;
  const c: Record<string, unknown> = {};
  for (const m of ["where", "innerJoin", "leftJoin", "orderBy", "limit", "for"]) c[m] = () => c;
  c.from = (t: unknown) => { table = t; return c; };
  c.then = (resolve: (v: Row[]) => void, reject: (e: unknown) => void) =>
    Promise.resolve(rows.get(table) ?? []).then(resolve, reject);
  return c;
}
function insertChain(table: unknown) {
  return {
    values: (values: unknown) => {
      inserts.push({ table, values });
      return Object.assign(Promise.resolve(), {
        onConflictDoNothing: () => ({ returning: async () => [{ id: "ent_1" }] }),
        returning: async () => (Array.isArray(values) ? values.map((_, i) => ({ id: `vr_${i + 1}` })) : [{ id: "vr_1" }]),
      });
    },
  };
}
const client = {
  select: () => selectChain(),
  insert: (t: unknown) => insertChain(t),
  update: (table: unknown) => ({ set: (set: Row) => ({ where: async () => { updates.push({ table, set }); } }) }),
};
vi.mock("@/lib/db", () => ({
  db: {
    select: () => client.select(),
    insert: (t: unknown) => client.insert(t),
    update: (t: unknown) => client.update(t),
    transaction: async (cb: (tx: unknown) => Promise<unknown>) => cb(client),
  },
}));

import { createOrder } from "@/server/actions/orders";

const CAPPUCCINO = { id: "menu_cappuccino", name: "Cappuccino", category: "coffee", currentPriceZar: 3800, recipeId: null };
const HOT_CHOC = { id: "menu_hot_choc", name: "Hot Chocolate", category: "hot_chocolate", currentPriceZar: 3200, recipeId: null };
const KIND = "untracked_hot_drink";

// Sun 11 Oct 2026, 18:30 SAST (Untracked Church); Thu 8 Oct 2026, 09:00 SAST.
const SUNDAY_EVENING = new Date("2026-10-11T18:30:00+02:00");
const THURSDAY = new Date("2026-10-08T09:00:00+02:00");

function session(mode: "sunday" | "event" | "weekday", date: string, kinds: string[]) {
  return {
    id: "sess_1", sessionDate: date, mode, voucherKindsActive: kinds,
    eventWindowId: null, voucherRedemptionsRecorded: 4,
  };
}
function given(opts: { sessions: Row[] }) {
  rows = new Map<unknown, Row[]>([
    [menuItems, [CAPPUCCINO, HOT_CHOC]],
    [menuCustomisations, []],
    [customers, []],
    [openingSessions, opts.sessions],
    [staffEntitlementLog, []],
  ]);
}
const sundayEvent = () => given({ sessions: [session("event", "2026-10-11", [KIND])] });

const insertsInto = (t: unknown) => inserts.filter((i) => i.table === t).map((i) => i.values);
const updatesOf = (t: unknown) => updates.filter((u) => u.table === t).map((u) => u.set);
// No `legacy:` client_reference or device is written anywhere (AT-201 part 2b).
const noLegacy = () =>
  expect(JSON.stringify([inserts.map((i) => i.values), updates.map((u) => u.set)])).not.toContain("legacy:");
const ACTOR = { kind: "staff", staffId: "staff_louis", role: "barista" };
const audits = () => mockWriteAudit.mock.calls.map((c) => c[0] as { action: string; reason?: string; after?: Row });
const line = (id: string, quantity: number, voucherCount?: number) => ({
  menuItemId: id, quantity, modifications: [] as string[], ...(voucherCount === undefined ? {} : { voucherCount }),
});

beforeEach(() => {
  vi.clearAllMocks();
  inserts.length = 0; updates.length = 0;
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(SUNDAY_EVENING);
});
afterEach(() => vi.useRealTimers());

describe("createOrder with vouchers (§6.9, L41, L42)", () => {
  it("1 Cappuccino R38 + 1 voucher → total R0, payment_mode free, no payments row, nothing sent to Yoco (REQ-149, REQ-153)", async () => {
    sundayEvent();
    const res = await createOrder({ notificationTarget: "none", items: [line(CAPPUCCINO.id, 1, 1)] });

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.totalZar).toBe(0);
    expect(res.data.cardCheckout).toBe(false);
    // CHANGED (AT-201 part 2b): REQ-153 — no tender at all, so no payments row and nothing sent.
    expect(res.data.tender).toBeNull();
    expect(insertsInto(orders)[0]).toMatchObject({ totalZar: 0, paymentMode: "free" });
    const [items] = insertsInto(orderItems) as Row[][];
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ quantity: 1, unitPriceZar: 3800, discountZar: 3800 });
    expect(insertsInto(payments)).toEqual([]);
    expect(mockStartTender).not.toHaveBeenCalled();
    noLegacy();

    // One voucher_redemptions row, redeemed by the barista, against the line.
    const [redemptions] = insertsInto(voucherRedemptions) as Row[][];
    expect(redemptions).toEqual([
      {
        orderItemId: items[0].id, sessionId: "sess_1", voucherKind: KIND,
        discountZar: 3800, redeemedByStaffId: "staff_louis", at: SUNDAY_EVENING,
      },
    ]);
    expect(typeof items[0].id).toBe("string");
    // The session's recorded count steps up by one (4 → 5).
    expect(updatesOf(openingSessions)).toEqual([{ voucherRedemptionsRecorded: 5 }]);
    expect(audits().map((a) => a.action)).toEqual(["create", "redeem_voucher"]);
  });

  // CHANGED (AT-201 part 2b, owner decision 31 Oct 2026): createOrder writes no
  // payments row itself and creates no Yoco checkout; it begins the tender
  // (beginTender, at the committed R38) only after the order is written.
  it("2 × Cappuccino + 1 voucher → total R38, line discount R38; the tender is begun for the order, createOrder writes no payments row (REQ-150, REQ-151, REQ-026)", async () => {
    sundayEvent();
    const res = await createOrder({ notificationTarget: "none", items: [line(CAPPUCCINO.id, 2, 1)] });

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.totalZar).toBe(3800);
    expect(insertsInto(orders)[0]).toMatchObject({ totalZar: 3800, paymentMode: null });
    const [items] = insertsInto(orderItems) as Row[][];
    expect(items[0]).toMatchObject({ quantity: 2, unitPriceZar: 3800, discountZar: 3800 });
    expect(insertsInto(payments)).toEqual([]);
    expect(updatesOf(payments)).toEqual([]);
    expect(mockStartTender).toHaveBeenCalledTimes(1);
    expect(mockStartTender).toHaveBeenCalledWith(ACTOR, res.data.orderId);
    expect(res.data.tender).toEqual({ ok: true, attempt: 1, amountZar: 3800 });
    expect(res.data.cardCheckout).toBe(true);
    noLegacy();
    expect(insertsInto(voucherRedemptions)[0]).toHaveLength(1);
    expect(updatesOf(openingSessions)).toEqual([{ voucherRedemptionsRecorded: 5 }]);
  });

  it("T10: vouchered Hot Chocolate beside a paid Cappuccino → the order (and so the tender) is R38 alone; no row at createOrder, no checkout (REQ-150)", async () => {
    sundayEvent();
    const res = await createOrder({ notificationTarget: "none", items: [line(HOT_CHOC.id, 1, 1), line(CAPPUCCINO.id, 1)] });

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.totalZar).toBe(3800);
    // beginTender reads orders.total_zar under the order lock: this is what the card is asked for.
    expect(insertsInto(orders)[0]).toMatchObject({ totalZar: 3800 });
    const [items] = insertsInto(orderItems) as Row[][];
    expect(items.map((i) => i.discountZar)).toEqual([3200, 0]);
    expect(insertsInto(payments)).toEqual([]);
    expect(mockStartTender).toHaveBeenCalledWith(ACTOR, res.data.orderId);
    noLegacy();
  });

  it("T9: 2 × Hot Chocolate with 2 vouchers + 3 × Cappuccino with 3 → R0, five rows, no payments row (REQ-149)", async () => {
    sundayEvent();
    const res = await createOrder({ notificationTarget: "none", items: [line(HOT_CHOC.id, 2, 2), line(CAPPUCCINO.id, 3, 3)] });

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.totalZar).toBe(0);
    const [items] = insertsInto(orderItems) as Row[][];
    expect(items.map((i) => i.discountZar)).toEqual([6400, 11400]);
    const [redemptions] = insertsInto(voucherRedemptions) as Row[][];
    expect(redemptions.map((r) => r.discountZar)).toEqual([3200, 3200, 3800, 3800, 3800]);
    expect(insertsInto(orders)[0]).toMatchObject({ totalZar: 0, paymentMode: "free" });
    expect(insertsInto(payments)).toEqual([]);
    expect(mockStartTender).not.toHaveBeenCalled();
    expect(res.data.tender).toBeNull();
    expect(updatesOf(openingSessions)).toEqual([{ voucherRedemptionsRecorded: 9 }]);
  });

  it("3 vouchers on quantity 2 → VALIDATION; nothing written; the refusal is audited (REQ-151)", async () => {
    sundayEvent();
    const res = await createOrder({ notificationTarget: "none", items: [line(CAPPUCCINO.id, 2, 3)] });

    expect(res).toMatchObject({ ok: false, code: "VALIDATION" });
    expect(insertsInto(orders)).toEqual([]);
    expect(insertsInto(voucherRedemptions)).toEqual([]);
    expect(insertsInto(payments)).toEqual([]);
    expect(mockStartTender).not.toHaveBeenCalled();
    expect(audits()).toEqual([expect.objectContaining({ action: "reject", reason: "VALIDATION" })]);
  });

  it("weekday session → VOUCHER_NOT_IN_MODE; nothing written; audited", async () => {
    vi.setSystemTime(THURSDAY);
    given({ sessions: [session("weekday", "2026-10-08", [])] });
    const res = await createOrder({ notificationTarget: "none", items: [line(CAPPUCCINO.id, 1, 1)], voucherKind: KIND });

    expect(res).toMatchObject({ ok: false, code: "VOUCHER_NOT_IN_MODE" });
    expect(insertsInto(orders)).toEqual([]);
    expect(insertsInto(payments)).toEqual([]);
    expect(audits()).toEqual([expect.objectContaining({ action: "reject", reason: "VOUCHER_NOT_IN_MODE" })]);
  });

  it("a kind not in the session's voucher_kinds_active → VOUCHER_NOT_IN_MODE", async () => {
    given({ sessions: [session("sunday", "2026-10-11", [])] });
    const res = await createOrder({ notificationTarget: "none", items: [line(CAPPUCCINO.id, 1, 1)] });
    expect(res).toMatchObject({ ok: false, code: "VOUCHER_NOT_IN_MODE" });
    expect(insertsInto(orders)).toEqual([]);
  });

  it("no open session → NO_SESSION; nothing written; audited", async () => {
    given({ sessions: [] });
    const res = await createOrder({ notificationTarget: "none", items: [line(CAPPUCCINO.id, 1, 1)] });

    expect(res).toMatchObject({ ok: false, code: "NO_SESSION" });
    expect(insertsInto(orders)).toEqual([]);
    expect(insertsInto(payments)).toEqual([]);
    expect(audits()).toEqual([expect.objectContaining({ action: "reject", reason: "NO_SESSION" })]);
  });

  it("a Sunday order without vouchers: no session read for vouchers, no item id, a tender begun at R38 (no row written by createOrder)", async () => {
    given({ sessions: [] }); // no session needed when no voucher is carried
    const res = await createOrder({ notificationTarget: "none", items: [line(CAPPUCCINO.id, 1)] });

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.totalZar).toBe(3800);
    const [items] = insertsInto(orderItems) as Row[][];
    expect(items[0]).not.toHaveProperty("id");
    expect(items[0]).toMatchObject({ discountZar: 0 });
    expect(insertsInto(voucherRedemptions)).toEqual([]);
    expect(updatesOf(openingSessions)).toEqual([]);
    expect(insertsInto(payments)).toEqual([]);
    expect(mockStartTender).toHaveBeenCalledWith(ACTOR, res.data.orderId);
    expect(res.data.tender).toEqual({ ok: true, attempt: 1, amountZar: 3800 });
    noLegacy();
  });
});
