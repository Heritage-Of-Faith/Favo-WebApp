// AT-201 part 2b / REQ-028 (P4): cancelOrder is refused with
// TENDER_IN_PROGRESS while a tender attempt is open — `pending`, or sent and
// `unresolved` — and the refusal's audit row COMMITS (CLAUDE.md §5: a rejected
// action is audited; it is returned, never thrown inside the transaction).

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

const SENT = new Date("2026-10-25T07:00:00Z");

function given(payment: Row | null) {
  rows = new Map<unknown, Row[]>([
    [orders, [{ id: "ord-1", state: "ordered", totalZar: 3000 }]],
    [payments, payment ? [payment] : []],
  ]);
}

beforeEach(() => {
  vi.clearAllMocks();
  updates.length = 0;
  committed = false;
});

describe("cancelOrder while a tender attempt is open (REQ-028)", () => {
  for (const [label, payment] of [
    ["begun, not yet sent", { attempt: 1, status: "pending", sentAt: null, yocoPaymentId: null }],
    ["sent and pending", { attempt: 1, status: "pending", sentAt: SENT, yocoPaymentId: "yp_1" }],
    ["sent and unresolved", { attempt: 1, status: "unresolved", sentAt: SENT, yocoPaymentId: null }],
  ] as const) {
    it(`${label} → TENDER_IN_PROGRESS, order untouched, refusal audited and committed`, async () => {
      given({ ...payment });
      const res = await cancelOrder("ord-1", "Cancelled at POS");
      expect(res).toEqual({
        ok: false,
        code: "TENDER_IN_PROGRESS",
        message: "This order is at the card machine — finish or cancel the payment first",
      });
      expect(updates).toEqual([]);
      expect(mockWriteAudit).toHaveBeenCalledTimes(1);
      expect(mockWriteAudit.mock.calls[0][0]).toMatchObject({
        entityKind: "order", entityId: "ord-1", action: "reject", reason: "TENDER_IN_PROGRESS",
        actorId: "staff_louis",
      });
      expect(committed).toBe(true);
    });
  }

  for (const [label, payment] of [
    ["no attempt", null],
    ["a declined attempt", { attempt: 1, status: "declined", sentAt: SENT, yocoPaymentId: "yp_1" }],
    ["a never-sent closed-out attempt", { attempt: 1, status: "unresolved", sentAt: null, yocoPaymentId: null }],
  ] as const) {
    it(`${label} → cancel proceeds`, async () => {
      given(payment ? { ...payment } : null);
      const res = await cancelOrder("ord-1", "Cancelled at POS");
      expect(res).toEqual({ ok: true, data: undefined });
      expect(updates).toEqual([{ table: orders, set: { state: "cancelled" } }]);
    });
  }
});
