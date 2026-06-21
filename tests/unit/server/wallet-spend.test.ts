// walletSpend unit tests — AT-114 (W1+W2)
// Tests RBAC, validation, limits, loyalty earn, Yoco recreation, and audit.

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("@db/index", () => {
  function chain() {
    const c: Record<string, unknown> = { from: vi.fn(), where: vi.fn(), orderBy: vi.fn(), limit: vi.fn() };
    for (const k of ["from", "where", "orderBy", "limit"]) {
      (c[k] as ReturnType<typeof vi.fn>).mockReturnValue(c);
    }
    (c as { then?: unknown }).then = (resolve: (v: unknown[]) => void) => resolve([]);
    return c;
  }

  const txMock = {
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }),
    }),
    insert: vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue([]) }),
    select: vi.fn().mockImplementation(chain),
  };

  return {
    db: {
      select: vi.fn().mockImplementation(chain),
      transaction: vi.fn().mockImplementation(async (cb) => cb(txMock)),
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

vi.mock("@/server/yoco/client", () => ({
  createPaymentIntent: vi.fn().mockResolvedValue({ id: "ck_new_1", clientSecret: "ck_new_1" }),
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

const CUSTOMER_ID = "cust_1";
const ORDER_ID = "order_1";

function mockOrder(overrides: Record<string, unknown> = {}) {
  return { id: ORDER_ID, customerId: CUSTOMER_ID, state: "ordered", totalZar: 4500, ...overrides };
}
function mockCustomer(walletZar = 10000) {
  return { walletZar };
}

let callCount = 0;
function setupSelectSequence(db: { select: ReturnType<typeof vi.fn> }, rows: unknown[][]) {
  callCount = 0;
  db.select.mockImplementation(() => ({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockImplementation(() => {
        const row = rows[callCount++] ?? [];
        return {
          then: (resolve: (v: unknown[]) => void) => resolve(row),
          [Symbol.toStringTag]: "Promise",
        };
      }),
    }),
  }));
}

// ─── RBAC ─────────────────────────────────────────────────────────────────────

describe("walletSpend — RBAC", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects unauthenticated caller", async () => {
    const { authorize } = await import("@/server/auth/guard");
    vi.mocked(authorize).mockResolvedValueOnce({ ok: false, code: "UNAUTHORIZED", message: "Not signed in." });
    const { walletSpend } = await import("@/server/actions/wallet");
    const res = await walletSpend(CUSTOMER_ID, ORDER_ID, 1000);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("UNAUTHORIZED");
  });
});

// ─── Validation ───────────────────────────────────────────────────────────────

describe("walletSpend — validation", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects amountZar = 0", async () => {
    const { walletSpend } = await import("@/server/actions/wallet");
    const res = await walletSpend(CUSTOMER_ID, ORDER_ID, 0);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("VALIDATION_ERROR");
  });

  it("rejects fractional amountZar", async () => {
    const { walletSpend } = await import("@/server/actions/wallet");
    const res = await walletSpend(CUSTOMER_ID, ORDER_ID, 10.5);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("VALIDATION_ERROR");
  });

  it("returns NOT_FOUND for missing order", async () => {
    const { db } = await import("@db/index");
    setupSelectSequence(db as unknown as { select: ReturnType<typeof vi.fn> }, [[]]);
    const { walletSpend } = await import("@/server/actions/wallet");
    const res = await walletSpend(CUSTOMER_ID, ORDER_ID, 1000);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("NOT_FOUND");
  });

  it("rejects order not in 'ordered' state", async () => {
    const { db } = await import("@db/index");
    setupSelectSequence(db as unknown as { select: ReturnType<typeof vi.fn> }, [
      [mockOrder({ state: "in_progress" })],
    ]);
    const { walletSpend } = await import("@/server/actions/wallet");
    const res = await walletSpend(CUSTOMER_ID, ORDER_ID, 1000);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("CONFLICT");
  });

  it("rejects customer mismatch", async () => {
    const { db } = await import("@db/index");
    setupSelectSequence(db as unknown as { select: ReturnType<typeof vi.fn> }, [
      [mockOrder({ customerId: "other_cust" })],
    ]);
    const { walletSpend } = await import("@/server/actions/wallet");
    const res = await walletSpend(CUSTOMER_ID, ORDER_ID, 1000);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("VALIDATION_ERROR");
  });

  it("rejects spend exceeding order total", async () => {
    const { db } = await import("@db/index");
    setupSelectSequence(db as unknown as { select: ReturnType<typeof vi.fn> }, [
      [mockOrder({ totalZar: 2000 })],
    ]);
    const { walletSpend } = await import("@/server/actions/wallet");
    const res = await walletSpend(CUSTOMER_ID, ORDER_ID, 3000);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("VALIDATION_ERROR");
  });

  it("returns NOT_FOUND for missing customer", async () => {
    const { db } = await import("@db/index");
    setupSelectSequence(db as unknown as { select: ReturnType<typeof vi.fn> }, [
      [mockOrder()],
      [],
    ]);
    const { walletSpend } = await import("@/server/actions/wallet");
    const res = await walletSpend(CUSTOMER_ID, ORDER_ID, 1000);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("NOT_FOUND");
  });

  it("rejects when wallet balance is insufficient", async () => {
    const { db } = await import("@db/index");
    setupSelectSequence(db as unknown as { select: ReturnType<typeof vi.fn> }, [
      [mockOrder({ totalZar: 5000 })],
      [mockCustomer(500)], // only 500 cents
    ]);
    const { walletSpend } = await import("@/server/actions/wallet");
    const res = await walletSpend(CUSTOMER_ID, ORDER_ID, 1000); // wants 1000
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("CONFLICT");
  });
});

// ─── Happy path ───────────────────────────────────────────────────────────────

describe("walletSpend — happy path", () => {
  beforeEach(() => vi.clearAllMocks());

  it("partial spend: reduces total, returns new clientSecret", async () => {
    const { db } = await import("@db/index");
    setupSelectSequence(db as unknown as { select: ReturnType<typeof vi.fn> }, [
      [mockOrder({ totalZar: 4500 })],
      [mockCustomer(20000)],
    ]);
    const { walletSpend } = await import("@/server/actions/wallet");
    const res = await walletSpend(CUSTOMER_ID, ORDER_ID, 2000); // R20 wallet
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.newTotalZar).toBe(2500); // R45 - R20 = R25
      expect(res.data.clientSecret).toBe("ck_new_1");
    }
    expect(vi.mocked(db.transaction)).toHaveBeenCalledOnce();
  });

  it("full spend: newTotal = 0, clientSecret = null, no Yoco call", async () => {
    const { db } = await import("@db/index");
    setupSelectSequence(db as unknown as { select: ReturnType<typeof vi.fn> }, [
      [mockOrder({ totalZar: 2000 })],
      [mockCustomer(20000)],
    ]);
    const { createPaymentIntent } = await import("@/server/yoco/client");
    const { walletSpend } = await import("@/server/actions/wallet");
    const res = await walletSpend(CUSTOMER_ID, ORDER_ID, 2000);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.newTotalZar).toBe(0);
      expect(res.data.clientSecret).toBeNull();
    }
    expect(vi.mocked(createPaymentIntent)).not.toHaveBeenCalled();
  });

  it("earns loyalty points on wallet spend (L16)", async () => {
    const { db } = await import("@db/index");
    // R45 wallet spend → earnPoints(4500) = floor(4500/1000) * 5 = 4 * 5 = 20 pts
    setupSelectSequence(db as unknown as { select: ReturnType<typeof vi.fn> }, [
      [mockOrder({ totalZar: 4500 })],
      [mockCustomer(50000)],
    ]);
    const { walletSpend } = await import("@/server/actions/wallet");
    await walletSpend(CUSTOMER_ID, ORDER_ID, 4500);
    const { writeAudit } = await import("@/server/audit");
    const call = vi.mocked(writeAudit).mock.calls[0][0];
    expect(call.after).toMatchObject({ pointsEarned: 20 });
  });

  it("writes audit with correct before/after", async () => {
    const { db } = await import("@db/index");
    setupSelectSequence(db as unknown as { select: ReturnType<typeof vi.fn> }, [
      [mockOrder({ totalZar: 4500 })],
      [mockCustomer(10000)],
    ]);
    const { walletSpend } = await import("@/server/actions/wallet");
    await walletSpend(CUSTOMER_ID, ORDER_ID, 2000);
    const { writeAudit } = await import("@/server/audit");
    const call = vi.mocked(writeAudit).mock.calls[0][0];
    expect(call.action).toBe("wallet_spend");
    expect(call.before).toMatchObject({ totalZar: 4500, walletZar: 10000 });
    expect(call.after).toMatchObject({ totalZar: 2500, walletZar: 8000 });
  });

  it("Yoco failure returns PAYMENT_ERROR before any DB mutation", async () => {
    const { db } = await import("@db/index");
    setupSelectSequence(db as unknown as { select: ReturnType<typeof vi.fn> }, [
      [mockOrder({ totalZar: 4500 })],
      [mockCustomer(10000)],
    ]);
    const { createPaymentIntent } = await import("@/server/yoco/client");
    vi.mocked(createPaymentIntent).mockRejectedValueOnce(new Error("Yoco unavailable"));
    const { walletSpend } = await import("@/server/actions/wallet");
    const res = await walletSpend(CUSTOMER_ID, ORDER_ID, 2000);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("PAYMENT_ERROR");
    expect(vi.mocked(db.transaction)).not.toHaveBeenCalled();
  });
});

// ─── topUpWallet limits ───────────────────────────────────────────────────────

describe("topUpWallet — limit enforcement (AT-114)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects top-up over R1,000 (100,000 cents)", async () => {
    const { topUpWallet } = await import("@/server/actions/loyalty");
    const { db } = await import("@db/index");
    setupSelectSequence(db as unknown as { select: ReturnType<typeof vi.fn> }, [
      [{ id: CUSTOMER_ID, walletZar: 0 }],
    ]);
    const res = await topUpWallet(CUSTOMER_ID, 100001);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("VALIDATION_ERROR");
  });

  it("rejects top-up that would breach R2,500 balance cap", async () => {
    const { topUpWallet } = await import("@/server/actions/loyalty");
    const { db } = await import("@db/index");
    // Customer has R2,000 (200,000 cents), top-up R60,000 would reach R260,000 > R250,000
    setupSelectSequence(db as unknown as { select: ReturnType<typeof vi.fn> }, [
      [{ id: CUSTOMER_ID, walletZar: 200000 }],
    ]);
    const res = await topUpWallet(CUSTOMER_ID, 60000);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("CONFLICT");
  });
});
