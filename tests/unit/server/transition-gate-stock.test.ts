// transitionOrder('in_progress'):
//  - PAYMENT_REQUIRED is returned, not thrown, so its reject audit row commits
//    (CLAUDE.md §5) and nothing else is written;
//  - DEC-21 / DEC-26 (owner, Mia, 9 Nov 2026): a Sunday order with no FAVO
//    payment starts, with one `sunday_started_without_favo_payment` audit row
//    and no money change; a Saturday event order does not, unless it is
//    deferred (T3 step 2); YOCO_SECRET_KEY unset never opens the gate;
//  - REQ-022 / S8b: a failed deduction returns STOCK_EXHAUSTED_AT_MAKE with the
//    S1 copy and the resolution path, writes a reject audit row and pushes the
//    Admin immediately (once per order per window; an audit failure never
//    stops the push).

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { orders, payments } from "@db/schema";

vi.mock("@/server/auth/guard", () => ({
  authorize: vi.fn(async () => ({ ok: true, session: { id: "staff_louis", role: "barista", name: "Louis" } })),
}));
const mockWriteAudit = vi.fn(async (..._a: unknown[]) => {});
vi.mock("@/server/audit", () => ({ writeAudit: (...a: unknown[]) => mockWriteAudit(...a) }));
vi.mock("@/server/queue/notify", () => ({ notifyOrderChange: vi.fn(async () => {}) }));
vi.mock("@/server/push/send", () => ({ sendOrderReadyPush: vi.fn(async () => true) }));
const mockAlertAdmins = vi.fn(async (..._a: unknown[]) => {});
vi.mock("@/server/push/admin-alert", () => ({ alertAdmins: (...a: unknown[]) => mockAlertAdmins(...a) }));
const { FakeDeductionError, mockDeduct } = vi.hoisted(() => {
  class FakeDeductionError extends Error {
    constructor(public code: string, message: string) { super(message); }
  }
  return { FakeDeductionError, mockDeduct: vi.fn(async (): Promise<unknown[]> => []) };
});
vi.mock("@/server/orders/deduction", () => ({
  deductForOrder: () => mockDeduct(),
  DeductionError: FakeDeductionError,
}));
const mockWriteCogs = vi.fn(async () => {});
vi.mock("@/server/orders/order-cogs", () => ({ writeOrderCogs: () => mockWriteCogs() }));

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
import { setSundaySkipForTests } from "@/server/close/write-offs";
import { resetStockAtMakePushesForTests } from "@/server/orders/stock-exhausted";

const SUNDAY = "2026-11-08";
const SATURDAY = "2026-11-07";

function seed(order: Row, attempts: Row[] = []) {
  rows = new Map<unknown, Row[]>([
    [orders, [{
      id: "ord-1", state: "ordered", totalZar: 3800, paymentMode: "yoco", writtenOffAt: null, completedAt: null,
      customerId: null, notificationTarget: "none", staffId: "staff_louis", revenueDay: SUNDAY,
      placedAt: new Date("2026-11-08T07:30:00.000Z"), ...order,
    }]],
    [payments, attempts],
  ]);
}
const auditActions = () => mockWriteAudit.mock.calls.map((c) => (c[0] as Row).action);
const orderSets = () => sets.filter((s) => s.table === orders).map((s) => s.values);

beforeEach(() => {
  vi.clearAllMocks();
  sets.length = 0;
  committed = false;
  resetStockAtMakePushesForTests();
  setSundaySkipForTests(true);
  vi.stubEnv("YOCO_SECRET_KEY", "");
});
afterEach(() => {
  setSundaySkipForTests(true);
  vi.unstubAllEnvs();
});

describe("PAYMENT_REQUIRED is audited (CLAUDE.md §5)", () => {
  it("Saturday event R38.00, no payment, no Yoco key: PAYMENT_REQUIRED, one committed reject row, nothing else written", async () => {
    seed({ revenueDay: SATURDAY, placedAt: new Date("2026-11-07T10:00:00.000Z") });
    const res = await transitionOrder("ord-1", "in_progress");
    expect(res).toEqual({ ok: false, code: "PAYMENT_REQUIRED", message: "Order cannot start — card payment not yet confirmed." });
    expect(sets).toEqual([]);
    expect(mockDeduct).not.toHaveBeenCalled();
    expect(mockWriteAudit).toHaveBeenCalledTimes(1);
    expect(mockWriteAudit.mock.calls[0][0]).toMatchObject({
      entityKind: "order", entityId: "ord-1", action: "reject", reason: "PAYMENT_REQUIRED",
      actorId: "staff_louis", actorRole: "barista",
      after: { attempted: "transition", code: "PAYMENT_REQUIRED", state: "ordered", toState: "in_progress" },
    });
    expect(mockWriteAudit.mock.calls[0][1]).toBe(client);
    expect(committed).toBe(true);
  });

  it("DEC-21 switched off: a Sunday order with no payment is refused and audited", async () => {
    setSundaySkipForTests(false);
    seed({});
    const res = await transitionOrder("ord-1", "in_progress");
    expect(res).toMatchObject({ ok: false, code: "PAYMENT_REQUIRED" });
    expect(auditActions()).toEqual(["reject"]);
  });

  it("a Sunday order whose latest attempt was SENT and declined is refused (S3), even with DEC-21 on", async () => {
    seed({}, [{ status: "declined", sentAt: new Date("2026-11-08T07:31:00.000Z") }]);
    const res = await transitionOrder("ord-1", "in_progress");
    expect(res).toMatchObject({ ok: false, code: "PAYMENT_REQUIRED" });
    expect(auditActions()).toEqual(["reject"]);
  });
});

describe("DEC-21: a Sunday order's card is on the Yoco machine", () => {
  it("Sunday R38.00, no FAVO payment: starts, writes one sunday_started_without_favo_payment row, total unchanged", async () => {
    seed({});
    const res = await transitionOrder("ord-1", "in_progress");
    expect(res.ok).toBe(true);
    expect(orderSets()).toEqual([{ state: "in_progress", completedAt: null }]);
    expect(mockDeduct).toHaveBeenCalledTimes(1);
    expect(auditActions()).toEqual(["sunday_started_without_favo_payment", "transition"]);
    expect(mockWriteAudit.mock.calls[0][0]).toMatchObject({
      entityKind: "order", entityId: "ord-1", action: "sunday_started_without_favo_payment",
      actorId: "staff_louis", actorRole: "barista",
      after: { revenueDay: SUNDAY, totalZar: 3800, rule: "DEC-21" },
    });
  });

  it("a Sunday order with a successful payment starts with no sunday_started_without_favo_payment row", async () => {
    seed({}, [{ status: "successful", sentAt: new Date("2026-11-08T07:31:00.000Z") }]);
    const res = await transitionOrder("ord-1", "in_progress");
    expect(res.ok).toBe(true);
    expect(auditActions()).toEqual(["transition"]);
  });

  it("T3 step 2: a Saturday event R38.00 deferred order (yoco_deferred) starts normally, no special audit row", async () => {
    seed({ paymentMode: "yoco_deferred", revenueDay: SATURDAY, placedAt: new Date("2026-11-07T10:00:00.000Z") });
    const res = await transitionOrder("ord-1", "in_progress");
    expect(res.ok).toBe(true);
    expect(mockDeduct).toHaveBeenCalledTimes(1);
    expect(auditActions()).toEqual(["transition"]);
  });

  it("the same Saturday R38.00 order NOT deferred is refused with PAYMENT_REQUIRED", async () => {
    seed({ paymentMode: "yoco", revenueDay: SATURDAY, placedAt: new Date("2026-11-07T10:00:00.000Z") });
    const res = await transitionOrder("ord-1", "in_progress");
    expect(res).toMatchObject({ ok: false, code: "PAYMENT_REQUIRED" });
    expect(auditActions()).toEqual(["reject"]);
  });

  it("a weekday free R0.00 order starts with no payment and no sunday_started_without_favo_payment row", async () => {
    seed({ totalZar: 0, paymentMode: "free", revenueDay: "2026-11-09", placedAt: new Date("2026-11-09T06:00:00.000Z") });
    const res = await transitionOrder("ord-1", "in_progress");
    expect(res.ok).toBe(true);
    expect(auditActions()).toEqual(["transition"]);
  });
});

describe("REQ-022 / S8b: STOCK_EXHAUSTED_AT_MAKE", () => {
  it("a paid order whose deduction fails: the S1 code and copy, a reject audit row, the Admin pushed, no COGS", async () => {
    seed({ revenueDay: SATURDAY }, [{ status: "successful", sentAt: new Date("2026-11-07T10:01:00.000Z") }]);
    mockDeduct.mockRejectedValueOnce(new FakeDeductionError("OUT_OF_STOCK", "No sealed container left to open for inventory item inv_beans"));
    const res = await transitionOrder("ord-1", "in_progress");
    expect(res).toEqual({
      ok: false,
      code: "STOCK_EXHAUSTED_AT_MAKE",
      message: "Out of beans — this order is paid and cannot be made. Get an admin. An admin cancels it with the admin PIN and comps a later order (no money is returned), or opens a container.",
    });
    expect(mockWriteCogs).not.toHaveBeenCalled();
    const reject = mockWriteAudit.mock.calls.find((c) => (c[0] as Row).action === "reject");
    expect(reject?.[0]).toMatchObject({
      entityKind: "order", entityId: "ord-1", reason: "STOCK_EXHAUSTED_AT_MAKE",
      actorId: "staff_louis", actorRole: "barista",
      after: { attempted: "transition", toState: "in_progress", code: "STOCK_EXHAUSTED_AT_MAKE", deductionCode: "OUT_OF_STOCK" },
    });
    // Written on its own (no tx argument), so it survives the rollback.
    expect(reject?.[1]).toBeUndefined();
    expect(mockAlertAdmins).toHaveBeenCalledTimes(1);
    const [title, body, data] = mockAlertAdmins.mock.calls[0] as [string, string, Row];
    expect(title).toBe("Out of stock at make — order ord-1");
    expect(body).toBe("Out of beans — this order is paid and cannot be made. Get an admin. An admin cancels it with the admin PIN and comps a later order (no money is returned), or opens a container.");
    expect(data).toMatchObject({ orderId: "ord-1", code: "STOCK_EXHAUSTED_AT_MAKE" });
  });

  it("a second tap on the same order within 5 minutes is audited again but pushes once", async () => {
    seed({ revenueDay: SATURDAY }, [{ status: "successful", sentAt: new Date("2026-11-07T10:01:00.000Z") }]);
    mockDeduct.mockRejectedValueOnce(new FakeDeductionError("OUT_OF_STOCK", "x"));
    mockDeduct.mockRejectedValueOnce(new FakeDeductionError("OUT_OF_STOCK", "x"));
    await transitionOrder("ord-1", "in_progress");
    const res = await transitionOrder("ord-1", "in_progress");
    expect(res).toMatchObject({ ok: false, code: "STOCK_EXHAUSTED_AT_MAKE" });
    expect(auditActions()).toEqual(["reject", "reject"]);
    expect(mockAlertAdmins).toHaveBeenCalledTimes(1);
  });

  it("a failing audit insert does not stop the Admin push or the refusal", async () => {
    seed({ revenueDay: SATURDAY }, [{ status: "successful", sentAt: new Date("2026-11-07T10:01:00.000Z") }]);
    mockDeduct.mockRejectedValueOnce(new FakeDeductionError("OUT_OF_STOCK", "x"));
    mockWriteAudit.mockRejectedValueOnce(new Error("audit insert failed"));
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await transitionOrder("ord-1", "in_progress");
    quiet.mockRestore();
    expect(res).toMatchObject({ ok: false, code: "STOCK_EXHAUSTED_AT_MAKE" });
    expect(mockAlertAdmins).toHaveBeenCalledTimes(1);
  });

  it("NO_ACTIVE_LOT is the same failure at make", async () => {
    seed({ totalZar: 0, paymentMode: "free", revenueDay: "2026-11-09" });
    mockDeduct.mockRejectedValueOnce(new FakeDeductionError("NO_ACTIVE_LOT", "No active lot"));
    const res = await transitionOrder("ord-1", "in_progress");
    expect(res).toMatchObject({ ok: false, code: "STOCK_EXHAUSTED_AT_MAKE" });
    expect(mockAlertAdmins).toHaveBeenCalledTimes(1);
  });
});
