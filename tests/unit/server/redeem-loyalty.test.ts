// redeemLoyalty unit tests — G8
// Tests RBAC, validation, state guards, and the happy path.

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("@db/index", () => {
  function chain() {
    const c: Record<string, unknown> = {
      from: vi.fn(),
      where: vi.fn(),
      orderBy: vi.fn(),
      limit: vi.fn(),
    };
    for (const k of ["from", "where", "orderBy", "limit"]) {
      (c[k] as ReturnType<typeof vi.fn>).mockReturnValue(c);
    }
    // default: return empty rows
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
        // make it thenable AND awaitable
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
      [mockOrder()],  // order found
      [],             // customer not found
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

// ─── Happy path ───────────────────────────────────────────────────────────────

describe("redeemLoyalty — happy path", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns ok and runs the transaction", async () => {
    const { db } = await import("@db/index");
    setupSelectSequence(db as unknown as { select: ReturnType<typeof vi.fn> }, [
      [mockOrder()],
      [mockCustomer(150)],
    ]);
    const { redeemLoyalty } = await import("@/server/actions/loyalty");
    const res = await redeemLoyalty(CUSTOMER_ID, ORDER_ID);
    expect(res.ok).toBe(true);
    expect(vi.mocked(db.transaction)).toHaveBeenCalledOnce();
  });

  it("writes audit on successful redemption", async () => {
    const { db } = await import("@db/index");
    setupSelectSequence(db as unknown as { select: ReturnType<typeof vi.fn> }, [
      [mockOrder()],
      [mockCustomer(100)],
    ]);
    const { redeemLoyalty } = await import("@/server/actions/loyalty");
    await redeemLoyalty(CUSTOMER_ID, ORDER_ID);
    const { writeAudit } = await import("@/server/audit");
    expect(vi.mocked(writeAudit)).toHaveBeenCalledOnce();
    const auditCall = vi.mocked(writeAudit).mock.calls[0][0];
    expect(auditCall.action).toBe("redeem_loyalty");
    expect(auditCall.after).toMatchObject({ totalZar: 0, loyaltyPoints: 0 });
  });
});
