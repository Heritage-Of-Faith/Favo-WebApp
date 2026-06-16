// Monthly P&L unit tests — task G15
// Tests RBAC, validation, and the admin sign state machine.

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
          returning: vi.fn().mockResolvedValue([{ id: "mr_new" }]),
        }),
      }),
      update: vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }),
      }),
      execute: vi.fn().mockResolvedValue([{ total: "0" }]),
      transaction: vi.fn().mockImplementation(async (cb) => {
        await cb({
          insert: vi.fn().mockReturnValue({
            values: vi.fn().mockReturnValue({
              returning: vi.fn().mockResolvedValue([{ id: "mr_new" }]),
            }),
          }),
          update: vi.fn().mockReturnValue({
            set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }),
          }),
          select: vi.fn().mockImplementation(chain),
        });
      }),
    },
  };
});

vi.mock("@/server/auth/guard", () => ({
  authorize: vi.fn().mockResolvedValue({
    ok: true,
    session: { id: "staff_admin_gian", name: "Gian Admin", role: "admin" },
  }),
}));

vi.mock("@/server/audit", () => ({
  writeAudit: vi.fn().mockResolvedValue(undefined),
}));

// ─── generateMonthlyPnL — validation ─────────────────────────────────────────

describe("generateMonthlyPnL — validation", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects non-first-of-month date", async () => {
    const { generateMonthlyPnL } = await import("@/server/actions/monthly-pnl");
    const result = await generateMonthlyPnL("2026-05-15");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("VALIDATION_ERROR");
  });

  it("rejects free-text month string", async () => {
    const { generateMonthlyPnL } = await import("@/server/actions/monthly-pnl");
    const result = await generateMonthlyPnL("May 2026");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("VALIDATION_ERROR");
  });

  it("rejects non-admin caller (barista)", async () => {
    const { authorize } = await import("@/server/auth/guard");
    vi.mocked(authorize).mockResolvedValueOnce({
      ok: false, code: "FORBIDDEN", message: "Admin only.",
    });
    const { generateMonthlyPnL } = await import("@/server/actions/monthly-pnl");
    const result = await generateMonthlyPnL("2026-05-01");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("FORBIDDEN");
  });

  it("rejects duplicate month (CONFLICT)", async () => {
    const { db } = await import("@db/index");
    // First select returns existing record
    vi.mocked(db.select).mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([{ id: "mr_existing" }]),
      }),
    } as never);

    const { generateMonthlyPnL } = await import("@/server/actions/monthly-pnl");
    const result = await generateMonthlyPnL("2026-05-01");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("CONFLICT");
  });
});

// ─── approveMonthlyPnL — RBAC ─────────────────────────────────────────────────

describe("approveMonthlyPnL — RBAC", () => {
  beforeEach(() => vi.clearAllMocks());

  it("barista role cannot sign", async () => {
    const { authorize } = await import("@/server/auth/guard");
    vi.mocked(authorize).mockResolvedValueOnce({
      ok: false, code: "FORBIDDEN", message: "Must be admin.",
    });
    const { approveMonthlyPnL } = await import("@/server/actions/monthly-pnl");
    const result = await approveMonthlyPnL("mr_001");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("FORBIDDEN");
  });

  it("returns NOT_FOUND for unknown report", async () => {
    const { db } = await import("@db/index");
    vi.mocked(db.select).mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
      }),
    } as never);

    const { approveMonthlyPnL } = await import("@/server/actions/monthly-pnl");
    const result = await approveMonthlyPnL("mr_nonexistent");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("NOT_FOUND");
  });

  it("rejects signing a closed report", async () => {
    const { db } = await import("@db/index");
    vi.mocked(db.select).mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([{
          id: "mr_001", month: "2026-04-01",
          status: "closed", adminSig: { signerId: "x", signerName: "X", at: "" },
        }]),
      }),
    } as never);

    const { approveMonthlyPnL } = await import("@/server/actions/monthly-pnl");
    const result = await approveMonthlyPnL("mr_001");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("CONFLICT");
  });

  it("rejects double-signing (admin sig already present)", async () => {
    const { db } = await import("@db/index");
    vi.mocked(db.select).mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([{
          id: "mr_001", month: "2026-04-01",
          status: "awaiting_signatures",
          adminSig: { signerId: "staff_gian", signerName: "Gian", at: "2026-05-01T09:00:00Z" },
        }]),
      }),
    } as never);

    const { approveMonthlyPnL } = await import("@/server/actions/monthly-pnl");
    const result = await approveMonthlyPnL("mr_001");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("CONFLICT");
  });
});

// ─── generateMonthlyPnL — month format accepted ───────────────────────────────

describe("generateMonthlyPnL — month format accepted", () => {
  beforeEach(() => vi.clearAllMocks());

  it("accepts valid first-of-month date", async () => {
    const { authorize } = await import("@/server/auth/guard");
    vi.mocked(authorize).mockResolvedValue({
      ok: true, session: { id: "staff_admin_gian", name: "Gian Admin", role: "admin" },
    });

    const { generateMonthlyPnL } = await import("@/server/actions/monthly-pnl");
    // Mock DB to return no existing report
    const { db } = await import("@db/index");
    vi.mocked(db.select).mockReturnValueOnce({
      from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }),
    } as never);

    const result = await generateMonthlyPnL("2026-04-01");
    // Should proceed (db mocked to return ok)
    expect(result.ok).toBe(true);
  });
});
