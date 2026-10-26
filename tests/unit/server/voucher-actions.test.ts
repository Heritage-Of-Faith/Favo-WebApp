// AT-204 — the Untracked hot drink voucher through its server actions:
// redeemVoucher, removeVoucher, recordVoucherCount (PRD §6.9, §11, L41, L42,
// L43, COL-29; REQ-149, REQ-151, REQ-154, REQ-155, REQ-156, REQ-157).
// Literal values: a Cappuccino is R38,00 = 3800 cents.
//
// The DB is mocked: every select resolves rows by the table it reads, and
// every write is recorded so the test asserts what was written.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  orders, orderItems, payments, openingSessions, voucherRedemptions, eventWindows, staff,
} from "@db/schema";

vi.mock("@/server/auth/guard", () => ({
  authorize: vi.fn(async () => ({ ok: true, session: { id: "staff_thandeka", role: "barista" } })),
}));
const mockWriteAudit = vi.fn(async (..._a: unknown[]) => {});
vi.mock("@/server/audit", () => ({ writeAudit: (...a: unknown[]) => mockWriteAudit(...a) }));
const mockSendNotification = vi.fn(async (..._a: unknown[]) => ({}));
vi.mock("web-push", () => ({ default: { sendNotification: (...a: unknown[]) => mockSendNotification(...a) } }));
vi.mock("@/server/push/vapid", () => ({ initVapid: () => {} }));
const mockCreatePaymentIntent = vi.fn(async (..._a: unknown[]) => ({ id: "ch_1", clientSecret: "cs_1" }));
vi.mock("@/server/yoco/client", () => ({
  createPaymentIntent: (...a: unknown[]) => mockCreatePaymentIntent(...a),
}));

type Row = Record<string, unknown>;
let rows = new Map<unknown, Row[]>();
const inserts: { table: unknown; values: Row }[] = [];
const updates: { table: unknown; set: Row }[] = [];
const deletes: unknown[] = [];

function selectChain() {
  let table: unknown;
  const c: Record<string, unknown> = {};
  for (const m of ["where", "innerJoin", "leftJoin", "orderBy", "limit", "for"]) c[m] = () => c;
  c.from = (t: unknown) => { table = t; return c; };
  c.then = (resolve: (v: Row[]) => void, reject: (e: unknown) => void) =>
    Promise.resolve(rows.get(table) ?? []).then(resolve, reject);
  return c;
}
const client = {
  select: () => selectChain(),
  insert: (table: unknown) => ({
    values: (values: Row) => {
      inserts.push({ table, values });
      return Object.assign(Promise.resolve(), { returning: async () => [{ id: "vr_new" }] });
    },
  }),
  update: (table: unknown) => ({
    set: (set: Row) => ({ where: async () => { updates.push({ table, set }); } }),
  }),
  delete: (table: unknown) => ({ where: async () => { deletes.push(table); } }),
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

import { redeemVoucher, removeVoucher, recordVoucherCount } from "@/server/actions/vouchers";
import { closeSession } from "@/server/actions/opening";

// Sun 11 Oct 2026, 18:30 SAST — inside the Untracked Church window.
const SUNDAY_EVENING = new Date("2026-10-11T18:30:00+02:00");
const KIND = "untracked_hot_drink";

const SESSION = {
  id: "os_evening", sessionDate: "2026-10-11", opensAt: "18:00", mode: "event",
  voucherKindsActive: [KIND], eventWindowId: "evw_untracked", closedAt: null,
  voucherRedemptionsRecorded: 3, voucherSlipsCounted: null,
};
const WINDOW = { id: "evw_untracked", endsAt: new Date("2026-10-11T20:30:00+02:00") };
// An offline (yoco_deferred) order: chargeable and, by design, no payments row yet.
const DEFERRED_ORDER = { id: "ord_1", state: "ordered", totalZar: 7600, paymentMode: "yoco_deferred" };
const CAPPUCCINO_X2 = {
  id: "oi_1", orderId: "ord_1", quantity: 2, unitPriceZar: 3800, modsZar: 0, shots: 1,
  discountZar: 0, compReason: null,
};

function given(opts: {
  order?: Row; line?: Row; session?: Row | null; payment?: Row | null; live?: Row[];
} = {}) {
  rows = new Map<unknown, Row[]>([
    [orderItems, [opts.line ?? CAPPUCCINO_X2]],
    [orders, [opts.order ?? DEFERRED_ORDER]],
    [payments, opts.payment ? [opts.payment] : []],
    [openingSessions, opts.session === null ? [] : [opts.session ?? SESSION]],
    [eventWindows, [WINDOW]],
    [voucherRedemptions, opts.live ?? []],
    [staff, []],
  ]);
}

const insertsInto = (t: unknown) => inserts.filter((i) => i.table === t).map((i) => i.values);
const updatesOf = (t: unknown) => updates.filter((u) => u.table === t).map((u) => u.set);
const audits = () => mockWriteAudit.mock.calls.map((c) => c[0] as { action: string; after?: Row });
const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  vi.clearAllMocks();
  inserts.length = 0; updates.length = 0; deletes.length = 0;
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(SUNDAY_EVENING);
});
afterEach(() => vi.useRealTimers());

describe("redeemVoucher (REQ-154, REQ-151, L41)", () => {
  it("2 × Cappuccino R38 + one voucher → line discount R38, order net R38, one redemption row", async () => {
    given();
    const res = await redeemVoucher("oi_1", KIND);
    expect(res).toEqual({ ok: true, data: { totalZar: 3800, lineDiscountZar: 3800 } });

    expect(insertsInto(voucherRedemptions)).toEqual([
      expect.objectContaining({
        orderItemId: "oi_1", sessionId: "os_evening", voucherKind: KIND,
        discountZar: 3800, redeemedByStaffId: "staff_thandeka",
      }),
    ]);
    expect(updatesOf(orderItems)).toEqual([{ discountZar: 3800 }]);
    // The remaining R38 still goes to the machine: the order keeps its mode.
    expect(updatesOf(orders)).toEqual([{ totalZar: 3800, paymentMode: "yoco_deferred" }]);
    // voucher_redemptions_recorded follows the live rows: 3 → 4.
    expect(updatesOf(openingSessions)).toEqual([{ voucherRedemptionsRecorded: 4 }]);
    expect(audits().map((a) => a.action)).toEqual(["redeem_voucher"]);
    // Never touches payments.
    expect(insertsInto(payments)).toEqual([]);
    expect(updatesOf(payments)).toEqual([]);
  });

  it("REQ-149 / L42: the second voucher zeroes the order — R0, payment_mode='free', no payments row", async () => {
    given({
      order: { ...DEFERRED_ORDER, totalZar: 3800 },
      line: { ...CAPPUCCINO_X2, discountZar: 3800 },
      live: [{ id: "vr_1", discountZar: 3800, at: new Date("2026-10-11T18:20:00+02:00"), sessionId: "os_evening" }],
    });
    const res = await redeemVoucher("oi_1", KIND);
    expect(res).toEqual({ ok: true, data: { totalZar: 0, lineDiscountZar: 7600 } });
    expect(updatesOf(orders)).toEqual([{ totalZar: 0, paymentMode: "free" }]);
    expect(insertsInto(payments)).toEqual([]);
  });

  it("REQ-151: a third voucher on a quantity-2 line carrying two is rejected, and nothing is written", async () => {
    const at = new Date("2026-10-11T18:20:00+02:00");
    given({
      order: { ...DEFERRED_ORDER, totalZar: 0, paymentMode: "free" },
      line: { ...CAPPUCCINO_X2, discountZar: 7600 },
      live: [
        { id: "vr_1", discountZar: 3800, at, sessionId: "os_evening" },
        { id: "vr_2", discountZar: 3800, at, sessionId: "os_evening" },
      ],
    });
    const res = await redeemVoucher("oi_1", KIND);
    expect(res).toMatchObject({ ok: false, code: "VALIDATION" });
    expect(insertsInto(voucherRedemptions)).toEqual([]);
    expect(updates).toEqual([]);
    expect(audits().map((a) => a.action)).toEqual(["reject"]);
  });

  it("REQ-155: a weekday session → VOUCHER_NOT_IN_MODE", async () => {
    given({ session: { ...SESSION, mode: "weekday", voucherKindsActive: [], eventWindowId: null } });
    expect(await redeemVoucher("oi_1", KIND)).toMatchObject({ ok: false, code: "VOUCHER_NOT_IN_MODE" });
    expect(insertsInto(voucherRedemptions)).toEqual([]);
  });

  it("a kind the session does not carry → VOUCHER_NOT_IN_MODE", async () => {
    given();
    expect(await redeemVoucher("oi_1", "christmas")).toMatchObject({ ok: false, code: "VOUCHER_NOT_IN_MODE" });
  });

  it("no open session → NO_SESSION; a session past its window's end counts as none", async () => {
    given({ session: null });
    expect(await redeemVoucher("oi_1", KIND)).toMatchObject({ ok: false, code: "NO_SESSION" });
    given();
    vi.setSystemTime(new Date("2026-10-11T20:31:00+02:00"));
    expect(await redeemVoucher("oi_1", KIND)).toMatchObject({ ok: false, code: "NO_SESSION" });
  });

  it("L41: a line carrying the free cup is rejected", async () => {
    given({ line: { ...CAPPUCCINO_X2, discountZar: 3800 }, order: { ...DEFERRED_ORDER, totalZar: 3800 } });
    expect(await redeemVoucher("oi_1", KIND)).toMatchObject({ ok: false, code: "VALIDATION" });
    expect(insertsInto(voucherRedemptions)).toEqual([]);
  });

  // CHANGED (Mia, Q2(b)): a pending row with no Yoco checkout is repriced, as
  // applyFreeCoffee does; it used to be refused outright.
  it("a pending row with no checkout (R76) follows the order: 1 voucher → row R38", async () => {
    given({
      order: { ...DEFERRED_ORDER, paymentMode: null },
      payment: { id: "pay_1", status: "pending", yocoCheckoutId: null, yocoPaymentId: null },
    });
    expect(await redeemVoucher("oi_1", KIND)).toEqual({ ok: true, data: { totalZar: 3800, lineDiscountZar: 3800 } });
    expect(updatesOf(payments)).toEqual([{ amountZar: 3800 }]);
    expect(updatesOf(orders)).toEqual([{ totalZar: 3800, paymentMode: null }]);
    expect(insertsInto(payments)).toEqual([]);
  });

  it("with a pending row, the voucher that would take the order to R0 is refused as applyFreeCoffee refuses it (rows are never deleted)", async () => {
    given({
      order: { ...DEFERRED_ORDER, totalZar: 3800, paymentMode: null },
      line: { ...CAPPUCCINO_X2, discountZar: 3800 },
      live: [{ id: "vr_1", discountZar: 3800, at: new Date("2026-10-11T18:20:00+02:00"), sessionId: "os_evening" }],
      payment: { id: "pay_1", status: "pending", yocoCheckoutId: null, yocoPaymentId: null },
    });
    expect(await redeemVoucher("oi_1", KIND)).toMatchObject({ ok: false, code: "TENDER_IN_PROGRESS" });
    expect(insertsInto(voucherRedemptions)).toEqual([]);
    expect(updates).toEqual([]);
  });

  it("a row that already has a Yoco checkout → TENDER_IN_PROGRESS, nothing written", async () => {
    given({
      order: { ...DEFERRED_ORDER, paymentMode: null },
      payment: { id: "pay_1", status: "pending", yocoCheckoutId: "ch_1", yocoPaymentId: null },
    });
    expect(await redeemVoucher("oi_1", KIND)).toMatchObject({ ok: false, code: "TENDER_IN_PROGRESS" });
    expect(insertsInto(voucherRedemptions)).toEqual([]);
    expect(updates).toEqual([]);
  });

  it("a successful payment → ALREADY_RESOLVED", async () => {
    given({
      order: { ...DEFERRED_ORDER, paymentMode: null },
      payment: { id: "pay_1", status: "successful", yocoCheckoutId: null, yocoPaymentId: "p_1" },
    });
    expect(await redeemVoucher("oi_1", KIND)).toMatchObject({ ok: false, code: "ALREADY_RESOLVED" });
    expect(updates).toEqual([]);
  });

  it("a chargeable order with no payments row and no deferred mode is mid-createOrder → STALE_STATE", async () => {
    given({ order: { ...DEFERRED_ORDER, paymentMode: null } });
    expect(await redeemVoucher("oi_1", KIND)).toMatchObject({ ok: false, code: "STALE_STATE" });
    expect(insertsInto(voucherRedemptions)).toEqual([]);
  });

  it("an order already under way → ALREADY_RESOLVED", async () => {
    given({ order: { ...DEFERRED_ORDER, state: "in_progress" } });
    expect(await redeemVoucher("oi_1", KIND)).toMatchObject({ ok: false, code: "ALREADY_RESOLVED" });
  });
});

describe("removeVoucher (COL-29: a reversal, never a delete)", () => {
  const at1 = new Date("2026-10-11T18:20:00+02:00");
  const at2 = new Date("2026-10-11T18:21:00+02:00");

  it("reverses the latest live redemption, restores R38 to the line and the order, recounts the session", async () => {
    // The order also carries a paid R30 line, so it is not free: net R30 → R68.
    given({
      order: { ...DEFERRED_ORDER, totalZar: 3000, paymentMode: "yoco_deferred" },
      line: { ...CAPPUCCINO_X2, discountZar: 7600 },
      live: [
        { id: "vr_1", discountZar: 3800, at: at1, sessionId: "os_evening" },
        { id: "vr_2", discountZar: 3800, at: at2, sessionId: "os_evening" },
      ],
      session: { ...SESSION, voucherRedemptionsRecorded: 2 },
    });
    const res = await removeVoucher("oi_1");
    // CHANGED (Q3): the result also carries yocoClientSecret, as declineFreeCoffee's does.
    expect(res).toEqual({ ok: true, data: { totalZar: 6800, lineDiscountZar: 3800, yocoClientSecret: "" } });
    expect(updatesOf(voucherRedemptions)).toEqual([
      { reversedAt: SUNDAY_EVENING, reversedByStaffId: "staff_thandeka" },
    ]);
    expect(deletes).toEqual([]);
    expect(updatesOf(orderItems)).toEqual([{ discountZar: 3800 }]);
    expect(updatesOf(orders)).toEqual([{ totalZar: 6800, paymentMode: "yoco_deferred" }]);
    expect(updatesOf(openingSessions)).toEqual([{ voucherRedemptionsRecorded: 1 }]);
    expect(audits().map((a) => a.action)).toEqual(["remove_voucher"]);
  });

  // CHANGED (Q3): mirrors declineFreeCoffee — a free order made chargeable gets
  // a pending row at the new total BEFORE anything is sent, then a checkout.
  it("a free (R0) order made chargeable: pending row R38 written first, then the checkout", async () => {
    given({
      order: { ...DEFERRED_ORDER, totalZar: 0, paymentMode: "free" },
      line: { ...CAPPUCCINO_X2, discountZar: 7600 },
      live: [
        { id: "vr_1", discountZar: 3800, at: at1, sessionId: "os_evening" },
        { id: "vr_2", discountZar: 3800, at: at2, sessionId: "os_evening" },
      ],
    });
    const res = await removeVoucher("oi_1");
    expect(res).toEqual({ ok: true, data: { totalZar: 3800, lineDiscountZar: 3800, yocoClientSecret: "cs_1" } });
    expect(insertsInto(payments)).toEqual([{ orderId: "ord_1", amountZar: 3800, status: "pending" }]);
    expect(updatesOf(orders)).toEqual([{ totalZar: 3800, paymentMode: null }]);
    expect(mockCreatePaymentIntent).toHaveBeenCalledWith({ amountZar: 3800, metadata: { orderId: "ord_1" } });
    expect(updatesOf(payments)).toEqual([{ yocoCheckoutId: "ch_1" }]);
  });

  it("a pending row with no checkout is repriced (R38 → R76)", async () => {
    given({
      order: { ...DEFERRED_ORDER, totalZar: 3800, paymentMode: null },
      line: { ...CAPPUCCINO_X2, discountZar: 3800 },
      live: [{ id: "vr_1", discountZar: 3800, at: at1, sessionId: "os_evening" }],
      payment: { id: "pay_1", status: "pending", yocoCheckoutId: null, yocoPaymentId: null },
    });
    expect(await removeVoucher("oi_1")).toMatchObject({ ok: true, data: { totalZar: 7600 } });
    expect(updatesOf(payments)).toEqual([{ amountZar: 7600 }]);
    expect(mockCreatePaymentIntent).not.toHaveBeenCalled();
  });

  it("a row with a Yoco checkout → TENDER_IN_PROGRESS", async () => {
    given({
      order: { ...DEFERRED_ORDER, totalZar: 3800, paymentMode: null },
      line: { ...CAPPUCCINO_X2, discountZar: 3800 },
      live: [{ id: "vr_1", discountZar: 3800, at: at1, sessionId: "os_evening" }],
      payment: { id: "pay_1", status: "pending", yocoCheckoutId: "ch_1", yocoPaymentId: null },
    });
    expect(await removeVoucher("oi_1")).toMatchObject({ ok: false, code: "TENDER_IN_PROGRESS" });
    expect(updates).toEqual([]);
  });
});

describe("recordVoucherCount (L43, REQ-156)", () => {
  it("a count equal to the recorded figure is written and raises nothing", async () => {
    given({ session: { ...SESSION, voucherRedemptionsRecorded: 23 } });
    rows.set(staff, [{ id: "staff_admin", pushSubscription: { endpoint: "https://push/a", keys: { p256dh: "p", auth: "a" } } }]);
    const res = await recordVoucherCount("os_evening", 23);
    expect(res).toEqual({ ok: true, data: { counted: 23, recorded: 23 } });
    expect(updatesOf(openingSessions)).toEqual([{ voucherSlipsCounted: 23 }]);
    await flush();
    expect(mockSendNotification).not.toHaveBeenCalled();
  });

  it("REQ-156: a mismatch pushes the Admin with both figures", async () => {
    given({ session: { ...SESSION, voucherRedemptionsRecorded: 23 } });
    rows.set(staff, [{ id: "staff_admin", pushSubscription: { endpoint: "https://push/a", keys: { p256dh: "p", auth: "a" } } }]);
    const res = await recordVoucherCount("os_evening", 21);
    expect(res).toEqual({ ok: true, data: { counted: 21, recorded: 23 } });
    expect(audits()[0]).toMatchObject({ action: "voucher_count", after: { voucherSlipsCounted: 21, voucherRedemptionsRecorded: 23 } });
    await flush();
    expect(mockSendNotification).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(mockSendNotification.mock.calls[0][1] as string);
    expect(payload.data).toEqual({ sessionId: "os_evening", counted: 21, recorded: 23 });
    expect(payload.body).toContain("21");
    expect(payload.body).toContain("23");
  });

  it("rejects a negative or fractional count", async () => {
    given();
    expect(await recordVoucherCount("os_evening", -1)).toMatchObject({ ok: false, code: "VALIDATION" });
    expect(await recordVoucherCount("os_evening", 2.5)).toMatchObject({ ok: false, code: "VALIDATION" });
  });
});

describe("closeSession and the slip count (REQ-156, REQ-157)", () => {
  const ADMIN_SUB = [{ id: "staff_admin", pushSubscription: { endpoint: "https://push/a", keys: { p256dh: "p", auth: "a" } } }];

  it("REQ-157: no count → voucher_slips_counted stays NULL, the close completes, nothing is pushed", async () => {
    given({ session: { ...SESSION, voucherRedemptionsRecorded: 23 } });
    rows.set(staff, ADMIN_SUB);
    const res = await closeSession("os_evening");
    expect(res.ok).toBe(true);
    const set = updatesOf(openingSessions)[0];
    expect(set).not.toHaveProperty("voucherSlipsCounted");
    await flush();
    expect(mockSendNotification).not.toHaveBeenCalled();
  });

  it("REQ-156: a count differing from voucher_redemptions_recorded pushes both figures, and the close completes", async () => {
    given({ session: { ...SESSION, voucherRedemptionsRecorded: 23 } });
    rows.set(staff, ADMIN_SUB);
    const res = await closeSession("os_evening", 20);
    expect(res.ok).toBe(true);
    expect(updatesOf(openingSessions)[0]).toMatchObject({ voucherSlipsCounted: 20 });
    expect(audits()[0]).toMatchObject({
      action: "close", after: { voucherSlipsCounted: 20, voucherRedemptionsRecorded: 23 },
    });
    await flush();
    expect(mockSendNotification).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(mockSendNotification.mock.calls[0][1] as string);
    expect(payload.data).toEqual({ sessionId: "os_evening", counted: 20, recorded: 23 });
  });

  it("a matching count closes without a push", async () => {
    given({ session: { ...SESSION, voucherRedemptionsRecorded: 0 } });
    rows.set(staff, ADMIN_SUB);
    expect((await closeSession("os_evening", 0)).ok).toBe(true);
    await flush();
    expect(mockSendNotification).not.toHaveBeenCalled();
  });
});
