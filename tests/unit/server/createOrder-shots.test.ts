// AT-202 part 1 — createOrder takes a per-line `shots`, refuses a line above
// the mode's ceiling before anything is written (REQ-138, REQ-144), and lands
// the extra-shot surcharge on the order_items line (REQ-104, REQ-136, DEC-16).
//
// Literal values from PRD v7.0 §15 "Shot pricing, at every step": a R20.00
// cappuccino on a Sunday at 1, 2, 3, 4 shots → R20.00 · R20.00 · R30.00 ·
// R40.00; a quantity-2 line at 3 shots → R60.00. §12: extra_shot_zar 1000,
// max_shots_per_line 4, max_shots_weekday 2.
//
// The DB is mocked: every select resolves rows by the table it reads, and
// every write is recorded so the test asserts what was written.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  orders, orderItems, menuItems, menuCustomisations, customers, payments,
  staffEntitlementLog, openingSessions, appConfig, recipeIngredients,
} from "@db/schema";

vi.mock("@/server/auth/guard", () => ({
  authorize: vi.fn(async () => ({ ok: true, session: { id: "staff_louis", role: "barista" } })),
}));
vi.mock("@/server/audit", () => ({ writeAudit: vi.fn(async () => {}) }));
vi.mock("@/server/queue/notify", () => ({ notifyOrderChange: vi.fn(async () => {}) }));
vi.mock("@/server/inventory/lot-picker", () => ({ checkRecipeStock: vi.fn(async () => ({ ok: true })) }));

// The stub reads the order's COMMITTED total, as beginTender does — so
// tender.amountZar is what the payments row and the card machine would carry.
function committedOrderTotal(): number {
  const inserted = inserts.filter((i) => i.table === orders).map((i) => i.values as Row);
  let total = inserted[inserted.length - 1]?.totalZar as number;
  for (const u of updates) if (u.table === orders && typeof u.set.totalZar === "number") total = u.set.totalZar;
  return total;
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
import { readShotPolicy } from "@/server/orders/shot-policy";
import { db } from "@/lib/db";

// ─── Fixtures ─────────────────────────────────────────────────────────────────
const CAPPUCCINO = { id: "menu_cappuccino", name: "Cappuccino", category: "coffee", currentPriceZar: 2000, recipeId: "rec_capp" };
const HOT_CHOC = { id: "menu_choc", name: "Hot Chocolate", category: "other", currentPriceZar: 2000, recipeId: "rec_choc" };
const OFFICE = { id: "cust_thabo", name: "Thabo", status: "office_staff" };
const SUNDAY = new Date("2026-10-11T09:00:00+02:00");
const THURSDAY = new Date("2026-10-08T09:00:00+02:00");

function given(opts: { modes?: string[]; config?: Row[]; customer?: Row | null }) {
  rows = new Map<unknown, Row[]>([
    [menuItems, [CAPPUCCINO, HOT_CHOC]],
    // The coffee-recipe lookup (ingredient kind 'bean'): only the cappuccino holds coffee.
    [recipeIngredients, [{ recipeId: "rec_capp" }]],
    [menuCustomisations, []],
    [customers, opts.customer ? [opts.customer] : []],
    [openingSessions, (opts.modes ?? []).map((mode) => ({ mode }))],
    [staffEntitlementLog, []],
    [appConfig, opts.config ?? []],
  ]);
}

const insertsInto = (t: unknown) => inserts.filter((i) => i.table === t).map((i) => i.values);
const itemRows = () => (insertsInto(orderItems)[0] ?? []) as Row[];
const capp = (shots: number, quantity = 1) => ({ menuItemId: CAPPUCCINO.id, quantity, modifications: [] as string[], shots });
const walkIn = (items: ReturnType<typeof capp>[]) => createOrder({ notificationTarget: "none", items });

function expectNothingWritten() {
  expect(inserts).toEqual([]);
  expect(updates).toEqual([]);
  expect(mockStartTender).not.toHaveBeenCalled();
}

beforeEach(() => {
  vi.clearAllMocks();
  inserts.length = 0; updates.length = 0;
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(SUNDAY);
});
afterEach(() => vi.useRealTimers());

describe("Sunday: the extra-shot surcharge lands on the line (REQ-104, REQ-136)", () => {
  it("FIXTURE: R20.00 cappuccino at 1, 2, 3, 4 shots → R20.00 · R20.00 · R30.00 · R40.00; four lines", async () => {
    given({ modes: ["sunday"] });
    const res = await walkIn([capp(1), capp(2), capp(3), capp(4)]);

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(itemRows().map((r) => ({ shots: r.shots, surchargeZar: r.surchargeZar, unitPriceZar: r.unitPriceZar }))).toEqual([
      { shots: 1, surchargeZar: 0, unitPriceZar: 2000 },
      { shots: 2, surchargeZar: 0, unitPriceZar: 2000 },
      { shots: 3, surchargeZar: 1000, unitPriceZar: 2000 },
      { shots: 4, surchargeZar: 2000, unitPriceZar: 2000 },
    ]);
    // 2000 + 2000 + 3000 + 4000
    expect(res.data.totalZar).toBe(11000);
    expect(insertsInto(orders)[0]).toMatchObject({ totalZar: 11000 });
  });

  it("FIXTURE: a quantity-2 line at 3 shots → R60.00; the payment amount carries the surcharge", async () => {
    given({ modes: ["sunday"] });
    const res = await walkIn([capp(3, 2)]);

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(itemRows()[0]).toMatchObject({ quantity: 2, shots: 3, surchargeZar: 1000 }); // per unit
    expect(res.data.totalZar).toBe(6000);
    expect(res.data.tender).toEqual({ ok: true, attempt: 1, amountZar: 6000 });
  });

  it("4 shots is accepted on a Sunday; 5 is refused before anything is written", async () => {
    given({ modes: ["sunday"] });
    expect((await walkIn([capp(4)])).ok).toBe(true);

    inserts.length = 0; updates.length = 0; vi.clearAllMocks();
    const res = await walkIn([capp(5)]);
    expect(res).toEqual({ ok: false, code: "SHOTS_ABOVE_CEILING", message: "A drink takes at most 4 shots." });
    expectNothingWritten();
  });

  it("extra_shot_zar is read from app_config (an Admin change needs no deploy, T09)", async () => {
    given({ modes: ["sunday"], config: [{ key: "extra_shot_zar", value: 1200 }] });
    const res = await walkIn([capp(3)]);
    expect(res.ok && res.data.totalZar).toBe(3200);
    expect(itemRows()[0]).toMatchObject({ surchargeZar: 1200 });
  });

  it("an order with only 1-shot lines is priced exactly as before (surcharge 0)", async () => {
    given({ modes: ["sunday"] });
    const res = await createOrder({ notificationTarget: "none", items: [{ menuItemId: CAPPUCCINO.id, quantity: 1, modifications: [] }] });
    expect(res.ok && res.data.totalZar).toBe(2000);
    expect(itemRows()[0]).toMatchObject({ shots: 1, surchargeZar: 0 });
  });
});

describe("Weekday: ceiling 2, no surcharge (REQ-138, REQ-144, T15)", () => {
  beforeEach(() => vi.setSystemTime(THURSDAY));

  it.each([3, 4])("a write of %i shots is refused at the application layer; nothing is written", async (shots) => {
    given({ modes: ["weekday"] });
    const res = await walkIn([capp(shots)]);
    expect(res).toEqual({ ok: false, code: "SHOTS_ABOVE_CEILING", message: "Weekday drinks take at most 2 shots." });
    expectNothingWritten();
  });

  it("one line above the ceiling refuses the whole order", async () => {
    given({ modes: ["weekday"] });
    const res = await walkIn([capp(1), capp(3)]);
    expect(res.ok).toBe(false);
    expectNothingWritten();
  });

  it("2 shots is accepted at the listed price (surcharge 0)", async () => {
    given({ modes: ["weekday"] });
    const res = await walkIn([capp(2)]);
    expect(res.ok && res.data.totalZar).toBe(2000);
    expect(itemRows()[0]).toMatchObject({ shots: 2, surchargeZar: 0 });
  });

  it("the free weekday cup is unaffected: an office cup at 2 shots is free; total 0, no tender", async () => {
    given({ modes: ["weekday"], customer: OFFICE });
    const res = await createOrder({ notificationTarget: "customer", customerId: OFFICE.id, items: [capp(2)] });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.freeCup).toMatchObject({ applied: true, discountZar: 2000 });
    expect(res.data.totalZar).toBe(0);
    expect(itemRows()[0]).toMatchObject({ shots: 2, surchargeZar: 0, discountZar: 2000 });
    expect(mockStartTender).not.toHaveBeenCalled();
  });
});

describe("No session today: fail closed (weekday ceiling, no surcharge)", () => {
  it("3 shots on a Sunday with no session is refused, and the copy says why", async () => {
    given({ modes: [] });
    const res = await walkIn([capp(3)]);
    expect(res).toEqual({
      ok: false, code: "SHOTS_ABOVE_CEILING",
      message: "Open today's session first — until then a drink takes at most 2 shots.",
    });
    expectNothingWritten();
  });
});

describe("L48: a drink with no coffee takes no extra shots (SHOTS_NOT_ALLOWED)", () => {
  const choc = (shots: number) => ({ menuItemId: HOT_CHOC.id, quantity: 1, modifications: [] as string[], shots });

  it("a hot chocolate at 2 shots on a Sunday is refused before anything is written", async () => {
    given({ modes: ["sunday"] });
    const res = await createOrder({ notificationTarget: "none", items: [choc(2)] });
    expect(res).toEqual({
      ok: false, code: "SHOTS_NOT_ALLOWED",
      message: "Hot Chocolate has no coffee in it, so it can't take extra shots.",
    });
    expectNothingWritten();
  });

  it("a hot chocolate at 1 shot is accepted at its listed price", async () => {
    given({ modes: ["sunday"] });
    const res = await createOrder({ notificationTarget: "none", items: [choc(1)] });
    expect(res.ok && res.data.totalZar).toBe(2000);
    expect(itemRows()[0]).toMatchObject({ shots: 1, surchargeZar: 0 });
  });

  it("a cappuccino at 3 shots beside a 1-shot hot chocolate is still R30.00 + R20.00", async () => {
    given({ modes: ["sunday"] });
    const res = await createOrder({ notificationTarget: "none", items: [capp(3), choc(1)] });
    expect(res.ok && res.data.totalZar).toBe(5000);
    expect(itemRows().map((r) => r.surchargeZar)).toEqual([1000, 0]);
  });
});

describe("readShotPolicy exposes config fallbacks; createOrder prices with the PRD default", () => {
  it("a stored string extra_shot_zar is named in configFallbacks; a Sunday triple is still R30.00", async () => {
    given({ modes: ["sunday"], config: [{ key: "extra_shot_zar", value: "1200" }] });
    const policy = await readShotPolicy(db, "2026-10-11");
    expect(policy.configFallbacks).toEqual(["extra_shot_zar"]);
    expect(policy.extraShotZar).toBe(1000);

    const res = await walkIn([capp(3)]);
    expect(res.ok && res.data.totalZar).toBe(3000);
  });

  it("valid stored values → no fallbacks", async () => {
    given({ modes: ["sunday"], config: [{ key: "extra_shot_zar", value: 1000 }] });
    expect((await readShotPolicy(db, "2026-10-11")).configFallbacks).toEqual([]);
  });
});

describe("input validation", () => {
  it.each([0, -1, 2.5])("shots = %s is invalid input", async (shots) => {
    given({ modes: ["sunday"] });
    const res = await walkIn([capp(shots)]);
    expect(res).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expectNothingWritten();
  });

  it("the same drink at two shot counts stays two lines (L37); nothing merges by menu item", async () => {
    given({ modes: ["sunday"] });
    await walkIn([capp(2), capp(3), capp(2)]);
    expect(itemRows().map((r) => r.shots)).toEqual([2, 3, 2]);
  });

  it("payments rows are never written by createOrder itself", async () => {
    given({ modes: ["sunday"] });
    await walkIn([capp(3)]);
    expect(insertsInto(payments)).toEqual([]);
  });
});
