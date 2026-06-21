// redeemLoyalty unit tests — AT-109 (multi-unit redemption)
// Tests RBAC, validation, server-side clamping, Yoco recreation, and audit.

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("@db/index", () => {
  function chain() {
    const c: Record<string, unknown> = {
      from: vi.fn(),
      where: vi.fn(),
      orderBy: vi.fn(),
      limit: vi.fn(),
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
  createPaymentIntent: vi.fn().mockResolvedValue({
    id: "ck_new_abc123",
    clientSecret: "ck_new_abc123",
  }),
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

const CUSTOMER_ID = "cust_louis";
const ORDER_ID = "order_001";

function mockOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: ORDER_ID,
    customerId: CUSTOMER_ID,
    state: "ordered",
    totalZar: 4500,        // R45.00
    isStaffDiscount: false,
    ...overrides,
  };
}

function mockCustomer(loyaltyPoints = 200) {
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
    vi.mocked(authorize).mockResolvedValueOnce({ ok: false, code: "UNAUTHORIZED", message: "Not signed in." });
    const { redeemLoyalty } = await import("@/server/actions/loyalty");
    const res = await redeemLoyalty(CUSTOMER_ID, ORDER_ID, 1);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("UNAUTHORIZED");
  });

  it("rejects non-barista role", async () => {
    const { authorize } = await import("@/server/auth/guard");
    vi.mocked(authorize).mockResolvedValueOnce({ ok: false, code: "FORBIDDEN", message: "Barista only." });
    const { redeemLoyalty } = await import("@/server/actions/loyalty");
    const res = await redeemLoyalty(CUSTOMER_ID, ORDER_ID, 1);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("FORBIDDEN");
  });
});

// ─── Input validation ─────────────────────────────────────────────────────────

describe("redeemLoyalty — units validation", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects units = 0", async () => {
    const { redeemLoyalty } = await import("@/server/actions/loyalty");
    const res = await redeemLoyalty(CUSTOMER_ID, ORDER_ID, 0);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("VALIDATION_ERROR");
  });

  it("rejects fractional units", async () => {
    const { redeemLoyalty } = await import("@/server/actions/loyalty");
    const res = await redeemLoyalty(CUSTOMER_ID, ORDER_ID, 1.5);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("VALIDATION_ERROR");
  });

  it("rejects negative units", async () => {
    const { redeemLoyalty } = await import("@/server/actions/loyalty");
    const res = await redeemLoyalty(CUSTOMER_ID, ORDER_ID, -1);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("VALIDATION_ERROR");
  });
});

// ─── Order / customer guards ───────────────────────────────────────────────────

describe("redeemLoyalty — order state guards", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns NOT_FOUND for missing order", async () => {
    const { db } = await import("@db/index");
    setupSelectSequence(db as unknown as { select: ReturnType<typeof vi.fn> }, [[]]);
    const { redeemLoyalty } = await import("@/server/actions/loyalty");
    const res = await redeemLoyalty(CUSTOMER_ID, ORDER_ID, 1);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("NOT_FOUND");
  });

  it("rejects order not in 'ordered' state", async () => {
    const { db } = await import("@db/index");
    setupSelectSequence(db as unknown as { select: ReturnType<typeof vi.fn> }, [
      [mockOrder({ state: "in_progress" })],
    ]);
    const { redeemLoyalty } = await import("@/server/actions/loyalty");
    const res = await redeemLoyalty(CUSTOMER_ID, ORDER_ID, 1);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("CONFLICT");
  });

  it("rejects customer mismatch", async () => {
    const { db } = await import("@db/index");
    setupSelectSequence(db as unknown as { select: ReturnType<typeof vi.fn> }, [
      [mockOrder({ customerId: "cust_other" })],
    ]);
    const { redeemLoyalty } = await import("@/server/actions/loyalty");
    const res = await redeemLoyalty(CUSTOMER_ID, ORDER_ID, 1);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("VALIDATION_ERROR");
  });

  it("rejects combining with a staff discount (L17)", async () => {
    const { db } = await import("@db/index");
    setupSelectSequence(db as unknown as { select: ReturnType<typeof vi.fn> }, [
      [mockOrder({ isStaffDiscount: true })],
    ]);
    const { redeemLoyalty } = await import("@/server/actions/loyalty");
    const res = await redeemLoyalty(CUSTOMER_ID, ORDER_ID, 1);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("CONFLICT");
  });

  it("returns NOT_FOUND for missing customer", async () => {
    const { db } = await import("@db/index");
    setupSelectSequence(db as unknown as { select: ReturnType<typeof vi.fn> }, [
      [mockOrder()], // order found
      [],           // customer not found
    ]);
    const { redeemLoyalty } = await import("@/server/actions/loyalty");
    const res = await redeemLoyalty(CUSTOMER_ID, ORDER_ID, 1);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("NOT_FOUND");
  });
});

// ─── Server-side clamping (L06) ───────────────────────────────────────────────

describe("redeemLoyalty — clamping", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects when customer has fewer than 100 pts (cannot form 1 unit)", async () => {
    const { db } = await import("@db/index");
    setupSelectSequence(db as unknown as { select: ReturnType<typeof vi.fn> }, [
      [mockOrder({ totalZar: 4500 })],
      [mockCustomer(99)],
    ]);
    const { redeemLoyalty } = await import("@/server/actions/loyalty");
    const res = await redeemLoyalty(CUSTOMER_ID, ORDER_ID, 1);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("CONFLICT");
  });

  it("rejects when order total < R20 (floor(1500/2000) = 0)", async () => {
    const { db } = await import("@db/index");
    setupSelectSequence(db as unknown as { select: ReturnType<typeof vi.fn> }, [
      [mockOrder({ totalZar: 1500 })], // R15 — less than one R20 unit
      [mockCustomer(200)],
    ]);
    const { redeemLoyalty } = await import("@/server/actions/loyalty");
    const res = await redeemLoyalty(CUSTOMER_ID, ORDER_ID, 1);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("CONFLICT");
  });

  it("clamps requested units down to pts available", async () => {
    // 200 pts (2 units max by pts), R90 order (4 units max by total), requesting 5 → clamp to 2
    const { db } = await import("@db/index");
    setupSelectSequence(db as unknown as { select: ReturnType<typeof vi.fn> }, [
      [mockOrder({ totalZar: 9000 })],
      [mockCustomer(200)],
    ]);
    const { redeemLoyalty } = await import("@/server/actions/loyalty");
    const res = await redeemLoyalty(CUSTOMER_ID, ORDER_ID, 5);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.pointsUsed).toBe(200);   // 2 units × 100 pts
      expect(res.data.discountZar).toBe(4000); // 2 units × R20
      expect(res.data.newTotalZar).toBe(5000); // R90 − R40
    }
  });

  it("clamps requested units down to what total allows", async () => {
    // 500 pts (5 units max by pts), R45 order (2 units max by total), requesting 5 → clamp to 2
    const { db } = await import("@db/index");
    setupSelectSequence(db as unknown as { select: ReturnType<typeof vi.fn> }, [
      [mockOrder({ totalZar: 4500 })],
      [mockCustomer(500)],
    ]);
    const { redeemLoyalty } = await import("@/server/actions/loyalty");
    const res = await redeemLoyalty(CUSTOMER_ID, ORDER_ID, 5);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.pointsUsed).toBe(200);  // 2 units × 100 pts
      expect(res.data.discountZar).toBe(4000); // 2 units × R20
      expect(res.data.newTotalZar).toBe(500);  // R45 − R40
    }
  });
});

// ─── Yoco intent recreation ───────────────────────────────────────────────────

describe("redeemLoyalty — Yoco intent recreation", () => {
  beforeEach(() => vi.clearAllMocks());

  it("creates a new Yoco checkout for newTotalZar when > 0", async () => {
    const { db } = await import("@db/index");
    // totalZar=4500, 1 unit discount=2000, newTotal=2500
    setupSelectSequence(db as unknown as { select: ReturnType<typeof vi.fn> }, [
      [mockOrder({ totalZar: 4500 })],
      [mockCustomer(150)],
    ]);
    const { redeemLoyalty } = await import("@/server/actions/loyalty");
    const { createPaymentIntent } = await import("@/server/yoco/client");
    const res = await redeemLoyalty(CUSTOMER_ID, ORDER_ID, 1);
    expect(res.ok).toBe(true);
    expect(vi.mocked(createPaymentIntent)).toHaveBeenCalledOnce();
    expect(vi.mocked(createPaymentIntent)).toHaveBeenCalledWith(
      expect.objectContaining({ amountZar: 2500 })
    );
    if (res.ok) {
      expect(res.data.clientSecret).toBe("ck_new_abc123");
      expect(res.data.discountZar).toBe(2000);
      expect(res.data.newTotalZar).toBe(2500);
    }
  });

  it("skips Yoco checkout when newTotalZar = 0 (exact R20 order)", async () => {
    const { db } = await import("@db/index");
    setupSelectSequence(db as unknown as { select: ReturnType<typeof vi.fn> }, [
      [mockOrder({ totalZar: 2000 })],
      [mockCustomer(100)],
    ]);
    const { redeemLoyalty } = await import("@/server/actions/loyalty");
    const { createPaymentIntent } = await import("@/server/yoco/client");
    const res = await redeemLoyalty(CUSTOMER_ID, ORDER_ID, 1);
    expect(res.ok).toBe(true);
    expect(vi.mocked(createPaymentIntent)).not.toHaveBeenCalled();
    if (res.ok) {
      expect(res.data.clientSecret).toBeNull();
      expect(res.data.discountZar).toBe(2000);
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
    const res = await redeemLoyalty(CUSTOMER_ID, ORDER_ID, 1);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.code).toBe("PAYMENT_ERROR");
      expect(res.message).toMatch(/Yoco API timeout/);
    }
    expect(vi.mocked(db.transaction)).not.toHaveBeenCalled();
  });
});

// ─── Payments sync (BUG-Y1) ───────────────────────────────────────────────────

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
    await redeemLoyalty(CUSTOMER_ID, ORDER_ID, 1);
    expect(vi.mocked(__txMock.update)).toHaveBeenCalledTimes(3);
  });

  it("sets payments.status=successful and clientSecret=null for R0 remainder", async () => {
    const { db } = await import("@db/index");
    setupSelectSequence(db as unknown as { select: ReturnType<typeof vi.fn> }, [
      [mockOrder({ totalZar: 2000 })],
      [mockCustomer(100)],
    ]);
    const { redeemLoyalty } = await import("@/server/actions/loyalty");
    const res = await redeemLoyalty(CUSTOMER_ID, ORDER_ID, 1);
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

  it("single unit: R45 order, 150 pts → R20 off, new total R25", async () => {
    const { db } = await import("@db/index");
    setupSelectSequence(db as unknown as { select: ReturnType<typeof vi.fn> }, [
      [mockOrder({ totalZar: 4500 })],
      [mockCustomer(150)],
    ]);
    const { redeemLoyalty } = await import("@/server/actions/loyalty");
    const res = await redeemLoyalty(CUSTOMER_ID, ORDER_ID, 1);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.discountZar).toBe(2000);
      expect(res.data.pointsUsed).toBe(100);
      expect(res.data.newTotalZar).toBe(2500);
      expect(res.data.clientSecret).toBe("ck_new_abc123");
    }
  });

  it("two units: R60 order, 300 pts → R40 off, new total R20", async () => {
    const { db } = await import("@db/index");
    setupSelectSequence(db as unknown as { select: ReturnType<typeof vi.fn> }, [
      [mockOrder({ totalZar: 6000 })],
      [mockCustomer(300)],
    ]);
    const { redeemLoyalty } = await import("@/server/actions/loyalty");
    const res = await redeemLoyalty(CUSTOMER_ID, ORDER_ID, 2);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.discountZar).toBe(4000);
      expect(res.data.pointsUsed).toBe(200);
      expect(res.data.newTotalZar).toBe(2000);
    }
    expect(vi.mocked(db.transaction)).toHaveBeenCalledOnce();
  });

  it("exact R20 order with 100 pts → newTotal 0, clientSecret null (free order)", async () => {
    const { db } = await import("@db/index");
    setupSelectSequence(db as unknown as { select: ReturnType<typeof vi.fn> }, [
      [mockOrder({ totalZar: 2000 })],
      [mockCustomer(100)],
    ]);
    const { createPaymentIntent } = await import("@/server/yoco/client");
    const { redeemLoyalty } = await import("@/server/actions/loyalty");
    const res = await redeemLoyalty(CUSTOMER_ID, ORDER_ID, 1);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.newTotalZar).toBe(0);
      expect(res.data.clientSecret).toBeNull();
    }
    expect(vi.mocked(createPaymentIntent)).not.toHaveBeenCalled();
  });

  it("writes audit with correct before/after", async () => {
    const { db } = await import("@db/index");
    setupSelectSequence(db as unknown as { select: ReturnType<typeof vi.fn> }, [
      [mockOrder({ totalZar: 4500 })],
      [mockCustomer(200)],
    ]);
    const { redeemLoyalty } = await import("@/server/actions/loyalty");
    await redeemLoyalty(CUSTOMER_ID, ORDER_ID, 1);
    const { writeAudit } = await import("@/server/audit");
    expect(vi.mocked(writeAudit)).toHaveBeenCalledOnce();
    const call = vi.mocked(writeAudit).mock.calls[0][0];
    expect(call.action).toBe("redeem_loyalty");
    expect(call.before).toMatchObject({ totalZar: 4500, loyaltyPoints: 200 });
    expect(call.after).toMatchObject({ totalZar: 2500, discountZar: 2000, pointsUsed: 100, clampedUnits: 1 });
  });

  it("Yoco failure returns PAYMENT_ERROR and does not mutate DB", async () => {
    const { db } = await import("@db/index");
    setupSelectSequence(db as unknown as { select: ReturnType<typeof vi.fn> }, [
      [mockOrder({ totalZar: 4500 })],
      [mockCustomer(200)],
    ]);
    const { createPaymentIntent } = await import("@/server/yoco/client");
    vi.mocked(createPaymentIntent).mockRejectedValueOnce(new Error("Yoco down"));
    const { redeemLoyalty } = await import("@/server/actions/loyalty");
    const res = await redeemLoyalty(CUSTOMER_ID, ORDER_ID, 1);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("PAYMENT_ERROR");
    expect(vi.mocked(db.transaction)).not.toHaveBeenCalled();
  });
});
