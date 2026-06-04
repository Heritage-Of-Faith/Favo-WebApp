// Expenses + alert-recipient unit tests — task G12
// Tests validation (money, floats, RBAC) using mocked DB and auth.

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("@db/index", () => {
  function chain() {
    const c: Record<string, unknown> = {
      then: (resolve: (v: unknown[]) => void) => resolve([]),
      from: vi.fn(), where: vi.fn(), innerJoin: vi.fn(),
      leftJoin: vi.fn(), orderBy: vi.fn(), limit: vi.fn(),
    };
    for (const k of ["from", "where", "innerJoin", "leftJoin", "orderBy", "limit"]) {
      (c[k] as ReturnType<typeof vi.fn>).mockReturnValue(c);
    }
    return c;
  }
  return {
    db: {
      select: vi.fn().mockImplementation(chain),
      insert: vi.fn().mockReturnValue({
        values: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([{ id: "exp_new" }]),
        }),
      }),
      update: vi.fn().mockReturnValue({ set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }) }),
      execute: vi.fn().mockResolvedValue([]),
      transaction: vi.fn().mockImplementation(async (cb) => {
        const txDb = {
          insert: vi.fn().mockReturnValue({
            values: vi.fn().mockReturnValue({
              returning: vi.fn().mockResolvedValue([{ id: "exp_new" }]),
            }),
          }),
          update: vi.fn().mockReturnValue({ set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }) }),
          delete: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }),
          select: vi.fn().mockImplementation(chain),
        };
        await cb(txDb);
      }),
    },
  };
});

vi.mock("@/server/auth/guard", () => ({
  authorize: vi.fn().mockResolvedValue({
    ok: true,
    session: { id: "staff_manager_mia", name: "Mia", role: "admin" },
  }),
}));

vi.mock("@/server/audit", () => ({
  writeAudit: vi.fn().mockResolvedValue(undefined),
}));

// ─── logExpense — money validation ───────────────────────────────────────────

describe("logExpense — money validation", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects float amountZar (R150.50 → 15050.50)", async () => {
    const { logExpense } = await import("@/server/actions/expenses");
    const result = await logExpense({ category: "utilities", amountZar: 15050.50 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("VALIDATION_ERROR");
  });

  it("rejects zero amountZar", async () => {
    const { logExpense } = await import("@/server/actions/expenses");
    const result = await logExpense({ category: "utilities", amountZar: 0 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("VALIDATION_ERROR");
  });

  it("rejects negative amountZar", async () => {
    const { logExpense } = await import("@/server/actions/expenses");
    const result = await logExpense({ category: "utilities", amountZar: -100 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("VALIDATION_ERROR");
  });

  it("accepts valid integer amountZar and returns expenseId", async () => {
    const { logExpense } = await import("@/server/actions/expenses");
    const result = await logExpense({ category: "utilities", amountZar: 15000 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(typeof result.data.expenseId).toBe("string");
  });

  it("returns FORBIDDEN when caller is barista", async () => {
    const { authorize } = await import("@/server/auth/guard");
    vi.mocked(authorize).mockResolvedValueOnce({
      ok: false, code: "FORBIDDEN", message: "Insufficient role.",
    });
    const { logExpense } = await import("@/server/actions/expenses");
    const result = await logExpense({ category: "utilities", amountZar: 10000 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("FORBIDDEN");
  });

  it("writeAudit is called on successful logExpense", async () => {
    vi.clearAllMocks();
    const { authorize } = await import("@/server/auth/guard");
    vi.mocked(authorize).mockResolvedValue({
      ok: true, session: { id: "staff_manager_mia", name: "Mia", role: "admin" },
    });
    const { writeAudit } = await import("@/server/audit");
    const { logExpense } = await import("@/server/actions/expenses");
    await logExpense({ category: "rent", amountZar: 30000 });
    expect(writeAudit).toHaveBeenCalledOnce();
  });
});

// ─── addStockAlertRecipient — duplicate rejection ────────────────────────────

describe("addStockAlertRecipient — duplicate check", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects if recipient already exists", async () => {
    const { authorize } = await import("@/server/auth/guard");
    vi.mocked(authorize).mockResolvedValue({
      ok: true, session: { id: "staff_manager_mia", name: "Mia", role: "admin" },
    });

    const { db } = await import("@db/index");
    // Override select to return an existing row (simulates duplicate)
    vi.mocked(db.select).mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([{ id: "sar_existing" }]),
      }),
    } as never);

    const { addStockAlertRecipient } = await import("@/server/actions/alert-recipients");
    const result = await addStockAlertRecipient({
      staffId: "staff_barista_sam",
      inventoryItemId: null,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("CONFLICT");
  });

  it("returns FORBIDDEN for non-admin", async () => {
    const { authorize } = await import("@/server/auth/guard");
    vi.mocked(authorize).mockResolvedValueOnce({
      ok: false, code: "FORBIDDEN", message: "Insufficient role.",
    });
    const { addStockAlertRecipient } = await import("@/server/actions/alert-recipients");
    const result = await addStockAlertRecipient({ staffId: "staff_barista_sam", inventoryItemId: null });
    expect(result.ok).toBe(false);
  });
});

// ─── removeStockAlertRecipient — not found ────────────────────────────────────

describe("removeStockAlertRecipient — not found", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns NOT_FOUND for unknown recipient id", async () => {
    const { authorize } = await import("@/server/auth/guard");
    vi.mocked(authorize).mockResolvedValue({
      ok: true, session: { id: "staff_manager_mia", name: "Mia", role: "admin" },
    });
    const { db } = await import("@db/index");
    vi.mocked(db.select).mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
      }),
    } as never);

    const { removeStockAlertRecipient } = await import("@/server/actions/alert-recipients");
    const result = await removeStockAlertRecipient("sar_nonexistent");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("NOT_FOUND");
  });
});
