// REQ-046 / L28 — every order binds a notification target at ring-up:
// `customer` or an explicit `none`, never null, never defaulted into. PRD §10.3:
// `orders.notification_target (enum customer | none)`, and
// CHECK ((notification_target = 'customer') = (customer_id IS NOT NULL)).
// PRD §11 transitionOrder: "`ready` fires push to the registered customer and
// no-ops for target `none`".
//
// The DB is mocked: every select resolves rows by the table it reads, and
// every write is recorded so the test asserts what was written.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { orders, menuItems, menuCustomisations, customers, openingSessions, staffEntitlementLog } from "@db/schema";

vi.mock("@/server/auth/guard", () => ({
  authorize: vi.fn(async () => ({ ok: true, session: { id: "staff_louis", role: "barista" } })),
}));

const mockWriteAudit = vi.fn(async (..._a: unknown[]) => {});
vi.mock("@/server/audit", () => ({ writeAudit: (...a: unknown[]) => mockWriteAudit(...a) }));
vi.mock("@/server/queue/notify", () => ({ notifyOrderChange: vi.fn(async () => {}) }));
vi.mock("@/server/inventory/lot-picker", () => ({ checkRecipeStock: vi.fn(async () => ({ ok: true })) }));
vi.mock("@/server/orders/deduction", () => ({
  deductForOrder: vi.fn(async () => {}),
  DeductionError: class extends Error {},
}));
vi.mock("@/server/yoco/client", () => ({
  createPaymentIntent: vi.fn(async () => ({ id: "ch_1", clientSecret: "cs_1" })),
}));
const mockSendOrderReadyPush = vi.fn(async (..._a: unknown[]) => true);
vi.mock("@/server/push/send", () => ({
  sendOrderReadyPush: (...a: unknown[]) => mockSendOrderReadyPush(...a),
}));

// ─── Table-aware DB mock ──────────────────────────────────────────────────────
type Row = Record<string, unknown>;
let rows = new Map<unknown, Row[]>();
const inserts: { table: unknown; values: unknown }[] = [];
const updates: { table: unknown; set: Row }[] = [];

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

const client = {
  select: () => selectChain(),
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
    set: (set: Row) => ({
      where: () => {
        updates.push({ table, set });
        return Object.assign(Promise.resolve(), { returning: async () => [{ id: "cleared" }] });
      },
    }),
  }),
};

vi.mock("@/lib/db", () => ({
  db: {
    select: () => client.select(),
    insert: (t: unknown) => client.insert(t),
    update: (t: unknown) => client.update(t),
    transaction: async (cb: (tx: unknown) => Promise<unknown>) => cb(client),
  },
}));

import { createOrder, transitionOrder } from "@/server/actions/orders";

// ─── Fixtures ─────────────────────────────────────────────────────────────────
const AMERICANO = { id: "menu_americano", name: "Americano", category: "coffee", currentPriceZar: 3000, recipeId: null };
const NALEDI = { id: "cust_naledi", name: "Naledi", status: "church_member" };
const SUBSCRIPTION = { endpoint: "https://push.example/abc", keys: { p256dh: "p", auth: "a" } };
const one = { menuItemId: AMERICANO.id, quantity: 1, modifications: [] as string[] };

function readyOrder(over: Row): Row {
  return {
    id: "ord_1", state: "in_progress", totalZar: 3000, staffId: "staff_louis",
    isStaffDiscount: false, completedAt: null, revenueDay: "2026-10-11",
    placedAt: new Date("2026-10-11T09:00:00+02:00"),
    ...over,
  };
}

const insertsInto = (t: unknown) => inserts.filter((i) => i.table === t).map((i) => i.values as Row);
const updatesOf = (t: unknown) => updates.filter((u) => u.table === t).map((u) => u.set);
const auditActions = () => mockWriteAudit.mock.calls.map((c) => (c[0] as { action: string }).action);

beforeEach(() => {
  vi.clearAllMocks();
  inserts.length = 0;
  updates.length = 0;
  rows = new Map<unknown, Row[]>([
    [menuItems, [AMERICANO]],
    [menuCustomisations, []],
    [customers, [{ ...NALEDI, pushSubscription: SUBSCRIPTION }]],
    [openingSessions, [{ mode: "sunday" }]],
    [staffEntitlementLog, []],
  ]);
});

// ─── createOrder: L28 binding at ring-up ─────────────────────────────────────
describe("createOrder requires a notification target (L28, REQ-046)", () => {
  it("refuses an order with no target — 'none' is never defaulted into", async () => {
    const res = await createOrder({ items: [one] } as unknown as Parameters<typeof createOrder>[0]);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("INVALID_INPUT");
    expect(insertsInto(orders)).toHaveLength(0);
  });

  it("refuses target 'customer' with no customer bound (the CHECK's silent-failure shape)", async () => {
    const res = await createOrder({ notificationTarget: "customer", items: [one] });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("INVALID_INPUT");
    expect(insertsInto(orders)).toHaveLength(0);
  });

  it("refuses target 'none' alongside a bound customer", async () => {
    const res = await createOrder({ notificationTarget: "none", customerId: NALEDI.id, items: [one] });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("INVALID_INPUT");
    expect(insertsInto(orders)).toHaveLength(0);
  });

  it("a walk-in with explicit 'none' is written with notification_target = 'none' and no customer", async () => {
    const res = await createOrder({ notificationTarget: "none", items: [one] });
    expect(res.ok).toBe(true);
    expect(insertsInto(orders)).toHaveLength(1);
    expect(insertsInto(orders)[0]).toMatchObject({ notificationTarget: "none", customerId: null });
  });

  it("a registered customer is written with notification_target = 'customer' and their customer_id", async () => {
    const res = await createOrder({ notificationTarget: "customer", customerId: NALEDI.id, items: [one] });
    expect(res.ok).toBe(true);
    expect(insertsInto(orders)[0]).toMatchObject({ notificationTarget: "customer", customerId: NALEDI.id });
  });
});

// ─── transitionOrder('ready'): push or no-op ─────────────────────────────────
describe("transitionOrder → ready pushes for 'customer' and no-ops for 'none' (§11)", () => {
  it("Done on a registered customer's order sends the order-ready push to their subscription", async () => {
    rows.set(orders, [readyOrder({ customerId: NALEDI.id, notificationTarget: "customer" })]);
    const res = await transitionOrder("ord_1", "ready");
    expect(res.ok).toBe(true);
    expect(mockSendOrderReadyPush).toHaveBeenCalledTimes(1);
    expect(mockSendOrderReadyPush).toHaveBeenCalledWith(SUBSCRIPTION, "ord_1", "Naledi");
    expect(auditActions()).toContain("transition");
  });

  it("Done on a target-'none' order sends no push, and the transition is still audited", async () => {
    rows.set(orders, [readyOrder({ customerId: null, notificationTarget: "none" })]);
    const res = await transitionOrder("ord_1", "ready");
    expect(res.ok).toBe(true);
    expect(mockSendOrderReadyPush).not.toHaveBeenCalled();
    expect(mockWriteAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "transition", before: { state: "in_progress" }, after: { state: "ready" } }),
      expect.anything()
    );
  });

  it("the push keys off notification_target, not customer_id: target 'none' never pushes", async () => {
    // The CHECK makes this row impossible in the database; the code must still
    // read the bound target rather than infer it from customer_id.
    rows.set(orders, [readyOrder({ customerId: NALEDI.id, notificationTarget: "none" })]);
    await transitionOrder("ord_1", "ready");
    expect(mockSendOrderReadyPush).not.toHaveBeenCalled();
  });

  it("a 410 Gone prunes the stale subscription and audits push_unsubscribe", async () => {
    rows.set(orders, [readyOrder({ customerId: NALEDI.id, notificationTarget: "customer" })]);
    mockSendOrderReadyPush.mockResolvedValueOnce(false); // send.ts maps 404/410 to false
    await transitionOrder("ord_1", "ready");
    await vi.waitFor(() => expect(auditActions()).toContain("push_unsubscribe"));
    expect(updatesOf(customers)).toContainEqual({ pushSubscription: null });
  });
});
