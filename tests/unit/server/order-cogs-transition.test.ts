// AT-188 · REQ-106 — transitionOrder writes order_cogs in the SAME transaction
// as the stock deduction, only after it succeeds, and only at ordered →
// in_progress. If deduction throws, the write never runs (and the rollback of
// that one transaction leaves neither stock_movements nor order_cogs).

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/server/auth/guard", () => ({
  authorize: vi.fn().mockResolvedValue({ ok: true, session: { id: "staff1", role: "barista" } }),
}));
vi.mock("@/server/audit", () => ({ writeAudit: vi.fn().mockResolvedValue(undefined) }));

const { FakeDeductionError, deductForOrder, writeOrderCogs } = vi.hoisted(() => {
  class FakeDeductionError extends Error {
    constructor(public code: string, message: string) {
      super(message);
    }
  }
  return { FakeDeductionError, deductForOrder: vi.fn(), writeOrderCogs: vi.fn() };
});
const CONSUMED = [{ inventoryItemId: "inv_item_beans_cups", costUnits: 1, draws: [{ lotId: "lot_b", units: 1 }] }];
vi.mock("@/server/orders/deduction", () => ({
  deductForOrder: (...a: unknown[]) => deductForOrder(...a),
  DeductionError: FakeDeductionError,
}));
vi.mock("@/server/orders/order-cogs", () => ({ writeOrderCogs: (...a: unknown[]) => writeOrderCogs(...a) }));
vi.mock("@/server/queue/notify", () => ({ notifyOrderChange: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/server/push/send", () => ({ sendOrderReadyPush: vi.fn().mockResolvedValue(true) }));
vi.mock("@/server/push/payload", () => ({ isValidPushSubscription: vi.fn(() => false) }));

const state = { order: null as Record<string, unknown> | null, txs: [] as unknown[] };

vi.mock("@/lib/db", () => {
  function makeTx() {
    return {
      select: () => ({
        from: () => ({
          where: () => ({ for: () => Promise.resolve(state.order ? [state.order] : []) }),
        }),
      }),
      update: () => ({ set: () => ({ where: () => Promise.resolve() }) }),
      insert: () => ({ values: () => Promise.resolve() }),
    };
  }
  const rows = () => Promise.resolve(state.order ? [state.order] : []);
  return {
    db: {
      select: vi.fn().mockImplementation(() => ({
        from: () => ({
          // orderBy: loadOrder reads every payment attempt ORDER BY attempt (AT-201 part 2b).
          where: () => Object.assign(rows(), { limit: () => Promise.resolve([]), orderBy: () => Promise.resolve([]) }),
          leftJoin: () => ({ where: () => Promise.resolve([]) }),
          limit: () => Promise.resolve([]),
        }),
      })),
      transaction: async (cb: (tx: unknown) => Promise<void>) => {
        const tx = makeTx();
        state.txs.push(tx);
        return cb(tx);
      },
    },
  };
});

import { transitionOrder } from "@/server/actions/orders";

function setOrder(overrides: Record<string, unknown> = {}) {
  state.order = {
    id: "ord-1",
    state: "ordered",
    totalZar: 0, // no payment gate in play
    customerId: null,
    staffId: "staff1",
    isStaffDiscount: false,
    completedAt: null,
    placedAt: { toISOString: () => "2026-08-16T06:05:51.000Z" },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  state.order = null;
  state.txs = [];
});

describe("transitionOrder → order_cogs (AT-188)", () => {
  it("ordered → in_progress: writes order_cogs with what deduction returned, on the same tx, after it", async () => {
    setOrder();
    deductForOrder.mockResolvedValueOnce(CONSUMED);
    writeOrderCogs.mockResolvedValueOnce(undefined);

    await transitionOrder("ord-1", "in_progress");

    expect(state.txs).toHaveLength(1);
    expect(deductForOrder).toHaveBeenCalledTimes(1);
    expect(writeOrderCogs).toHaveBeenCalledTimes(1);
    expect(writeOrderCogs).toHaveBeenCalledWith("ord-1", CONSUMED, state.txs[0]);
    expect(deductForOrder.mock.calls[0][1]).toBe(state.txs[0]); // one transaction for both
    expect(deductForOrder.mock.invocationCallOrder[0]).toBeLessThan(writeOrderCogs.mock.invocationCallOrder[0]);
  });

  it("deduction throws → order_cogs is never written, and the error is returned", async () => {
    setOrder();
    deductForOrder.mockRejectedValueOnce(new FakeDeductionError("OUT_OF_STOCK", "No beans left"));

    const res = await transitionOrder("ord-1", "in_progress");

    expect(res).toEqual({ ok: false, code: "OUT_OF_STOCK", message: "No beans left" });
    expect(writeOrderCogs).not.toHaveBeenCalled();
  });

  it("a failing order_cogs write fails the whole transition (no deduction without its COGS)", async () => {
    setOrder();
    deductForOrder.mockResolvedValueOnce(CONSUMED);
    writeOrderCogs.mockRejectedValueOnce(new Error("db down"));

    await expect(transitionOrder("ord-1", "in_progress")).rejects.toThrow("db down");
  });

  it("other transitions (in_progress → ready) neither deduct nor write order_cogs", async () => {
    setOrder({ state: "in_progress" });
    await transitionOrder("ord-1", "ready");
    expect(deductForOrder).not.toHaveBeenCalled();
    expect(writeOrderCogs).not.toHaveBeenCalled();
  });

  it("a retried ordered → in_progress on an order already in_progress is refused: no second deduction or row", async () => {
    setOrder({ state: "in_progress" });
    const res = await transitionOrder("ord-1", "in_progress");
    expect(res).toEqual(expect.objectContaining({ ok: false, code: "INVALID_TRANSITION" }));
    expect(deductForOrder).not.toHaveBeenCalled();
    expect(writeOrderCogs).not.toHaveBeenCalled();
  });
});
