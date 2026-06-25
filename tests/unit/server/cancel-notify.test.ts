// cancelOrder SSE notify test
// Verifies that cancelOrder fires notifyOrderChange with state:"cancelled"
// so the POS live queue removes the card immediately.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@db/index", () => {
  function chain() {
    const c: Record<string, unknown> = {
      from: vi.fn(),
      where: vi.fn(),
      for: vi.fn(),
      orderBy: vi.fn(),
      limit: vi.fn(),
    };
    for (const k of ["from", "where", "for", "orderBy", "limit"]) {
      (c[k] as ReturnType<typeof vi.fn>).mockReturnValue(c);
    }
    (c as { then?: unknown }).then = (resolve: (v: unknown[]) => void) => resolve([]);
    return c;
  }

  const txMock = {
    select: vi.fn().mockImplementation(chain),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }),
    }),
    execute: vi.fn().mockResolvedValue(undefined),
  };

  return {
    db: {
      select: vi.fn().mockImplementation(chain),
      transaction: vi.fn().mockImplementation(
        async (cb: (tx: typeof txMock) => Promise<unknown>) => cb(txMock)
      ),
    },
    __txMock: txMock,
  };
});

vi.mock("@/server/auth/guard", () => ({
  authorize: vi.fn().mockResolvedValue({
    ok: true,
    session: { id: "staff_1", name: "Sam", role: "barista" },
  }),
}));

vi.mock("@/server/audit", () => ({
  writeAudit: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/server/queue/notify", () => ({
  notifyOrderChange: vi.fn().mockResolvedValue(undefined),
}));

const ORDER_ID = "order_cancel_1";

describe("cancelOrder — SSE notify", () => {
  beforeEach(() => vi.clearAllMocks());

  it("fires notifyOrderChange with state:cancelled after a successful cancel", async () => {
    const { db, __txMock } = (await import("@db/index")) as unknown as {
      db: { select: ReturnType<typeof vi.fn> };
      __txMock: { select: ReturnType<typeof vi.fn> };
    };

    // Outer existence check returns the order
    let outerCall = 0;
    db.select.mockImplementation(() => ({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockImplementation(() => {
          const row = outerCall++ === 0 ? [{ id: ORDER_ID }] : [];
          return {
            then: (resolve: (v: unknown[]) => void) => resolve(row),
            [Symbol.toStringTag]: "Promise",
          };
        }),
      }),
    }));

    // Inner tx: SELECT FOR UPDATE → ordered state; SELECT redemptions → none
    let txCall = 0;
    __txMock.select.mockImplementation(() => ({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockImplementation(() => {
          const rows =
            txCall++ === 0
              ? [{ id: ORDER_ID, state: "ordered" }]
              : [];
          return {
            for: vi.fn().mockImplementation(() => ({
              then: (resolve: (v: unknown[]) => void) => resolve(rows),
              [Symbol.toStringTag]: "Promise",
            })),
            then: (resolve: (v: unknown[]) => void) => resolve(rows),
            [Symbol.toStringTag]: "Promise",
          };
        }),
      }),
    }));

    const { cancelOrder } = await import("@/server/actions/orders");
    const res = await cancelOrder(ORDER_ID, "test reason");

    expect(res.ok).toBe(true);

    const { notifyOrderChange } = await import("@/server/queue/notify");
    expect(vi.mocked(notifyOrderChange)).toHaveBeenCalledWith(
      expect.objectContaining({ type: "state_change", state: "cancelled", orderId: ORDER_ID })
    );
  });
});
