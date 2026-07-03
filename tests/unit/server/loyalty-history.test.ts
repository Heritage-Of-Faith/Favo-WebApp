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

// Customer reads run inside withCustomerScope (RLS, F2/L13). Bypass the real
// transaction/role switch in unit tests and run the callback against the mocked
// db (DB-layer isolation is covered in tests/db/).
vi.mock("@/lib/db-rls", async () => {
  const { db } = await import("@db/index");
  return {
    withCustomerScope: (_customerId: string, fn: (tx: unknown) => unknown) => fn(db),
  };
});

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

// ─── points-earned push (moved to the Yoco webhook — F6 / L06) ────────────────
//
// The points-earned push previously fired from transitionOrder(→in_progress).
// Earn now triggers on the Yoco webhook (payment.succeeded), so the push fires
// there too. Those scenarios are covered in webhook-earn.test.ts:
//   W8 — push fires with the new balance when a subscription is present
//   W9 — no push when the customer has no valid subscription
// transitionOrder no longer earns or pushes points (see earn-scenarios.test.ts,
// "transitionOrder must NOT earn").
