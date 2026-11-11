// AT-207: once the close has written an order off (PRD §10.3.3, §6.0.5), that
// is its outcome, and the day's daily_closes figure was taken from its total.
// transitionOrder, compOrderLine and abandonOrder refuse it with
// ORDER_WRITTEN_OFF, write nothing but the refusal's audit row, and that row
// commits (returned, never thrown — CLAUDE.md §5).

import { describe, it, expect, vi, beforeEach } from "vitest";
import { orderItems, orders, payments } from "@db/schema";

vi.mock("@/server/auth/guard", () => ({
  authorize: vi.fn(async () => ({ ok: true, session: { id: "staff_louis", role: "barista", name: "Louis" } })),
}));
const mockWriteAudit = vi.fn(async (..._a: unknown[]) => {});
vi.mock("@/server/audit", () => ({ writeAudit: (...a: unknown[]) => mockWriteAudit(...a) }));
vi.mock("@/server/queue/notify", () => ({ notifyOrderChange: vi.fn(async () => {}) }));
vi.mock("@/server/tender/service", () => ({ startTender: vi.fn() }));
vi.mock("@/server/push/admin-alert", () => ({ alertAdmins: vi.fn(async () => {}) }));
const mockVerifyAdminPin = vi.fn();
vi.mock("@/server/auth/admin-pin", () => ({ verifyAdminPin: (...a: unknown[]) => mockVerifyAdminPin(...a) }));

type Row = Record<string, unknown>;
let rows = new Map<unknown, Row[]>();
const writes: { op: string; table: unknown }[] = [];
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
  update: (table: unknown) => ({ set: () => ({ where: async () => { writes.push({ op: "update", table }); } }) }),
  insert: (table: unknown) => {
    writes.push({ op: "insert", table });
    return { values: () => ({ returning: async () => [{ id: "x" }] }) };
  },
  execute: async () => { writes.push({ op: "execute", table: null }); return []; },
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
import { abandonOrder, compOrderLine } from "@/server/actions/write-downs";

const WRITTEN_OFF_AT = new Date("2026-10-25T22:05:00Z");

beforeEach(() => {
  vi.clearAllMocks();
  writes.length = 0;
  committed = false;
});

function seed(state: string, writtenOffAt: Date | null) {
  rows = new Map<unknown, Row[]>([
    [orders, [{ id: "ord-1", state, totalZar: 3000, paymentMode: null, writtenOffAt, completedAt: null }]],
    [orderItems, [{ id: "oi-1", orderId: "ord-1", quantity: 1, unitPriceZar: 3000, modsZar: 0, discountZar: 0, compReason: null }]],
    [payments, []],
  ]);
}

function expectAuditedRefusal(attempted: string, entityKind: string, entityId: string) {
  expect(writes).toEqual([]);
  expect(mockWriteAudit).toHaveBeenCalledTimes(1);
  expect(mockWriteAudit.mock.calls[0][0]).toMatchObject({
    entityKind, entityId, action: "reject", reason: "ORDER_WRITTEN_OFF", actorId: "staff_louis",
    after: { attempted, code: "ORDER_WRITTEN_OFF" },
  });
  // Written inside the transaction, which then commits.
  expect(mockWriteAudit.mock.calls[0][1]).toBe(client);
  expect(committed).toBe(true);
}

describe("transitionOrder on a written-off order (AT-207)", () => {
  it.each([
    ["ordered", "in_progress"],
    ["in_progress", "ready"],
    ["ready", "collected"],
  ] as const)("%s → %s: ORDER_WRITTEN_OFF, nothing written, the refusal audited and committed", async (from, to) => {
    seed(from, WRITTEN_OFF_AT);
    const res = await transitionOrder("ord-1", to);
    expect(res).toMatchObject({ ok: false, code: "ORDER_WRITTEN_OFF" });
    expectAuditedRefusal("transition", "order", "ord-1");
  });
});

describe("compOrderLine on a written-off order (AT-207)", () => {
  it("→ ORDER_WRITTEN_OFF: no line, order or comp row written; the refusal audited and committed", async () => {
    seed("ordered", WRITTEN_OFF_AT);
    const res = await compOrderLine("oi-1", "spillage");
    expect(res).toMatchObject({ ok: false, code: "ORDER_WRITTEN_OFF" });
    expectAuditedRefusal("comp", "order_item", "oi-1");
    expect(mockVerifyAdminPin).not.toHaveBeenCalled();
  });
});

describe("abandonOrder on a written-off order (AT-207)", () => {
  it("→ ORDER_WRITTEN_OFF: no waste_log row, order not cancelled; the refusal audited and committed", async () => {
    seed("in_progress", WRITTEN_OFF_AT);
    const res = await abandonOrder("ord-1", "Customer left");
    expect(res).toMatchObject({ ok: false, code: "ORDER_WRITTEN_OFF" });
    expectAuditedRefusal("abandon", "order", "ord-1");
  });

  it("an order that is not written off is abandoned as before", async () => {
    seed("in_progress", null);
    expect(await abandonOrder("ord-1", "Customer left")).toMatchObject({ ok: true });
    expect(writes.map((w) => w.op)).toEqual(["insert", "update"]);
  });
});
