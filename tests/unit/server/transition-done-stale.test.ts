// REQ-047 / REQ-015 / S7: `completed_at` is the moment the barista taps Done
// (`in_progress → ready`), stamped once, and a later `ready → collected` never
// moves it — the sweep and §05's order-to-cup metric both read it.
// REQ-023 / S9: a backwards or repeated transition is rejected with
// STALE_STATE, nothing but the refusal's audit row is written, and that row
// commits (returned from the transaction, never thrown — CLAUDE.md §5).

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { orders } from "@db/schema";

vi.mock("@/server/auth/guard", () => ({
  authorize: vi.fn(async () => ({ ok: true, session: { id: "staff_louis", role: "barista", name: "Louis" } })),
}));
const mockWriteAudit = vi.fn(async (..._a: unknown[]) => {});
vi.mock("@/server/audit", () => ({ writeAudit: (...a: unknown[]) => mockWriteAudit(...a) }));
vi.mock("@/server/queue/notify", () => ({ notifyOrderChange: vi.fn(async () => {}) }));
vi.mock("@/server/push/send", () => ({ sendOrderReadyPush: vi.fn(async () => true) }));
const mockDeduct = vi.fn(async () => []);
vi.mock("@/server/orders/deduction", () => ({
  deductForOrder: () => mockDeduct(),
  DeductionError: class extends Error {},
}));
vi.mock("@/server/orders/order-cogs", () => ({ writeOrderCogs: vi.fn(async () => {}) }));

type Row = Record<string, unknown>;
let rows = new Map<unknown, Row[]>();
const sets: { table: unknown; values: Row }[] = [];
let committed = false;

function selectChain() {
  let table: unknown;
  const c: Record<string, unknown> = {};
  for (const m of ["where", "orderBy", "limit", "for", "leftJoin", "innerJoin"]) c[m] = () => c;
  c.from = (t: unknown) => { table = t; return c; };
  c.then = (resolve: (v: Row[]) => void, reject: (e: unknown) => void) =>
    Promise.resolve(rows.get(table) ?? []).then(resolve, reject);
  return c;
}
const client = {
  select: () => selectChain(),
  update: (table: unknown) => ({
    set: (values: Row) => ({ where: async () => { sets.push({ table, values }); } }),
  }),
  insert: () => ({ values: () => ({ returning: async () => [{ id: "x" }] }) }),
};
vi.mock("@/lib/db", () => ({
  db: {
    select: () => client.select(),
    transaction: async (cb: (tx: unknown) => Promise<unknown>) => {
      const r = await cb(client);
      committed = true;
      return r;
    },
  },
}));

import { transitionOrder } from "@/server/actions/orders";

const DONE_AT = "2026-10-11T07:12:00.000Z";
const COLLECT_TAP_AT = "2026-10-11T07:15:00.000Z";

function seed(state: string, completedAt: Date | null) {
  rows = new Map<unknown, Row[]>([
    [orders, [{
      id: "ord-1", state, totalZar: 0, paymentMode: "free", writtenOffAt: null, completedAt,
      customerId: null, notificationTarget: "none", staffId: "staff_louis",
      placedAt: new Date("2026-10-11T07:05:00.000Z"),
    }]],
  ]);
}

const orderSets = () => sets.filter((s) => s.table === orders).map((s) => s.values);

beforeEach(() => {
  vi.clearAllMocks();
  sets.length = 0;
  committed = false;
  vi.useFakeTimers({ toFake: ["Date"] });
});
afterEach(() => {
  vi.useRealTimers();
});

describe("Done stamps completed_at (REQ-047, REQ-015, S7)", () => {
  it("in_progress → ready sets completed_at to the moment of Done", async () => {
    vi.setSystemTime(new Date(DONE_AT));
    seed("in_progress", null);
    await transitionOrder("ord-1", "ready");
    expect(orderSets()).toEqual([{ state: "ready", completedAt: new Date(DONE_AT) }]);
  });

  it("a ready → collected tap leaves completed_at at the Done time", async () => {
    vi.setSystemTime(new Date(COLLECT_TAP_AT));
    seed("ready", new Date(DONE_AT));
    await transitionOrder("ord-1", "collected");
    expect(orderSets()).toEqual([{ state: "collected", completedAt: new Date(DONE_AT) }]);
  });

  it("ordered → in_progress does not stamp completed_at", async () => {
    vi.setSystemTime(new Date("2026-10-11T07:08:00.000Z"));
    seed("ordered", null);
    await transitionOrder("ord-1", "in_progress");
    expect(orderSets()).toEqual([{ state: "in_progress", completedAt: null }]);
  });
});

describe("a refused transition is STALE_STATE and audited (REQ-023, S9)", () => {
  it.each([
    ["ready", "ready"],
    ["in_progress", "in_progress"],
    ["ready", "in_progress"],
    ["collected", "ready"],
    ["cancelled", "in_progress"],
  ] as const)("%s → %s: STALE_STATE, nothing written, exactly one reject audit row that commits", async (from, to) => {
    seed(from, from === "ready" || from === "collected" ? new Date(DONE_AT) : null);
    const res = await transitionOrder("ord-1", to);
    expect(res).toEqual({ ok: false, code: "STALE_STATE", message: "This order just changed — reloading" });
    expect(sets).toEqual([]);
    expect(mockDeduct).not.toHaveBeenCalled();
    expect(mockWriteAudit).toHaveBeenCalledTimes(1);
    expect(mockWriteAudit.mock.calls[0][0]).toMatchObject({
      entityKind: "order", entityId: "ord-1", action: "reject", reason: "STALE_STATE",
      actorId: "staff_louis", actorRole: "barista",
      after: { attempted: "transition", code: "STALE_STATE", state: from, toState: to },
    });
    expect(mockWriteAudit.mock.calls[0][1]).toBe(client);
    expect(committed).toBe(true);
  });

  it("a duplicate Done does not move completed_at or write a transition audit", async () => {
    seed("ready", new Date(DONE_AT));
    await transitionOrder("ord-1", "ready");
    expect(sets).toEqual([]);
    expect(mockWriteAudit.mock.calls.map((c) => (c[0] as Row).action)).toEqual(["reject"]);
  });
});
