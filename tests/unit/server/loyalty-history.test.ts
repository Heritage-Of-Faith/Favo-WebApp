// loyalty-history.test.ts — AT-128 (LOY-8)
// Tests for listCustomerLoyaltyHistory + sendPointsEarnedPush wired into transitionOrder.

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("@/server/auth/customer-session", () => ({
  getCustomerSession: vi.fn().mockResolvedValue("cust_louis"),
}));

vi.mock("@/server/audit", () => ({
  writeAudit: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/server/push/send", () => ({
  sendOrderReadyPush: vi.fn().mockResolvedValue(true),
  sendPointsEarnedPush: vi.fn().mockResolvedValue(true),
}));

vi.mock("@/server/queue/notify", () => ({
  notifyOrderChange: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/server/orders/deduction", () => ({
  deductForOrder: vi.fn().mockResolvedValue(undefined),
  DeductionError: class DeductionError extends Error {
    constructor(
      public readonly code: string,
      message: string
    ) {
      super(message);
    }
  },
}));

vi.mock("@/server/yoco/client", () => ({
  createPaymentIntent: vi.fn().mockResolvedValue({ id: "ck_1", clientSecret: "ck_1" }),
}));

vi.mock("@/server/auth/guard", () => ({
  authorize: vi.fn().mockResolvedValue({
    ok: true,
    session: { id: "staff_sam", name: "Sam", role: "barista" },
  }),
}));

// ─── DB mock ──────────────────────────────────────────────────────────────────

vi.mock("@db/index", () => {
  function chain() {
    const c: Record<string, unknown> = {
      from: vi.fn(),
      where: vi.fn(),
      orderBy: vi.fn(),
      limit: vi.fn(),
      offset: vi.fn(),
      for: vi.fn(),
    };
    for (const k of ["from", "where", "orderBy", "limit", "offset", "for"]) {
      (c[k] as ReturnType<typeof vi.fn>).mockReturnValue(c);
    }
    (c as { then?: unknown }).then = (resolve: (v: unknown[]) => void) => resolve([]);
    return c;
  }

  const txMock = {
    select: vi.fn().mockImplementation(chain),
    insert: vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue([]) }),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }),
    }),
  };

  return {
    db: {
      select: vi.fn().mockImplementation(chain),
      transaction: vi.fn().mockImplementation(async (cb: (tx: typeof txMock) => Promise<void>) => cb(txMock)),
    },
    __txMock: txMock,
  };
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

const CUSTOMER_ID = "cust_louis";
const ORDER_ID = "order_001";

const VALID_PUSH_SUB = {
  endpoint: "https://push.example.com/abc",
  keys: { p256dh: "key-p256dh", auth: "key-auth" },
};

function setupSelectSequence(
  db: { select: ReturnType<typeof vi.fn> },
  rows: unknown[][]
) {
  let call = 0;
  db.select.mockImplementation(() => {
    const rowsForCall = rows[call++] ?? [];
    return {
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          orderBy: vi.fn().mockReturnValue({
            limit: vi.fn().mockReturnValue({
              offset: vi.fn().mockImplementation(() => ({
                then: (resolve: (v: unknown[]) => void) => resolve(rowsForCall),
                [Symbol.toStringTag]: "Promise",
              })),
            }),
          }),
          then: (resolve: (v: unknown[]) => void) => resolve(rowsForCall),
          [Symbol.toStringTag]: "Promise",
        }),
        then: (resolve: (v: unknown[]) => void) => resolve(rowsForCall),
        [Symbol.toStringTag]: "Promise",
      }),
    };
  });
}

// ─── listCustomerLoyaltyHistory ───────────────────────────────────────────────

describe("listCustomerLoyaltyHistory — auth", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns UNAUTHORIZED when session is null", async () => {
    const { getCustomerSession } = await import("@/server/auth/customer-session");
    vi.mocked(getCustomerSession).mockResolvedValueOnce(null);
    const { listCustomerLoyaltyHistory } = await import("@/server/actions/customer");
    const res = await listCustomerLoyaltyHistory(0);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("UNAUTHORIZED");
  });
});

describe("listCustomerLoyaltyHistory — empty history", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns empty rows and zero totals when no transactions exist", async () => {
    const { db } = await import("@db/index");
    // Parallel Promise.all: [customer], txRows, [totalRow]
    // We need 3 select calls: customer, transactions, count
    let call = 0;
    const responses = [
      // customer row
      [{ loyaltyPoints: 0 }],
      // tx rows
      [],
      // count row
      [{ total: 0 }],
    ];
    (db.select as ReturnType<typeof vi.fn>).mockImplementation(() => {
      const rowsForCall = responses[call++] ?? [];
      return {
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockReturnValue({
              limit: vi.fn().mockReturnValue({
                offset: vi.fn().mockImplementation(() => ({
                  then: (resolve: (v: unknown[]) => void) => resolve(rowsForCall),
                  [Symbol.toStringTag]: "Promise",
                })),
              }),
            }),
            then: (resolve: (v: unknown[]) => void) => resolve(rowsForCall),
            [Symbol.toStringTag]: "Promise",
          }),
          then: (resolve: (v: unknown[]) => void) => resolve(rowsForCall),
          [Symbol.toStringTag]: "Promise",
        }),
      };
    });

    const { listCustomerLoyaltyHistory } = await import("@/server/actions/customer");
    const res = await listCustomerLoyaltyHistory(0);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.rows).toHaveLength(0);
      expect(res.data.total).toBe(0);
      expect(res.data.currentBalance).toBe(0);
    }
  });
});

describe("listCustomerLoyaltyHistory — rows sorted newest first with running balances", () => {
  beforeEach(() => vi.clearAllMocks());

  it("computes running balances correctly for 3 transactions", async () => {
    const { db } = await import("@db/index");
    const now = new Date();
    const txRows = [
      { id: "tx3", delta: 5, kind: "earn", reason: null, at: new Date(now.getTime() - 1000) },
      { id: "tx2", delta: -100, kind: "redeem", reason: "Order discount", at: new Date(now.getTime() - 2000) },
      { id: "tx1", delta: 50, kind: "earn", reason: null, at: new Date(now.getTime() - 3000) },
    ];
    // currentBalance = 105 (50 earn + (-100 redeem) + 5 earn = -45... wait)
    // Let's say currentBalance = 55 (latest state after all tx)
    // tx3 (newest): runningBalance = 55 (after earning 5)
    // tx2: runningBalance = 55 - 5 = 50 (before the +5 earn in tx3, i.e. after the -100 redeem)
    // tx1: runningBalance = 50 - (-100) = 150 (after the first +50 earn)
    const currentBalance = 55;

    let call = 0;
    const responses = [
      [{ loyaltyPoints: currentBalance }],
      txRows,
      [{ total: 3 }],
    ];
    (db.select as ReturnType<typeof vi.fn>).mockImplementation(() => {
      const rowsForCall = responses[call++] ?? [];
      return {
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockReturnValue({
              limit: vi.fn().mockReturnValue({
                offset: vi.fn().mockImplementation(() => ({
                  then: (resolve: (v: unknown[]) => void) => resolve(rowsForCall),
                  [Symbol.toStringTag]: "Promise",
                })),
              }),
            }),
            then: (resolve: (v: unknown[]) => void) => resolve(rowsForCall),
            [Symbol.toStringTag]: "Promise",
          }),
          then: (resolve: (v: unknown[]) => void) => resolve(rowsForCall),
          [Symbol.toStringTag]: "Promise",
        }),
      };
    });

    const { listCustomerLoyaltyHistory } = await import("@/server/actions/customer");
    const res = await listCustomerLoyaltyHistory(0);
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    const { rows } = res.data;
    expect(rows).toHaveLength(3);

    // Newest row (tx3): runningBalance = currentBalance (55), delta = +5
    expect(rows[0].id).toBe("tx3");
    expect(rows[0].delta).toBe(5);
    expect(rows[0].runningBalance).toBe(55);

    // tx2: balance before tx3 delta = 55 - 5 = 50
    expect(rows[1].id).toBe("tx2");
    expect(rows[1].delta).toBe(-100);
    expect(rows[1].runningBalance).toBe(50);

    // tx1: balance before tx3 + tx2 deltas = 55 - (5 + (-100)) = 55 + 95 = 150
    expect(rows[2].id).toBe("tx1");
    expect(rows[2].delta).toBe(50);
    expect(rows[2].runningBalance).toBe(150);

    expect(res.data.total).toBe(3);
    expect(res.data.currentBalance).toBe(55);
  });
});

// ─── transitionOrder push tests ───────────────────────────────────────────────

function makeOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: ORDER_ID,
    customerId: CUSTOMER_ID,
    state: "in_progress",
    totalZar: 5000, // R50 → earnPoints(5000) > 0
    isStaffDiscount: false,
    completedAt: null,
    ...overrides,
  };
}

function makeCustomer(overrides: Record<string, unknown> = {}) {
  return {
    name: "Louis",
    pushSubscription: VALID_PUSH_SUB,
    loyaltyPoints: 50,
    ...overrides,
  };
}

/**
 * Sets up the txMock.select to return rows in sequence for each call inside the transaction.
 */
function setupTxSelectSequence(
  txMock: { select: ReturnType<typeof vi.fn> },
  rows: unknown[][]
) {
  let call = 0;
  txMock.select.mockImplementation(() => {
    const rowsForCall = rows[call++] ?? [];
    return {
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          for: vi.fn().mockImplementation(() => ({
            then: (resolve: (v: unknown[]) => void) => resolve(rowsForCall),
            [Symbol.toStringTag]: "Promise",
          })),
          then: (resolve: (v: unknown[]) => void) => resolve(rowsForCall),
          [Symbol.toStringTag]: "Promise",
        }),
      }),
    };
  });
}

describe("transitionOrder → ready: push notification for earned points", () => {
  beforeEach(() => vi.clearAllMocks());

  it("calls sendPointsEarnedPush when customer earns points and has a push subscription", async () => {
    const { db, __txMock } = await import("@db/index") as unknown as {
      db: { select: ReturnType<typeof vi.fn>; transaction: ReturnType<typeof vi.fn> };
      __txMock: { select: ReturnType<typeof vi.fn>; insert: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
    };

    // db.select for fast existence check
    setupSelectSequence(db as unknown as { select: ReturnType<typeof vi.fn> }, [
      [{ id: ORDER_ID }],
    ]);

    // tx.select sequence: [0] lock row, [1] customer for push (after loyalty update)
    setupTxSelectSequence(__txMock, [
      [makeOrder()],                          // SELECT FOR UPDATE
      [makeCustomer({ loyaltyPoints: 75 })],  // customer re-fetch (after +25 pts earn on R50)
    ]);

    const { sendPointsEarnedPush } = await import("@/server/push/send");
    const { transitionOrder } = await import("@/server/actions/orders");

    await transitionOrder(ORDER_ID, "ready");

    // Give microtasks a chance to settle (fire-and-forget)
    await new Promise((r) => setTimeout(r, 0));

    expect(vi.mocked(sendPointsEarnedPush)).toHaveBeenCalledOnce();
    const [, pointsArg, balanceArg] = vi.mocked(sendPointsEarnedPush).mock.calls[0];
    expect(pointsArg).toBeGreaterThan(0);
    expect(balanceArg).toBe(75);
  });

  it("does NOT call sendPointsEarnedPush when customer has no push subscription", async () => {
    const { db, __txMock } = await import("@db/index") as unknown as {
      db: { select: ReturnType<typeof vi.fn>; transaction: ReturnType<typeof vi.fn> };
      __txMock: { select: ReturnType<typeof vi.fn>; insert: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
    };

    setupSelectSequence(db as unknown as { select: ReturnType<typeof vi.fn> }, [
      [{ id: ORDER_ID }],
    ]);

    setupTxSelectSequence(__txMock, [
      [makeOrder()],
      [makeCustomer({ pushSubscription: null, loyaltyPoints: 75 })],
    ]);

    const { sendPointsEarnedPush } = await import("@/server/push/send");
    const { transitionOrder } = await import("@/server/actions/orders");

    await transitionOrder(ORDER_ID, "ready");
    await new Promise((r) => setTimeout(r, 0));

    expect(vi.mocked(sendPointsEarnedPush)).not.toHaveBeenCalled();
  });
});
