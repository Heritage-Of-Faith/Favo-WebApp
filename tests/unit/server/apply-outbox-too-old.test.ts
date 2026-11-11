// REQ-039 / T5 step 5: "Given an outbox order more than 12 hours old · When it
// replays · Then it is rejected, surfaced on the admin exception list, and
// never silently accepted; and a replay takes the server's receipt time as its
// revenue day, never the client's". §6.0.5 REPLAY_TOO_OLD.
//
// Literal values: 12 hours exactly is applied ("more than"); 12 h + 1 s is
// rejected. A R20.00 cappuccino, Sunday 11 Oct 2026.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { outboxLog, orders, orderItems, menuItems, openingSessions, eventWindows, appConfig, recipeIngredients, stockMovements } from "@db/schema";

vi.mock("@/server/audit", () => ({ writeAudit: vi.fn(async () => {}) }));

type Row = Record<string, unknown>;
let rows = new Map<unknown, Row[]>();
const inserts: { table: unknown; values: unknown }[] = [];
const updates: unknown[] = [];

function selectChain() {
  let table: unknown;
  const c: Record<string, unknown> = {};
  for (const m of ["where", "limit", "orderBy", "innerJoin", "leftJoin"]) c[m] = () => c;
  c.from = (t: unknown) => { table = t; return c; };
  c.then = (resolve: (v: Row[]) => void, reject: (e: unknown) => void) =>
    Promise.resolve(rows.get(table) ?? []).then(resolve, reject);
  return c;
}

vi.mock("@/lib/db", () => {
  const db: Record<string, unknown> = {
    select: () => selectChain(),
    selectDistinct: () => selectChain(),
    insert: (table: unknown) => ({
      values: (values: unknown) => {
        inserts.push({ table, values });
        return Object.assign(Promise.resolve(), { returning: async () => [{ id: "log-1" }] });
      },
    }),
    update: (table: unknown) => ({ set: () => ({ where: async () => { updates.push(table); } }) }),
  };
  db.transaction = async (fn: (tx: unknown) => Promise<unknown>) => fn(db);
  return { db };
});

import { applyOutboxItem, isReplayTooOld, REPLAY_TOO_OLD_ACTION } from "@/server/sync/apply-outbox";
import { writeAudit } from "@/server/audit";

const CAPP = { id: "mi-capp", name: "Cappuccino", currentPriceZar: 2000, active: true, recipeId: "rec_capp" };
const RECEIPT = new Date("2026-10-11T21:00:00+02:00"); // Sunday 21:00 SAST
const UUID = "33333333-3333-3333-3333-333333333333";

function entryAt(clientTimestamp: Date) {
  return {
    clientUuid: UUID,
    staffId: "staff-1",
    customerId: "cust-1",
    items: [{ menuItemId: CAPP.id, quantity: 1, modifications: [] as string[] }],
    paymentMode: "yoco_deferred" as const,
    clientTotalZar: 2000,
    clientTimestamp: clientTimestamp.toISOString(),
  };
}

const ago = (ms: number) => new Date(RECEIPT.getTime() - ms);
const H12 = 12 * 60 * 60 * 1000;
const insertsInto = (t: unknown) => inserts.filter((i) => i.table === t).map((i) => i.values);
const auditCalls = () => vi.mocked(writeAudit).mock.calls.map((c) => c[0] as Row);

beforeEach(() => {
  inserts.length = 0;
  updates.length = 0;
  vi.mocked(writeAudit).mockClear();
  rows = new Map<unknown, Row[]>([
    [outboxLog, []],
    [menuItems, [CAPP]],
    [recipeIngredients, [{ recipeId: "rec_capp" }]],
    [openingSessions, [{ mode: "sunday" }]],
    [eventWindows, []],
    [appConfig, []],
  ]);
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(RECEIPT);
});
afterEach(() => vi.useRealTimers());

describe("REQ-039 — an outbox order more than 12 hours old is rejected", () => {
  it("exactly 12 hours old is not 'more than' 12 hours → applied, revenue day and placed_at are the receipt", async () => {
    const res = await applyOutboxItem(entryAt(ago(H12)));
    expect(res).toMatchObject({ outcome: "applied", serverTotalZar: 2000 });
    expect(insertsInto(orders)[0]).toMatchObject({ revenueDay: "2026-10-11", placedAt: RECEIPT });
  });

  it("12 hours + 1 second old → rejected REPLAY_TOO_OLD; no order, no order_items, no stock movement", async () => {
    const res = await applyOutboxItem(entryAt(ago(H12 + 1000)));
    expect(res).toEqual({ outcome: "rejected", reason: "replay_too_old" });
    expect(insertsInto(orders)).toEqual([]);
    expect(insertsInto(orderItems)).toEqual([]);
    expect(insertsInto(stockMovements)).toEqual([]);
    expect(updates).toEqual([]); // outbox_log.applied_at stays null
  });

  it("the receipt is still recorded in outbox_log (the uuid is consumed), with the server's receipt time", async () => {
    await applyOutboxItem(entryAt(ago(H12 + 1000)));
    expect(insertsInto(outboxLog)).toHaveLength(1);
    expect(insertsInto(outboxLog)[0]).toMatchObject({ clientUuid: UUID, staffId: "staff-1", receivedAt: RECEIPT });
  });

  it("writes one audit row naming the client uuid, the age and the barista — and no customer id", async () => {
    const clientAt = ago(H12 + 1000);
    await applyOutboxItem(entryAt(clientAt));
    const rejected = auditCalls().filter((a) => a.action === REPLAY_TOO_OLD_ACTION);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]).toMatchObject({
      action: "order.sync_rejected_too_old",
      actorId: "staff-1",
      reason: "REPLAY_TOO_OLD",
      entityKind: "outbox_log",
      after: {
        clientUuid: UUID,
        staffId: "staff-1",
        clientTimestamp: clientAt.toISOString(),
        receivedAt: RECEIPT.toISOString(),
        ageMs: H12 + 1000,
        clientTotalZar: 2000,
      },
    });
    expect(JSON.stringify(rejected[0])).not.toContain("cust-1");
    expect(auditCalls().some((a) => a.action === "order.sync_applied")).toBe(false);
  });

  it("re-replaying a rejected uuid stays rejected: no second outbox row, no second audit row, no order", async () => {
    const clientAt = ago(H12 + 1000);
    rows.set(outboxLog, [{
      id: "log-1", clientUuid: UUID, appliedAt: null, receivedAt: RECEIPT,
      payload: entryAt(clientAt),
    }]);
    vi.setSystemTime(new Date(RECEIPT.getTime() + 60_000));
    const res = await applyOutboxItem(entryAt(clientAt));
    expect(res).toEqual({ outcome: "rejected", reason: "replay_too_old" });
    expect(inserts).toEqual([]);
    expect(writeAudit).not.toHaveBeenCalled();
  });

  it("a uuid already applied stays a duplicate (REQ-038 unchanged)", async () => {
    rows.set(outboxLog, [{
      id: "log-1", clientUuid: UUID, appliedAt: RECEIPT, receivedAt: RECEIPT, payload: entryAt(ago(60_000)),
    }]);
    const res = await applyOutboxItem(entryAt(ago(60_000)));
    expect(res).toMatchObject({ outcome: "duplicate" });
    expect(inserts).toEqual([]);
  });

  it("isReplayTooOld: 12 h → false, 12 h + 1 s → true, a client time in the future → false", () => {
    expect(isReplayTooOld(ago(H12).toISOString(), RECEIPT)).toBe(false);
    expect(isReplayTooOld(ago(H12 + 1000).toISOString(), RECEIPT)).toBe(true);
    expect(isReplayTooOld(new Date(RECEIPT.getTime() + 60_000).toISOString(), RECEIPT)).toBe(false);
  });
});
