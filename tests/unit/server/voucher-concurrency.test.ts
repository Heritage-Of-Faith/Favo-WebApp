// AT-204 review blocker: two removeVoucher calls on the same line, interleaved.
// The mocked DB below keeps state, applies updates, and makes
// SELECT … FOR UPDATE on `orders` a real lock held until the transaction ends
// (as Postgres does under READ COMMITTED). Before the fix, the line was read
// with no lock BEFORE the order lock, so the second caller kept a stale
// discount_zar and the line disagreed with its live voucher rows.
//
// CHANGED (AT-201 part 2b, owner decision 31 Oct 2026): the @/server/yoco/client
// mock is gone (the Yoco Online checkout client is retired), and a voucher
// change now races the tender chain's beginTender — run through the real
// Postgres TenderStore (src/server/tender/drizzle-store.ts) on this same mocked
// DB and its order lock. Exactly one wins; a payments row's amount is never
// updated; never two open attempts.
//
// Literal values: Cappuccino R38 = 3800; the order also has a paid R30 line.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { orders, orderItems, payments, openingSessions, voucherRedemptions } from "@db/schema";

vi.mock("@/server/auth/guard", () => ({
  authorize: vi.fn(async () => ({ ok: true, session: { id: "staff_nkuli", role: "barista" } })),
}));
// The audit write can be held open (a gate) to keep a transaction — and its
// order lock — alive while the other side arrives.
let auditGate: Promise<void> | null = null;
const mockWriteAudit = vi.fn(async (..._a: unknown[]) => { if (auditGate) await auditGate; });
vi.mock("@/server/audit", () => ({ writeAudit: (...a: unknown[]) => mockWriteAudit(...a) }));

type Row = Record<string, unknown>;
const state = new Map<unknown, Row[]>();
const paymentUpdates: Row[] = [];

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
  if (table === payments) {
    // Read by order (and attempt), ORDER BY attempt; or one row by id.
    const byId = all.filter((r) => ids.includes(r.id));
    if (byId.length) return byId;
    const nums = ids.filter((v): v is number => typeof v === "number");
    return all
      .filter((r) => ids.includes(r.orderId) && (nums.length === 0 || nums.includes(r.attempt as number)))
      .sort((a, b) => (a.attempt as number) - (b.attempt as number));
  }
  return all.filter((r) => ids.includes(r.id));
}

// One lock on the order row; waiters queue in arrival order.
let held: symbol | null = null;
let contended = 0;
const waiters: (() => void)[] = [];
async function acquire(owner: symbol) {
  if (held === owner) return;
  if (held) contended++;
  while (held) await new Promise<void>((r) => waiters.push(r));
  held = owner;
}
function release(owner: symbol) {
  if (held !== owner) return;
  held = null;
  waiters.shift()?.();
}

let seq = 0;
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
          if (table === payments) paymentUpdates.push(set);
          for (const r of matching(table, w)) Object.assign(r, set);
        },
      }),
    }),
    insert: (table: unknown) => ({
      values: (v: Row) => {
        const row: Row = {
          id: `pmt_${++seq}`, yocoPaymentId: null, chargedAmountZar: null, sentAt: null, lastCheckedAt: null, ...v,
        };
        if (table === payments) state.set(payments, [...(state.get(payments) ?? []), row]);
        return Object.assign(Promise.resolve(), { returning: async () => [{ ...row }] });
      },
    }),
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

import { db, type DB } from "@/lib/db";
import { removeVoucher } from "@/server/actions/vouchers";
import { beginTender, isAttemptOpen } from "@/server/tender/tender";
import { createDrizzleTenderStore } from "@/server/tender/drizzle-store";
import type { TenderDeps, TenderPayment } from "@/server/tender/types";

const AT1 = new Date("2026-10-11T18:20:00+02:00");
const AT2 = new Date("2026-10-11T18:21:00+02:00");
const NOW = new Date("2026-10-11T18:30:00+02:00");

async function until(cond: () => boolean) {
  for (let i = 0; i < 1000 && !cond(); i++) await Promise.resolve();
  expect(cond()).toBe(true);
}

function seed(opts: { liveVouchers: number; payments?: Row[] }) {
  // Gross R106 = R30 paid line + 2 × R38; each live voucher takes R38 off.
  const live = [
    { id: "vr_1", orderItemId: "oi_1", sessionId: "os_evening", discountZar: 3800, at: AT1, reversedAt: null },
    { id: "vr_2", orderItemId: "oi_1", sessionId: "os_evening", discountZar: 3800, at: AT2, reversedAt: null },
  ].slice(0, opts.liveVouchers);
  state.set(orderItems, [{
    id: "oi_1", orderId: "ord_1", quantity: 2, unitPriceZar: 3800, modsZar: 0,
    discountZar: 3800 * live.length, compReason: null,
  }]);
  state.set(orders, [{
    id: "ord_1", state: "ordered", totalZar: 10600 - 3800 * live.length, paymentMode: null, clientUuid: "cu-1",
    // AT-207: the orders row now carries written_off_at (NULL until the close writes it off).
    writtenOffAt: null,
  }]);
  state.set(payments, opts.payments ?? []);
  state.set(openingSessions, [{ id: "os_evening", closedAt: null, voucherRedemptionsRecorded: live.length }]);
  state.set(voucherRedemptions, live);
}

function tenderDeps(readDeviceId: () => Promise<string | null> = async () => "dev-1"): TenderDeps {
  return {
    store: createDrizzleTenderStore(db as unknown as DB),
    port: {} as never, // beginTender never sends
    now: () => NOW,
    readDeviceId,
    notify: { paymentUnresolved: vi.fn(async () => {}), duplicateCharge: vi.fn(async () => {}) },
  };
}
const ACTOR = { kind: "staff" as const, staffId: "staff_nkuli", role: "barista" };
const paymentRows = () => (state.get(payments) ?? []) as unknown as TenderPayment[];

beforeEach(() => {
  vi.clearAllMocks();
  state.clear();
  paymentUpdates.length = 0;
  auditGate = null;
  contended = 0;
  held = null;
});

describe("removeVoucher ×2 interleaved on one line (stale-read blocker)", () => {
  it("the line discount equals the live rows' sum, and the order total equals gross minus it", async () => {
    seed({ liveVouchers: 2 });
    state.get(orders)![0].paymentMode = "yoco_deferred";

    const [a, b] = await Promise.all([removeVoucher("oi_1"), removeVoucher("oi_1")]);
    expect(a.ok && b.ok).toBe(true);

    const line = state.get(orderItems)![0];
    const live = state.get(voucherRedemptions)!.filter((r) => r.reversedAt == null);
    const liveSum = live.reduce((s, r) => s + (r.discountZar as number), 0);
    expect(liveSum).toBe(0);
    expect(line.discountZar).toBe(liveSum);
    expect(state.get(orders)![0].totalZar).toBe(3000 + 2 * 3800 - liveSum); // R106
    expect(state.get(openingSessions)![0].voucherRedemptionsRecorded).toBe(live.length);
    // No payments row is written or changed by a voucher change.
    expect(paymentRows()).toEqual([]);
    expect(paymentUpdates).toEqual([]);
  });
});

describe("a voucher change racing beginTender on one order (P4, REQ-026, REQ-028)", () => {
  it("tender wins the order lock: the voucher change gets TENDER_IN_PROGRESS; amount_zar is the total tender read (R68)", async () => {
    seed({ liveVouchers: 1 }); // net R68
    let openGate!: () => void;
    const gate = new Promise<string>((r) => { openGate = () => r("dev-1"); });

    const t = beginTender(tenderDeps(() => gate), ACTOR, "ord_1");
    await until(() => held !== null); // beginTender holds the order lock
    const v = removeVoucher("oi_1");
    await until(() => contended > 0); // the voucher change is waiting on it
    openGate();
    const [tr, vr] = await Promise.all([t, v]);

    expect(tr).toMatchObject({ ok: true, attempt: 1, amountZar: 6800, clientReference: "cu-1:1" });
    expect(vr).toMatchObject({ ok: false, code: "TENDER_IN_PROGRESS" });
    // The voucher is still live; the order and the attempt still agree at R68.
    expect(state.get(voucherRedemptions)!.filter((r) => r.reversedAt == null)).toHaveLength(1);
    expect(state.get(orders)![0].totalZar).toBe(6800);
    expect(paymentRows().map((p) => [p.attempt, p.amountZar, p.status])).toEqual([[1, 6800, "pending"]]);
    expect(paymentUpdates).toEqual([]);
    // The refusal's reject audit was written (returned, not thrown, so it commits).
    expect(mockWriteAudit.mock.calls.map((c) => c[0] as { action: string; after?: Row })).toContainEqual(
      expect.objectContaining({ action: "reject", after: expect.objectContaining({ attempted: "remove_voucher", code: "TENDER_IN_PROGRESS" }) })
    );
  });

  it("the voucher change wins the order lock: the attempt beginTender then writes carries the NEW total (R106)", async () => {
    seed({ liveVouchers: 1 }); // net R68 → R106 after removal
    let openGate!: () => void;
    auditGate = new Promise<void>((r) => { openGate = r; });

    const v = removeVoucher("oi_1");
    await until(() => mockWriteAudit.mock.calls.length > 0); // inside its transaction, lock held
    const t = beginTender(tenderDeps(), ACTOR, "ord_1");
    await until(() => contended > 0); // beginTender is waiting on the order lock
    auditGate = null;
    openGate();
    const [vr, tr] = await Promise.all([v, t]);

    expect(vr).toEqual({ ok: true, data: { totalZar: 10600, lineDiscountZar: 0 } });
    expect(tr).toMatchObject({ ok: true, attempt: 1, amountZar: 10600 });
    expect(paymentRows().map((p) => [p.attempt, p.amountZar, p.status])).toEqual([[1, 10600, "pending"]]);
    expect(paymentUpdates).toEqual([]);
  });

  it("never two open attempts: a second beginTender behind the first is TENDER_IN_PROGRESS", async () => {
    seed({ liveVouchers: 1 });
    const [a, b] = await Promise.all([beginTender(tenderDeps(), ACTOR, "ord_1"), beginTender(tenderDeps(), ACTOR, "ord_1")]);
    expect([a.ok, b.ok].sort()).toEqual([false, true]);
    expect([a, b].find((r) => !r.ok)).toMatchObject({ code: "TENDER_IN_PROGRESS" });
    expect(paymentRows().filter(isAttemptOpen)).toHaveLength(1);
  });

  it("after a DECLINED attempt: the voucher change applies, no row is touched, and the next beginTender is attempt 2 at the new total", async () => {
    seed({
      liveVouchers: 1,
      payments: [{
        id: "pmt_d1", orderId: "ord_1", attempt: 1, clientReference: "cu-1:1", yocoPaymentId: "p_1",
        webposDeviceId: "dev-1", amountZar: 6800, chargedAmountZar: null, status: "declined",
        sentAt: AT2, lastCheckedAt: AT2, at: AT2,
      }],
    });
    expect(await removeVoucher("oi_1")).toEqual({ ok: true, data: { totalZar: 10600, lineDiscountZar: 0 } });
    expect(paymentUpdates).toEqual([]);
    expect(await beginTender(tenderDeps(), ACTOR, "ord_1")).toMatchObject({
      ok: true, attempt: 2, amountZar: 10600, clientReference: "cu-1:2",
    });
    expect(paymentRows().map((p) => [p.attempt, p.amountZar, p.status])).toEqual([
      [1, 6800, "declined"], [2, 10600, "pending"],
    ]);
    expect(paymentUpdates).toEqual([]);
  });
});
