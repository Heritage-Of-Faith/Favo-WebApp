// adjustLoyalty unit tests — AT-123 (admin manual loyalty adjustment)
// Tests RBAC, validation, floor guard, and positive/negative adjustments.

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
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockResolvedValue([]),
    }),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([{ loyaltyPoints: 80 }]),
        }),
      }),
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
    session: { id: "staff_admin_mia", name: "Mia Admin", role: "admin" },
  }),
}));

vi.mock("@/server/audit", () => ({
  writeAudit: vi.fn().mockResolvedValue(undefined),
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

const CUSTOMER_ID = "cust_louis";

function mockCustomer(loyaltyPoints = 50) {
  return { id: CUSTOMER_ID, loyaltyPoints };
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

describe("adjustLoyalty — RBAC", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects barista role with FORBIDDEN", async () => {
    const { authorize } = await import("@/server/auth/guard");
    vi.mocked(authorize).mockResolvedValueOnce({
      ok: false,
      code: "FORBIDDEN",
      message: "Admin only.",
    });
    const { adjustLoyalty } = await import("@/server/actions/loyalty");
    const res = await adjustLoyalty(CUSTOMER_ID, 10, "test reason");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("FORBIDDEN");
  });
});

// ─── Validation ───────────────────────────────────────────────────────────────

describe("adjustLoyalty — validation", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects whitespace-only reason", async () => {
    const { adjustLoyalty } = await import("@/server/actions/loyalty");
    const res = await adjustLoyalty(CUSTOMER_ID, 10, "   ");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("VALIDATION_ERROR");
  });

  it("rejects delta = 0", async () => {
    const { adjustLoyalty } = await import("@/server/actions/loyalty");
    const res = await adjustLoyalty(CUSTOMER_ID, 0, "reason");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("VALIDATION_ERROR");
  });

  it("rejects fractional delta", async () => {
    const { adjustLoyalty } = await import("@/server/actions/loyalty");
    const res = await adjustLoyalty(CUSTOMER_ID, 1.5, "reason");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("VALIDATION_ERROR");
  });

  it("returns NOT_FOUND when customer does not exist", async () => {
    const { db } = await import("@db/index");
    setupSelectSequence(db as unknown as { select: ReturnType<typeof vi.fn> }, [[]]);
    const { adjustLoyalty } = await import("@/server/actions/loyalty");
    const res = await adjustLoyalty(CUSTOMER_ID, 10, "reason");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("NOT_FOUND");
  });

  it("returns VALIDATION_ERROR when delta would make balance go negative", async () => {
    const { db } = await import("@db/index");
    setupSelectSequence(db as unknown as { select: ReturnType<typeof vi.fn> }, [
      [mockCustomer(50)],
    ]);
    const { adjustLoyalty } = await import("@/server/actions/loyalty");
    const res = await adjustLoyalty(CUSTOMER_ID, -100, "manual correction");
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.code).toBe("VALIDATION_ERROR");
      expect(res.message).toMatch(/below zero/i);
    }
  });
});

// ─── Happy paths ──────────────────────────────────────────────────────────────

describe("adjustLoyalty — happy path (positive)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("positive adjustment: 50 pts + 30 → inserts txn, updates customers, calls writeAudit, returns newBalance=80", async () => {
    const { db, __txMock } = await import("@db/index") as unknown as {
      db: { select: ReturnType<typeof vi.fn>; transaction: ReturnType<typeof vi.fn> };
      __txMock: {
        insert: ReturnType<typeof vi.fn>;
        update: ReturnType<typeof vi.fn>;
      };
    };

    // txMock.update returns loyaltyPoints=80 in the .returning() chain
    __txMock.update.mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([{ loyaltyPoints: 80 }]),
        }),
      }),
    });

    setupSelectSequence(db as unknown as { select: ReturnType<typeof vi.fn> }, [
      [mockCustomer(50)],
    ]);

    const { adjustLoyalty } = await import("@/server/actions/loyalty");
    const res = await adjustLoyalty(CUSTOMER_ID, 30, "Goodwill gesture");

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.newBalance).toBe(80);
    }

    // insert called once (loyalty_transactions)
    expect(vi.mocked(__txMock.insert)).toHaveBeenCalledOnce();

    // update called once (customers)
    expect(vi.mocked(__txMock.update)).toHaveBeenCalledOnce();

    // writeAudit called once with correct payload
    const { writeAudit } = await import("@/server/audit");
    expect(vi.mocked(writeAudit)).toHaveBeenCalledOnce();
    const auditCall = vi.mocked(writeAudit).mock.calls[0][0];
    expect(auditCall.action).toBe("loyalty_adjustment");
    expect(auditCall.before).toMatchObject({ loyaltyPoints: 50 });
    expect(auditCall.after).toMatchObject({ loyaltyPoints: 80, reason: "Goodwill gesture" });
    expect(auditCall.actorRole).toBe("admin");
  });
});

describe("adjustLoyalty — happy path (negative)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("negative adjustment (valid): 50 pts - 20 → returns newBalance=30", async () => {
    const { db, __txMock } = await import("@db/index") as unknown as {
      db: { select: ReturnType<typeof vi.fn>; transaction: ReturnType<typeof vi.fn> };
      __txMock: {
        insert: ReturnType<typeof vi.fn>;
        update: ReturnType<typeof vi.fn>;
      };
    };

    __txMock.update.mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([{ loyaltyPoints: 30 }]),
        }),
      }),
    });

    setupSelectSequence(db as unknown as { select: ReturnType<typeof vi.fn> }, [
      [mockCustomer(50)],
    ]);

    const { adjustLoyalty } = await import("@/server/actions/loyalty");
    const res = await adjustLoyalty(CUSTOMER_ID, -20, "Points expired correction");

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.newBalance).toBe(30);
    }
  });
});
