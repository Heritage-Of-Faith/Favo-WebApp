// Event switches in createOrder — PRD v7.0 §6.6, §6.0.8 (T7), L25, S7a,
// REQ-042, REQ-045, DEC-18 (the free mechanism reused).
//
// REQ-045: "Given payment_posture='free' · When orders are placed · Then zero
// payments are sent to the machine, no card prompt appears, and
// payment_mode='free'".
// §6.0.8 T7: "Ordering off-menu scope → MODE_FORBIDDEN with the named reason —
// 'Not on the Discipleship 101 menu'"; "At 20:30 … The next order simply
// prices and behaves normally".
// §6.6: the extra-shot surcharge is "Inert under payment_posture='free'"; a
// paid social "may want the R10 a third shot carries".
//
// Literal values: §7.0.1 Cappuccino R20 = 2000 cents, Americano R20 = 2000;
// §7.0.1 / T09 extra shot R10 = 1000 per shot beyond the second.
// Discipleship 101: every Wednesday 18:30–20:30 (§6.6 worked example).

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  orders, orderItems, menuItems, menuCustomisations, customers, payments,
  staffEntitlementLog, openingSessions, eventWindows, appConfig, recipeIngredients, voucherRedemptions,
} from "@db/schema";

vi.mock("@/server/auth/guard", () => ({
  authorize: vi.fn(async () => ({ ok: true, session: { id: "staff_louis", role: "barista" } })),
}));
const mockWriteAudit = vi.fn(async (..._a: unknown[]) => {});
vi.mock("@/server/audit", () => ({ writeAudit: (...a: unknown[]) => mockWriteAudit(...a) }));
vi.mock("@/server/queue/notify", () => ({ notifyOrderChange: vi.fn(async () => {}) }));
vi.mock("@/server/inventory/lot-picker", () => ({ checkRecipeStock: vi.fn(async () => ({ ok: true })) }));

// The stub reads the order's COMMITTED total, as beginTender does.
function committedOrderTotal(): number {
  const inserted = inserts.filter((i) => i.table === orders).map((i) => i.values as Row);
  return inserted[inserted.length - 1]?.totalZar as number;
}
const mockStartTender = vi.fn(async (..._a: unknown[]) => ({
  ok: true as const, paymentId: "pmt_1", attempt: 1, clientReference: "cu-1:1", amountZar: committedOrderTotal(),
}));
vi.mock("@/server/tender/service", () => ({
  startTender: (...a: unknown[]) => mockStartTender(...a),
  TENDER_NOT_BEGUN: { ok: false, code: "TENDER_NOT_BEGUN", message: "x", retryOffered: true },
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

const client = {
  select: () => selectChain(),
  selectDistinct: () => selectChain(),
  insert: (table: unknown) => ({
    values: (values: unknown) => {
      inserts.push({ table, values });
      return Object.assign(Promise.resolve(), {
        onConflictDoNothing: () => ({ returning: async () => [{ id: "ent_1" }] }),
        returning: async () => [{ id: "new_1" }],
      });
    },
  }),
  update: (table: unknown) => ({
    set: (set: Row) => ({ where: async () => { updates.push({ table, set }); } }),
  }),
};

vi.mock("@/lib/db", () => ({
  db: {
    select: () => client.select(),
    selectDistinct: () => client.selectDistinct(),
    insert: (t: unknown) => client.insert(t),
    update: (t: unknown) => client.update(t),
    transaction: async (cb: (tx: unknown) => Promise<unknown>) => cb(client),
  },
}));

import { createOrder } from "@/server/actions/orders";

// ─── Fixtures ─────────────────────────────────────────────────────────────────
const CAPPUCCINO = { id: "menu_cappuccino", name: "Cappuccino", category: "coffee", currentPriceZar: 2000, recipeId: "rec_capp" };
const AMERICANO = { id: "menu_americano", name: "Americano", category: "coffee", currentPriceZar: 2000, recipeId: "rec_amer" };
const ROOIBOS = { id: "menu_rooibos", name: "Rooibos Tea", category: "tea", currentPriceZar: 2000, recipeId: null };
const OFFICE = { id: "cust_thabo", name: "Thabo", status: "office_staff" };

const WED_EVENING = new Date("2026-10-07T19:00:00+02:00");  // inside Discipleship 101
const WED_MORNING = new Date("2026-10-07T09:00:00+02:00");
const SAT_NOON = new Date("2026-10-10T12:00:00+02:00");      // inside the Saturday social
const SAT_AFTER = new Date("2026-10-10T15:00:00+02:00");     // after it ended

const D101 = {
  id: "evw_d101", name: "Discipleship 101",
  startsAt: new Date("2026-10-07T18:30:00+02:00"), endsAt: new Date("2026-10-07T20:30:00+02:00"),
  menuScope: "coffee_only", paymentPosture: "free", consumesCupLid: true, audience: "church_member",
  extraShotSurcharge: false, voucherKinds: [],
};
const SAT_SOCIAL = {
  id: "evw_social", name: "Youth Social",
  startsAt: new Date("2026-10-10T10:00:00+02:00"), endsAt: new Date("2026-10-10T14:00:00+02:00"),
  menuScope: "full", paymentPosture: "standard", consumesCupLid: true, audience: "both",
  extraShotSurcharge: true, voucherKinds: [],
};

/** sessions: a mode string, or a window bound to an event-mode session. */
function given(opts: { date: string; sessions: (string | Row)[]; customer?: Row | null }) {
  const windows = opts.sessions.filter((s): s is Row => typeof s !== "string");
  rows = new Map<unknown, Row[]>([
    [menuItems, [CAPPUCCINO, AMERICANO, ROOIBOS]],
    [recipeIngredients, [{ recipeId: "rec_capp" }, { recipeId: "rec_amer" }]],
    [menuCustomisations, []],
    [customers, opts.customer ? [opts.customer] : []],
    [openingSessions, opts.sessions.map((s) => typeof s === "string"
      ? { sessionDate: opts.date, mode: s, eventWindowId: null }
      : { sessionDate: opts.date, mode: "event", eventWindowId: s.id, opensAt: (s.sessionOpensAt as string | undefined) ?? null })],
    [eventWindows, windows],
    [staffEntitlementLog, []],
    [appConfig, []],
  ]);
}

const insertsInto = (t: unknown) => inserts.filter((i) => i.table === t).map((i) => i.values);
const orderRow = () => insertsInto(orders)[0] as Row;
const itemRows = () => (insertsInto(orderItems)[0] ?? []) as Row[];
const line = (item: { id: string }, quantity = 1, shots = 1) =>
  ({ menuItemId: item.id, quantity, modifications: [] as string[], shots });

beforeEach(() => {
  vi.clearAllMocks();
  inserts.length = 0; updates.length = 0;
  vi.useFakeTimers({ toFake: ["Date"] });
});
afterEach(() => vi.useRealTimers());

describe("REQ-045 / L25: a free-posture event — Discipleship 101 on a Wednesday", () => {
  it("zero payments sent, no tender, payment_mode 'free', every line zeroed (R40.00 gross → R0)", async () => {
    vi.setSystemTime(WED_EVENING);
    given({ date: "2026-10-07", sessions: ["weekday", D101] });
    const res = await createOrder({ notificationTarget: "none", items: [line(CAPPUCCINO), line(AMERICANO)] });

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.totalZar).toBe(0);
    expect(res.data.tender).toBeNull();
    expect(res.data.cardCheckout).toBe(false);
    expect(mockStartTender).not.toHaveBeenCalled();
    expect(insertsInto(payments)).toEqual([]);
    expect(orderRow()).toMatchObject({ paymentMode: "free", totalZar: 0 });
    // DEC-18's mechanism: the menu price is kept and discount_zar zeroes the line.
    expect(itemRows().map((r) => ({ unitPriceZar: r.unitPriceZar, discountZar: r.discountZar }))).toEqual([
      { unitPriceZar: 2000, discountZar: 2000 },
      { unitPriceZar: 2000, discountZar: 2000 },
    ]);
  });

  it("a quantity-2 line is zeroed whole: R40.00 discounted, total R0", async () => {
    vi.setSystemTime(WED_EVENING);
    given({ date: "2026-10-07", sessions: [D101] });
    const res = await createOrder({ notificationTarget: "none", items: [line(CAPPUCCINO, 2)] });
    expect(res.ok && res.data.totalZar).toBe(0);
    expect(itemRows()[0]).toMatchObject({ quantity: 2, unitPriceZar: 2000, discountZar: 4000 });
  });

  it("an office staff member at the free event: free, and no weekday entitlement row is spent (L03 is weekday mode)", async () => {
    vi.setSystemTime(WED_EVENING);
    given({ date: "2026-10-07", sessions: [D101], customer: OFFICE });
    const res = await createOrder({ notificationTarget: "customer", customerId: OFFICE.id, items: [line(CAPPUCCINO)] });
    expect(res.ok && res.data.totalZar).toBe(0);
    expect(orderRow()).toMatchObject({ paymentMode: "free", totalZar: 0 });
    expect(insertsInto(staffEntitlementLog)).toEqual([]);
    expect(mockStartTender).not.toHaveBeenCalled();
  });

  it("§6.6: the extra-shot surcharge is inert under a free posture — a triple is written with surcharge 0, R0", async () => {
    vi.setSystemTime(WED_EVENING);
    given({ date: "2026-10-07", sessions: [D101] });
    const res = await createOrder({ notificationTarget: "none", items: [line(CAPPUCCINO, 1, 3)] });
    expect(res.ok && res.data.totalZar).toBe(0);
    expect(itemRows()[0]).toMatchObject({ shots: 3, surchargeZar: 0, unitPriceZar: 2000, discountZar: 2000 });
    expect(mockStartTender).not.toHaveBeenCalled();
  });

  it("§6.0.8: off the coffee-only menu → MODE_FORBIDDEN 'Not on the Discipleship 101 menu', audited, nothing written", async () => {
    vi.setSystemTime(WED_EVENING);
    given({ date: "2026-10-07", sessions: [D101] });
    const res = await createOrder({ notificationTarget: "none", items: [line(CAPPUCCINO), line(ROOIBOS)] });
    expect(res).toEqual({ ok: false, code: "MODE_FORBIDDEN", message: "Not on the Discipleship 101 menu" });
    expect(insertsInto(orders)).toEqual([]);
    expect(insertsInto(orderItems)).toEqual([]);
    expect(mockStartTender).not.toHaveBeenCalled();
    // §10.3.2: denials are audited, written on their own (no tx handed in).
    const reject = mockWriteAudit.mock.calls.find((c) => (c[0] as Row).action === "reject");
    expect(reject?.[0]).toMatchObject({ reason: "MODE_FORBIDDEN", after: expect.objectContaining({ why: "off_menu_scope", eventWindowId: "evw_d101" }) });
    expect(reject?.[1]).toBeUndefined();
  });

  it("L41: a voucher on a free-posture order is refused, nothing written", async () => {
    vi.setSystemTime(WED_EVENING);
    given({ date: "2026-10-07", sessions: [{ ...D101, voucherKinds: ["untracked_hot_drink"] }] });
    const res = await createOrder({ notificationTarget: "none", items: [{ ...line(CAPPUCCINO), voucherCount: 1 }] });
    expect(res).toMatchObject({ ok: false, code: "VALIDATION" });
    expect(insertsInto(orders)).toEqual([]);
    expect(insertsInto(voucherRedemptions)).toEqual([]);
  });
});

describe("the same Wednesday's morning is untouched by the evening event (§6.11.1, COL-8)", () => {
  it("09:00, weekday session + Discipleship 101 session on the day: still weekday free, entitlement applied", async () => {
    vi.setSystemTime(WED_MORNING);
    given({ date: "2026-10-07", sessions: ["weekday", D101], customer: OFFICE });
    const res = await createOrder({ notificationTarget: "customer", customerId: OFFICE.id, items: [line(CAPPUCCINO)] });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.totalZar).toBe(0);
    expect(res.data.freeCup).toMatchObject({ applied: true });
    expect(orderRow()).toMatchObject({ paymentMode: "free", totalZar: 0 });
    expect(insertsInto(staffEntitlementLog)).toHaveLength(1);
    expect(mockStartTender).not.toHaveBeenCalled();
  });
});

describe("a standard-posture event charges, with its own surcharge switch (§6.6, L31)", () => {
  it("Saturday social, surcharge charged: a triple cappuccino is R30.00, tender begun for 3000", async () => {
    vi.setSystemTime(SAT_NOON);
    given({ date: "2026-10-10", sessions: [SAT_SOCIAL] });
    const res = await createOrder({ notificationTarget: "none", items: [line(CAPPUCCINO, 1, 3)] });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.totalZar).toBe(3000);
    expect(orderRow()).toMatchObject({ paymentMode: "yoco", totalZar: 3000 });
    expect(itemRows()[0]).toMatchObject({ shots: 3, surchargeZar: 1000, discountZar: 0 });
    expect(res.data.tender).toEqual({ ok: true, attempt: 1, amountZar: 3000 });
  });

  it("Saturday social, surcharge not charged: the same triple is R20.00", async () => {
    vi.setSystemTime(SAT_NOON);
    given({ date: "2026-10-10", sessions: [{ ...SAT_SOCIAL, extraShotSurcharge: false }] });
    const res = await createOrder({ notificationTarget: "none", items: [line(CAPPUCCINO, 1, 3)] });
    expect(res.ok && res.data.totalZar).toBe(2000);
    expect(itemRows()[0]).toMatchObject({ shots: 3, surchargeZar: 0 });
    expect(res.ok && res.data.tender).toEqual({ ok: true, attempt: 1, amountZar: 2000 });
  });

  it("a full-menu event sells the tea", async () => {
    vi.setSystemTime(SAT_NOON);
    given({ date: "2026-10-10", sessions: [SAT_SOCIAL] });
    const res = await createOrder({ notificationTarget: "none", items: [line(ROOIBOS)] });
    expect(res.ok && res.data.totalZar).toBe(2000);
  });

  it("REQ-042: a free event's window has ended — the next order is not free", async () => {
    vi.setSystemTime(SAT_AFTER);
    given({ date: "2026-10-10", sessions: [{ ...SAT_SOCIAL, paymentPosture: "free" }] });
    const res = await createOrder({ notificationTarget: "none", items: [line(CAPPUCCINO)] });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.totalZar).toBe(2000);
    expect(orderRow()).toMatchObject({ paymentMode: "yoco", totalZar: 2000 });
    expect(mockStartTender).toHaveBeenCalledTimes(1);
  });
});

// DEC-28 (owner, Mia, 11 Nov 2026).
// (d) §10.3 / §11 createOrder "Tags event_window_id when an event is in force".
// (a) §4.2: the event applies from the SESSION's opening ("an evening session
//     opened at 17:45 for an 18:00 service still finds it").
// (b) a paid event on a weekday (Thursday) is allowed and charges.
describe("DEC-28: event attribution, the session's opening, and a paid weekday event", () => {
  const THU_SOCIAL = {
    id: "evw_thu", name: "Thursday Social",
    startsAt: new Date("2026-10-08T18:00:00+02:00"), endsAt: new Date("2026-10-08T21:00:00+02:00"),
    menuScope: "full", paymentPosture: "standard", consumesCupLid: true, audience: "both",
    extraShotSurcharge: true, voucherKinds: [], sessionOpensAt: "17:45",
  };

  it("(d) a paid event order is stamped with its window; a free event order too", async () => {
    vi.setSystemTime(SAT_NOON);
    given({ date: "2026-10-10", sessions: [SAT_SOCIAL] });
    await createOrder({ notificationTarget: "none", items: [line(CAPPUCCINO)] });
    expect(orderRow()).toMatchObject({ eventWindowId: "evw_social", paymentMode: "yoco", totalZar: 2000 });

    inserts.length = 0;
    vi.setSystemTime(WED_EVENING);
    given({ date: "2026-10-07", sessions: ["weekday", D101] });
    await createOrder({ notificationTarget: "none", items: [line(CAPPUCCINO)] });
    expect(orderRow()).toMatchObject({ eventWindowId: "evw_d101", paymentMode: "free", totalZar: 0 });
  });

  it("(d) no event in force → event_window_id NULL (the weekday morning, and after ends_at)", async () => {
    vi.setSystemTime(WED_MORNING);
    given({ date: "2026-10-07", sessions: ["weekday", D101] });
    await createOrder({ notificationTarget: "none", items: [line(CAPPUCCINO)] });
    expect(orderRow()).toMatchObject({ eventWindowId: null, paymentMode: "free" });

    inserts.length = 0;
    vi.setSystemTime(SAT_AFTER);
    given({ date: "2026-10-10", sessions: [SAT_SOCIAL] });
    await createOrder({ notificationTarget: "none", items: [line(CAPPUCCINO)] });
    expect(orderRow()).toMatchObject({ eventWindowId: null });
  });

  it("(a) Thursday 17:50, session opened 17:45 for an 18:00 paid event: the event already applies — R30.00 triple, stamped", async () => {
    vi.setSystemTime(new Date("2026-10-08T17:50:00+02:00"));
    given({ date: "2026-10-08", sessions: [THU_SOCIAL] });
    const res = await createOrder({ notificationTarget: "none", items: [line(CAPPUCCINO, 1, 3)] });
    expect(res.ok && res.data.totalZar).toBe(3000);
    expect(orderRow()).toMatchObject({ eventWindowId: "evw_thu", paymentMode: "yoco", totalZar: 3000 });
  });

  it("(a) a free event opened 17:45 for 18:00: a 17:50 order is free, never charged", async () => {
    vi.setSystemTime(new Date("2026-10-08T17:50:00+02:00"));
    given({ date: "2026-10-08", sessions: [{ ...THU_SOCIAL, paymentPosture: "free", extraShotSurcharge: false }] });
    const res = await createOrder({ notificationTarget: "none", items: [line(CAPPUCCINO)] });
    expect(res.ok && res.data.totalZar).toBe(0);
    expect(orderRow()).toMatchObject({ eventWindowId: "evw_thu", paymentMode: "free", totalZar: 0 });
    expect(mockStartTender).not.toHaveBeenCalled();
  });

  it("(b) a paid Thursday event is not weekday-free: R20.00 owed, payment_mode 'yoco', no entitlement row", async () => {
    vi.setSystemTime(new Date("2026-10-08T19:00:00+02:00"));
    given({ date: "2026-10-08", sessions: [THU_SOCIAL], customer: OFFICE });
    const res = await createOrder({ notificationTarget: "customer", customerId: OFFICE.id, items: [line(CAPPUCCINO)] });
    expect(res.ok && res.data.totalZar).toBe(2000);
    expect(orderRow()).toMatchObject({ eventWindowId: "evw_thu", paymentMode: "yoco", totalZar: 2000 });
    expect(insertsInto(staffEntitlementLog)).toEqual([]);
  });
});
