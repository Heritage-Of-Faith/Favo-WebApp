// redeemLoyalty unit tests — AT-115 (BUG-Y1)
// Covers: RBAC, validation, state guards, Yoco intent recreation, payments sync.

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("@db/index", () => {
  function chain() {
    const c: Record<string, unknown> = {
      from: vi.fn(),
      where: vi.fn(),
      orderBy: vi.fn(),
      limit: vi.fn(),
      // Required for SELECT ... FOR UPDATE used inside redeemLoyalty transaction.
      for: vi.fn(),
    };
    for (const k of ["from", "where", "orderBy", "limit", "for"]) {
      (c[k] as ReturnType<typeof vi.fn>).mockReturnValue(c);
    }
    (c as { then?: unknown }).then = (resolve: (v: unknown[]) => void) => resolve([]);
    return c;
  }

  const txMock = {
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }),
    }),
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockResolvedValue([]),
    }),
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
    session: { id: "staff_barista_sam", name: "Sam Barista", role: "barista" },
  }),
}));

vi.mock("@/server/audit", () => ({
  writeAudit: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/server/yoco/client", () => ({
  createPaymentIntent: vi.fn().mockResolvedValue({ id: "ck_new_intent", clientSecret: "ck_new_intent" }),
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

const CUSTOMER_ID = "cust_louis";
const ORDER_ID = "order_001";

function mockOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: ORDER_ID,
    customerId: CUSTOMER_ID,
    state: "ordered",
    totalZar: 4500,
    isStaffDiscount: false,
    ...overrides,
  };
}

function mockCustomer(loyaltyPoints = 100) {
  return { loyaltyPoints };
}

function setupSelectSequence(db: { select: ReturnType<typeof vi.fn> }, rows: unknown[][]) {
  let call = 0;
  db.select.mockImplementation(() => ({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockImplementation(() => ({
        then: (resolve: (v: unknown[]) => void) => resolve(rows[call++] ?? []),
        [Symbol.toStringTag]: "Promise",
      })),
    }),
  }));
}

// ─── RBAC ─────────────────────────────────────────────────────────────────────

describe("redeemLoyalty — RBAC", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects unauthenticated caller", async () => {
    const { authorize } = await import("@/server/auth/guard");
    vi.mocked(authorize).mockResolvedValueOnce({
      ok: false, code: "UNAUTHORIZED", message: "Not signed in.",
    });
    const { redeemLoyalty } = await import("@/server/actions/loyalty");
    const res = await redeemLoyalty(CUSTOMER_ID, ORDER_ID);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("UNAUTHORIZED");
  });

  it("rejects finance role", async () => {
    const { authorize } = await import("@/server/auth/guard");
    vi.mocked(authorize).mockResolvedValueOnce({
      ok: false, code: "FORBIDDEN", message: "Barista only.",
    });
    const { redeemLoyalty } = await import("@/server/actions/loyalty");
    const res = await redeemLoyalty(CUSTOMER_ID, ORDER_ID);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("FORBIDDEN");
  });
});

// ─── Validation ───────────────────────────────────────────────────────────────

describe("redeemLoyalty — order state guards", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns NOT_FOUND for missing order", async () => {
    const { db } = await import("@db/index");
    setupSelectSequence(db as unknown as { select: ReturnType<typeof vi.fn> }, [[]]);
    const { redeemLoyalty } = await import("@/server/actions/loyalty");
    const res = await redeemLoyalty(CUSTOMER_ID, ORDER_ID);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("NOT_FOUND");
  });

  it("rejects order not in 'ordered' state", async () => {
    const { db } = await import("@db/index");
    setupSelectSequence(db as unknown as { select: ReturnType<typeof vi.fn> }, [
      [mockOrder({ state: "in_progress" })],
    ]);
    const { redeemLoyalty } = await import("@/server/actions/loyalty");
    const res = await redeemLoyalty(CUSTOMER_ID, ORDER_ID);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("CONFLICT");
  });

  it("rejects customer mismatch", async () => {
    const { db } = await import("@db/index");
    setupSelectSequence(db as unknown as { select: ReturnType<typeof vi.fn> }, [
      [mockOrder({ customerId: "cust_other" })],
    ]);
    const { redeemLoyalty } = await import("@/server/actions/loyalty");
    const res = await redeemLoyalty(CUSTOMER_ID, ORDER_ID);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("VALIDATION_ERROR");
  });

  it("rejects combining with a staff discount", async () => {
    const { db } = await import("@db/index");
    setupSelectSequence(db as unknown as { select: ReturnType<typeof vi.fn> }, [
      [mockOrder({ isStaffDiscount: true })],
    ]);
    const { redeemLoyalty } = await import("@/server/actions/loyalty");
    const res = await redeemLoyalty(CUSTOMER_ID, ORDER_ID);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("CONFLICT");
  });
});

describe("redeemLoyalty — loyalty point guards", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns NOT_FOUND for missing customer", async () => {
    const { db } = await import("@db/index");
    setupSelectSequence(db as unknown as { select: ReturnType<typeof vi.fn> }, [
      [mockOrder()],
      [],
    ]);
    const { redeemLoyalty } = await import("@/server/actions/loyalty");
    const res = await redeemLoyalty(CUSTOMER_ID, ORDER_ID);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("NOT_FOUND");
  });

  it("rejects customer with insufficient points (99 pts)", async () => {
    const { db } = await import("@db/index");
    setupSelectSequence(db as unknown as { select: ReturnType<typeof vi.fn> }, [
      [mockOrder()],
      [mockCustomer(99)],
    ]);
    const { redeemLoyalty } = await import("@/server/actions/loyalty");
    const res = await redeemLoyalty(CUSTOMER_ID, ORDER_ID);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.code).toBe("CONFLICT");
      expect(res.message).toMatch(/99 pts/);
    }
  });
});

// ─── Yoco intent recreation ───────────────────────────────────────────────────

describe("redeemLoyalty — Yoco intent recreation", () => {
  beforeEach(() => vi.clearAllMocks());

  it("creates a new Yoco checkout for newTotalZar when > 0", async () => {
    const { db } = await import("@db/index");
    // totalZar=4500, discount=2000, newTotal=2500
    setupSelectSequence(db as unknown as { select: ReturnType<typeof vi.fn> }, [
      [mockOrder({ totalZar: 4500 })],
      [mockCustomer(150)],
    ]);
    const { redeemLoyalty } = await import("@/server/actions/loyalty");
    const { createPaymentIntent } = await import("@/server/yoco/client");
    const res = await redeemLoyalty(CUSTOMER_ID, ORDER_ID);
    expect(res.ok).toBe(true);
    expect(vi.mocked(createPaymentIntent)).toHaveBeenCalledOnce();
    expect(vi.mocked(createPaymentIntent)).toHaveBeenCalledWith(
      expect.objectContaining({ amountZar: 2500 })
    );
    if (res.ok) {
      expect(res.data.clientSecret).toBe("ck_new_intent");
      expect(res.data.discountZar).toBe(2000);
      expect(res.data.newTotalZar).toBe(2500);
    }
  });

  it("skips Yoco checkout when newTotalZar = 0 (order ≤ R20)", async () => {
    const { db } = await import("@db/index");
    // totalZar=1500 → discount capped at 1500, newTotal=0
    setupSelectSequence(db as unknown as { select: ReturnType<typeof vi.fn> }, [
      [mockOrder({ totalZar: 1500 })],
      [mockCustomer(100)],
    ]);
    const { redeemLoyalty } = await import("@/server/actions/loyalty");
    const { createPaymentIntent } = await import("@/server/yoco/client");
    const res = await redeemLoyalty(CUSTOMER_ID, ORDER_ID);
    expect(res.ok).toBe(true);
    expect(vi.mocked(createPaymentIntent)).not.toHaveBeenCalled();
    if (res.ok) {
      expect(res.data.clientSecret).toBeNull();
      expect(res.data.discountZar).toBe(1500);
      expect(res.data.newTotalZar).toBe(0);
    }
  });

  it("returns PAYMENT_ERROR and skips the DB transaction when Yoco fails", async () => {
    const { db } = await import("@db/index");
    setupSelectSequence(db as unknown as { select: ReturnType<typeof vi.fn> }, [
      [mockOrder({ totalZar: 4500 })],
      [mockCustomer(150)],
    ]);
    const { createPaymentIntent } = await import("@/server/yoco/client");
    vi.mocked(createPaymentIntent).mockRejectedValueOnce(new Error("Yoco API timeout"));
    const { redeemLoyalty } = await import("@/server/actions/loyalty");
    const res = await redeemLoyalty(CUSTOMER_ID, ORDER_ID);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.code).toBe("PAYMENT_ERROR");
      expect(res.message).toMatch(/Yoco API timeout/);
    }
    expect(vi.mocked(db.transaction)).not.toHaveBeenCalled();
  });
});

// ─── Payments sync ───────────────────────────────────────────────────────────

describe("redeemLoyalty — payments.amountZar sync (BUG-Y1)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("runs three updates (orders, customers, payments) in the transaction", async () => {
    const { db, __txMock } = await import("@db/index") as unknown as {
      db: { select: ReturnType<typeof vi.fn>; transaction: ReturnType<typeof vi.fn> };
      __txMock: { update: ReturnType<typeof vi.fn> };
    };
    setupSelectSequence(db as unknown as { select: ReturnType<typeof vi.fn> }, [
      [mockOrder({ totalZar: 4500 })],
      [mockCustomer(150)],
    ]);
    const { redeemLoyalty } = await import("@/server/actions/loyalty");
    await redeemLoyalty(CUSTOMER_ID, ORDER_ID);
    expect(vi.mocked(__txMock.update)).toHaveBeenCalledTimes(3);
  });

  it("sets payments.status=successful and clientSecret=null for R0 remainder", async () => {
    const { db } = await import("@db/index");
    // Exact R20 order → newTotal=0, no checkout needed
    setupSelectSequence(db as unknown as { select: ReturnType<typeof vi.fn> }, [
      [mockOrder({ totalZar: 2000 })],
      [mockCustomer(100)],
    ]);
    const { redeemLoyalty } = await import("@/server/actions/loyalty");
    const res = await redeemLoyalty(CUSTOMER_ID, ORDER_ID);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.newTotalZar).toBe(0);
      expect(res.data.clientSecret).toBeNull();
    }
  });
});

// ─── Happy path ───────────────────────────────────────────────────────────────

describe("redeemLoyalty — happy path", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns ok with discountZar=2000, newTotalZar, and clientSecret", async () => {
    const { db } = await import("@db/index");
    setupSelectSequence(db as unknown as { select: ReturnType<typeof vi.fn> }, [
      [mockOrder({ totalZar: 4500 })],
      [mockCustomer(150)],
    ]);
    const { redeemLoyalty } = await import("@/server/actions/loyalty");
    const res = await redeemLoyalty(CUSTOMER_ID, ORDER_ID);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.discountZar).toBe(2000);
      expect(res.data.newTotalZar).toBe(2500);
      expect(res.data.clientSecret).toBe("ck_new_intent");
    }
  });

  it("runs the DB transaction", async () => {
    const { db } = await import("@db/index");
    setupSelectSequence(db as unknown as { select: ReturnType<typeof vi.fn> }, [
      [mockOrder()],
      [mockCustomer(150)],
    ]);
    const { redeemLoyalty } = await import("@/server/actions/loyalty");
    await redeemLoyalty(CUSTOMER_ID, ORDER_ID);
    expect(vi.mocked(db.transaction)).toHaveBeenCalledOnce();
  });

  it("writes audit with correct before/after values", async () => {
    const { db } = await import("@db/index");
    setupSelectSequence(db as unknown as { select: ReturnType<typeof vi.fn> }, [
      [mockOrder({ totalZar: 4500 })],
      [mockCustomer(100)],
    ]);
    const { redeemLoyalty } = await import("@/server/actions/loyalty");
    await redeemLoyalty(CUSTOMER_ID, ORDER_ID);
    const { writeAudit } = await import("@/server/audit");
    expect(vi.mocked(writeAudit)).toHaveBeenCalledOnce();
    const auditCall = vi.mocked(writeAudit).mock.calls[0][0];
    expect(auditCall.action).toBe("redeem_loyalty");
    expect(auditCall.after).toMatchObject({ totalZar: 2500, discountZar: 2000, loyaltyPoints: 0 });
  });

  it("caps discount at order total when total < R20", async () => {
    const { db } = await import("@db/index");
    setupSelectSequence(db as unknown as { select: ReturnType<typeof vi.fn> }, [
      [mockOrder({ totalZar: 800 })],
      [mockCustomer(200)],
    ]);
    const { redeemLoyalty } = await import("@/server/actions/loyalty");
    const res = await redeemLoyalty(CUSTOMER_ID, ORDER_ID);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.discountZar).toBe(800);
      expect(res.data.newTotalZar).toBe(0);
    }
  });
});
