// createOrder while the till is in deferred mode — PRD v7.0 §6.0.4 T3 step 2
// ("createOrder(payment_mode='yoco_deferred') | orders · order_items" — no
// payments row), §6.7 "While deferred", T3 "The tender step is replaced, not
// skipped", S7a ("'free' wins … deferred mode is inert under a free posture:
// no order is created deferred").
//
// The DB is mocked as in createOrder-shots.test.ts: every select resolves rows
// by the table it reads; every write is recorded.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { orders, menuItems, menuCustomisations, customers, staffEntitlementLog, openingSessions, appConfig, recipeIngredients, payments } from "@db/schema";

vi.mock("@/server/auth/guard", () => ({
  authorize: vi.fn(async () => ({ ok: true, session: { id: "staff_louis", role: "barista" } })),
}));
vi.mock("@/server/audit", () => ({ writeAudit: vi.fn(async () => {}) }));
vi.mock("@/server/queue/notify", () => ({ notifyOrderChange: vi.fn(async () => {}) }));
vi.mock("@/server/inventory/lot-picker", () => ({ checkRecipeStock: vi.fn(async () => ({ ok: true })) }));
const mockStartTender = vi.fn(async (..._a: unknown[]) => ({
  ok: true as const, paymentId: "pmt_1", attempt: 1, clientReference: "cu-1:1", amountZar: 2000,
}));
vi.mock("@/server/tender/service", () => ({
  startTender: (...a: unknown[]) => mockStartTender(...a),
  TENDER_NOT_BEGUN: { ok: false, code: "TENDER_NOT_BEGUN", message: "x", retryOffered: true },
}));

type Row = Record<string, unknown>;
let rows = new Map<unknown, Row[]>();
const inserts: { table: unknown; values: unknown }[] = [];

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
  update: () => ({ set: () => ({ where: async () => {} }) }),
};
vi.mock("@/lib/db", () => ({
  db: {
    select: () => client.select(),
    selectDistinct: () => client.selectDistinct(),
    insert: (t: unknown) => client.insert(t),
    update: () => client.update(),
    transaction: async (cb: (tx: unknown) => Promise<unknown>) => cb(client),
  },
}));

import { createOrder } from "@/server/actions/orders";

const CAPPUCCINO = { id: "menu_cappuccino", name: "Cappuccino", category: "coffee", currentPriceZar: 2000, recipeId: "rec_capp" };
const SUNDAY = new Date("2026-11-08T09:00:00+02:00");
const THURSDAY = new Date("2026-11-05T09:00:00+02:00");

/** The one open session, as readOpenSessionDeferred and the mode read both see it. */
function given(mode: string, deferred: boolean) {
  rows = new Map<unknown, Row[]>([
    [menuItems, [CAPPUCCINO]],
    [recipeIngredients, [{ recipeId: "rec_capp" }]],
    [menuCustomisations, []],
    [customers, []],
    [openingSessions, [{
      id: "sess-1", mode, deferredSince: deferred ? new Date("2026-11-08T07:00:00Z") : null,
      deferredEnteredBy: deferred ? "manual" : null, deferredReason: deferred ? "terminal_unreachable" : null,
    }]],
    [staffEntitlementLog, []],
    [appConfig, []],
  ]);
}
const orderRow = () => inserts.find((i) => i.table === orders)?.values as Row;
const walkIn = () => createOrder({ notificationTarget: "none", items: [{ menuItemId: CAPPUCCINO.id, quantity: 1, modifications: [], shots: 1 }] });

beforeEach(() => {
  vi.clearAllMocks();
  inserts.length = 0;
  vi.useFakeTimers({ toFake: ["Date"] });
});
afterEach(() => vi.useRealTimers());

describe("T3 step 2 — orders taken while deferred", () => {
  it("a Sunday R20.00 order is written 'yoco_deferred'; no tender begins and no payments row is written", async () => {
    vi.setSystemTime(SUNDAY);
    given("sunday", true);
    const res = await walkIn();
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(orderRow()).toMatchObject({ paymentMode: "yoco_deferred", totalZar: 2000, state: "ordered" });
    expect(mockStartTender).not.toHaveBeenCalled();
    expect(inserts.filter((i) => i.table === payments)).toEqual([]);
    expect(res.data.tender).toBeNull();
    expect(res.data.deferred).toBe(true);
  });

  it("not deferred: unchanged — 'yoco', and ONE tender begins", async () => {
    vi.setSystemTime(SUNDAY);
    given("sunday", false);
    const res = await walkIn();
    expect(orderRow()).toMatchObject({ paymentMode: "yoco" });
    expect(mockStartTender).toHaveBeenCalledTimes(1);
    expect(res.ok && res.data.deferred).toBeFalsy();
  });

  it("S7a: a weekday order while deferred is still 'free' — deferred mode is inert where nobody pays", async () => {
    vi.setSystemTime(THURSDAY);
    given("weekday", true);
    const res = await walkIn();
    expect(orderRow()).toMatchObject({ paymentMode: "free", totalZar: 0 });
    expect(mockStartTender).not.toHaveBeenCalled();
    expect(res.ok && res.data.deferred).toBeFalsy();
  });
});
