// AT-207: cancelOrder refuses an order the close has written off (PRD §10.3.3,
// §6.0.5 — the write-off is the order's outcome; cancelling it afterwards
// would erase a loss from the write-off line). The refusal is returned, never
// thrown, so its audit row commits (CLAUDE.md §5).

import { describe, it, expect, vi, beforeEach } from "vitest";
import { orders, payments } from "@db/schema";

vi.mock("@/server/auth/guard", () => ({
  authorize: vi.fn(async () => ({ ok: true, session: { id: "staff_louis", role: "barista" } })),
}));
const mockWriteAudit = vi.fn(async (..._a: unknown[]) => {});
vi.mock("@/server/audit", () => ({ writeAudit: (...a: unknown[]) => mockWriteAudit(...a) }));
vi.mock("@/server/queue/notify", () => ({ notifyOrderChange: vi.fn(async () => {}) }));
vi.mock("@/server/tender/service", () => ({ startTender: vi.fn() }));

type Row = Record<string, unknown>;
let rows = new Map<unknown, Row[]>();
const updates: { table: unknown; set: Row }[] = [];
let committed = false;

function selectChain() {
  let table: unknown;
  const c: Record<string, unknown> = {};
  for (const m of ["where", "orderBy", "limit", "for"]) c[m] = () => c;
  c.from = (t: unknown) => { table = t; return c; };
  c.then = (resolve: (v: Row[]) => void, reject: (e: unknown) => void) =>
    Promise.resolve(rows.get(table) ?? []).then(resolve, reject);
  return c;
}
const client = {
  select: () => selectChain(),
  update: (table: unknown) => ({ set: (set: Row) => ({ where: async () => { updates.push({ table, set }); } }) }),
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

import { cancelOrder } from "@/server/actions/orders";

beforeEach(() => {
  vi.clearAllMocks();
  updates.length = 0;
  committed = false;
});

describe("cancelOrder on a written-off order (AT-207)", () => {
  it("→ ORDER_WRITTEN_OFF, order untouched, refusal audited and committed", async () => {
    rows = new Map<unknown, Row[]>([
      [orders, [{ id: "ord-1", state: "ordered", totalZar: 3000, writtenOffAt: new Date("2026-10-25T22:05:00Z") }]],
      [payments, []],
    ]);
    const res = await cancelOrder("ord-1", "Cancelled at POS");
    expect(res).toMatchObject({ ok: false, code: "ORDER_WRITTEN_OFF" });
    expect(updates).toEqual([]);
    expect(mockWriteAudit).toHaveBeenCalledTimes(1);
    expect(mockWriteAudit.mock.calls[0][0]).toMatchObject({
      entityKind: "order", entityId: "ord-1", action: "reject", reason: "ORDER_WRITTEN_OFF", actorId: "staff_louis",
    });
    expect(committed).toBe(true);
  });

  it("an order not written off is cancelled as before", async () => {
    rows = new Map<unknown, Row[]>([
      [orders, [{ id: "ord-1", state: "ordered", totalZar: 3000, writtenOffAt: null }]],
      [payments, []],
    ]);
    expect(await cancelOrder("ord-1", "Cancelled at POS")).toEqual({ ok: true, data: undefined });
    expect(updates).toEqual([{ table: orders, set: { state: "cancelled" } }]);
  });
});
