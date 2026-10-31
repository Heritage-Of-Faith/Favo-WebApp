// AT-204 review blocker: two removeVoucher calls on the same line, interleaved.
// The mocked DB below keeps state, applies updates, and makes
// SELECT … FOR UPDATE on `orders` a real lock held until the transaction ends
// (as Postgres does under READ COMMITTED). Before the fix, the line was read
// with no lock BEFORE the order lock, so the second caller kept a stale
// discount_zar and the line disagreed with its live voucher rows.
//
// Literal values: Cappuccino R38 = 3800; the order also has a paid R30 line.

import { describe, it, expect, vi } from "vitest";
import { orders, orderItems, payments, openingSessions, voucherRedemptions } from "@db/schema";

vi.mock("@/server/auth/guard", () => ({
  authorize: vi.fn(async () => ({ ok: true, session: { id: "staff_nkuli", role: "barista" } })),
}));
vi.mock("@/server/audit", () => ({ writeAudit: vi.fn(async () => {}) }));
vi.mock("@/server/yoco/client", () => ({ createPaymentIntent: vi.fn(async () => null) }));

type Row = Record<string, unknown>;
const state = new Map<unknown, Row[]>();

/** String parameters inside a drizzle where-expression (the ids it names). */
function params(x: unknown, out: unknown[] = [], seen = new Set<unknown>()): unknown[] {
  if (!x || typeof x !== "object" || seen.has(x)) return out;
  seen.add(x);
  if ((x as { constructor?: { name?: string } }).constructor?.name === "Param") {
    out.push((x as { value: unknown }).value);
    return out;
  }
  for (const v of Object.values(x as object)) params(v, out, seen);
  return out;
}
function matching(table: unknown, where: unknown): Row[] {
  const all = state.get(table) ?? [];
  const ids = params(where);
  if (table === voucherRedemptions) {
    // Every voucher_redemptions read and write here is over live rows.
    const live = all.filter((r) => r.reversedAt == null);
    const byId = live.filter((r) => ids.includes(r.id));
    return byId.length ? byId : live.filter((r) => ids.includes(r.orderItemId));
  }
  return all.filter((r) => ids.includes(r.id));
}

// One lock on the order row; waiters queue in arrival order.
let held: symbol | null = null;
const waiters: (() => void)[] = [];
async function acquire(owner: symbol) {
  if (held === owner) return;
  while (held) await new Promise<void>((r) => waiters.push(r));
  held = owner;
}
function release(owner: symbol) {
  if (held !== owner) return;
  held = null;
  waiters.shift()?.();
}

function client(owner: symbol) {
  return {
    select: () => {
      let table: unknown;
      let where: unknown;
      let lock = false;
      const c: Record<string, unknown> = {};
      for (const m of ["innerJoin", "leftJoin", "orderBy", "limit", "groupBy"]) c[m] = () => c;
      c.from = (t: unknown) => { table = t; return c; };
      c.where = (w: unknown) => { where = w; return c; };
      c.for = () => { lock = true; return c; };
      c.then = (resolve: (v: Row[]) => void, reject: (e: unknown) => void) =>
        (async () => {
          if (lock && table === orders) await acquire(owner);
          return matching(table, where).map((r) => ({ ...r }));
        })().then(resolve, reject);
      return c;
    },
    update: (table: unknown) => ({
      set: (set: Row) => ({
        where: async (w: unknown) => {
          for (const r of matching(table, w)) Object.assign(r, set);
        },
      }),
    }),
    insert: () => ({ values: () => Object.assign(Promise.resolve(), { returning: async () => [] }) }),
    delete: () => ({ where: async () => {} }),
  };
}

vi.mock("@/lib/db", () => ({
  db: {
    select: () => client(Symbol("autocommit")).select(),
    update: (t: unknown) => client(Symbol("autocommit")).update(t),
    transaction: async (cb: (tx: unknown) => Promise<unknown>) => {
      const owner = Symbol("tx");
      try {
        return await cb(client(owner));
      } finally {
        release(owner);
      }
    },
  },
}));

import { removeVoucher } from "@/server/actions/vouchers";

describe("removeVoucher ×2 interleaved on one line (stale-read blocker)", () => {
  it("the line discount equals the live rows' sum, and the order total equals gross minus it", async () => {
    const at1 = new Date("2026-10-11T18:20:00+02:00");
    const at2 = new Date("2026-10-11T18:21:00+02:00");
    state.set(orderItems, [{
      id: "oi_1", orderId: "ord_1", quantity: 2, unitPriceZar: 3800, modsZar: 0,
      discountZar: 7600, compReason: null,
    }]);
    // Gross R106 = R30 paid line + 2 × R38; both cappuccinos vouchered → net R30.
    state.set(orders, [{ id: "ord_1", state: "ordered", totalZar: 3000, paymentMode: "yoco_deferred" }]);
    state.set(payments, []);
    state.set(openingSessions, [{
      id: "os_evening", closedAt: null, voucherRedemptionsRecorded: 2,
    }]);
    state.set(voucherRedemptions, [
      { id: "vr_1", orderItemId: "oi_1", sessionId: "os_evening", discountZar: 3800, at: at1, reversedAt: null },
      { id: "vr_2", orderItemId: "oi_1", sessionId: "os_evening", discountZar: 3800, at: at2, reversedAt: null },
    ]);

    const [a, b] = await Promise.all([removeVoucher("oi_1"), removeVoucher("oi_1")]);
    expect(a.ok && b.ok).toBe(true);

    const line = state.get(orderItems)![0];
    const live = state.get(voucherRedemptions)!.filter((r) => r.reversedAt == null);
    const liveSum = live.reduce((s, r) => s + (r.discountZar as number), 0);
    expect(liveSum).toBe(0);
    expect(line.discountZar).toBe(liveSum);
    expect(state.get(orders)![0].totalZar).toBe(3000 + 2 * 3800 - liveSum); // R106
    expect(state.get(openingSessions)![0].voucherRedemptionsRecorded).toBe(live.length);
  });
});
