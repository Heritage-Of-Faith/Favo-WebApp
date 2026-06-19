// resolveStuckCharge unit tests — BUG-O2 (AT-121)
// Covers RBAC, validation, idempotency, NOT_FOUND, and the happy-path activation.

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockFor = vi.fn();
const mockWhere = vi.fn();
const mockFrom = vi.fn();
const mockSelect = vi.fn();
const mockUpdate = vi.fn();
const mockInsert = vi.fn();
const mockTxSelect = vi.fn();
const mockTxUpdate = vi.fn();
const mockTxInsert = vi.fn();

function makeSelectChain(rows: unknown[]) {
  const chain = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    for: vi.fn().mockImplementation(() => ({
      then: (resolve: (v: unknown[]) => void) => resolve(rows),
    })),
    then: (resolve: (v: unknown[]) => void) => resolve(rows),
  };
  return chain;
}

vi.mock("@db/index", () => {
  const txMock = {
    select: (...a: unknown[]) => mockTxSelect(...a),
    update: (...a: unknown[]) => mockTxUpdate(...a),
    insert: (...a: unknown[]) => mockTxInsert(...a),
  };
  return {
    db: {
      select: (...a: unknown[]) => mockSelect(...a),
      update: (...a: unknown[]) => mockUpdate(...a),
      insert: (...a: unknown[]) => mockInsert(...a),
      transaction: vi.fn().mockImplementation(async (fn: (tx: typeof txMock) => Promise<void>) => {
        await fn(txMock);
      }),
    },
    __txMock: txMock,
  };
});

vi.mock("@/server/auth/guard", () => ({
  authorize: vi.fn().mockResolvedValue({
    ok: true,
    session: { id: "staff_admin_1", name: "Admin", role: "admin" },
  }),
}));

vi.mock("@/server/audit", () => ({
  writeAudit: vi.fn().mockResolvedValue(undefined),
}));

// ─── Test data ────────────────────────────────────────────────────────────────

const CHARGE_ID = "pc_test123";
const PENDING_ROW = { id: CHARGE_ID, status: "pending", kind: "wallet_topup", customerId: "cust_1", amountZar: 5000, metadata: null };
const SUCCESSFUL_ROW = { id: CHARGE_ID, status: "successful" };

// ─── RBAC ─────────────────────────────────────────────────────────────────────

describe("resolveStuckCharge — RBAC", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns FORBIDDEN when caller is not admin", async () => {
    const { authorize } = await import("@/server/auth/guard");
    vi.mocked(authorize).mockResolvedValueOnce({ ok: false, code: "FORBIDDEN", message: "Admin only." });
    const { resolveStuckCharge } = await import("@/server/actions/loyalty");
    const result = await resolveStuckCharge(CHARGE_ID);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("FORBIDDEN");
  });
});

// ─── Validation ───────────────────────────────────────────────────────────────

describe("resolveStuckCharge — validation", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns VALIDATION when pendingChargeId is empty", async () => {
    const { resolveStuckCharge } = await import("@/server/actions/loyalty");
    const result = await resolveStuckCharge("");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("VALIDATION");
  });
});

// ─── NOT_FOUND ────────────────────────────────────────────────────────────────

describe("resolveStuckCharge — NOT_FOUND", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns NOT_FOUND when the charge does not exist", async () => {
    mockSelect.mockReturnValue(makeSelectChain([]));
    const { resolveStuckCharge } = await import("@/server/actions/loyalty");
    const result = await resolveStuckCharge(CHARGE_ID);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("NOT_FOUND");
  });
});

// ─── Idempotency ──────────────────────────────────────────────────────────────

describe("resolveStuckCharge — idempotency", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns already_resolved when charge is already successful", async () => {
    mockSelect.mockReturnValue(makeSelectChain([SUCCESSFUL_ROW]));
    const { resolveStuckCharge } = await import("@/server/actions/loyalty");
    const result = await resolveStuckCharge(CHARGE_ID);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.status).toBe("already_resolved");
  });

  it("does not open a transaction when already resolved", async () => {
    mockSelect.mockReturnValue(makeSelectChain([SUCCESSFUL_ROW]));
    const { db } = await import("@db/index");
    const { resolveStuckCharge } = await import("@/server/actions/loyalty");
    await resolveStuckCharge(CHARGE_ID);
    expect(vi.mocked(db.transaction)).not.toHaveBeenCalled();
  });
});

// ─── Happy path ───────────────────────────────────────────────────────────────

describe("resolveStuckCharge — happy path", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Pre-check select returns pending row
    mockSelect.mockReturnValue(makeSelectChain([PENDING_ROW]));
    // Transaction: SELECT FOR UPDATE returns pending row
    mockTxSelect.mockReturnValue(makeSelectChain([PENDING_ROW]));
    // Transaction: UPDATE pending_charges
    mockTxUpdate.mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
      }),
    });
    // Transaction: UPDATE customers (wallet_topup path inside activatePendingCharge)
    mockTxUpdate.mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
      }),
    });
  });

  it("returns status: completed", async () => {
    const { resolveStuckCharge } = await import("@/server/actions/loyalty");
    const result = await resolveStuckCharge(CHARGE_ID);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.status).toBe("completed");
  });

  it("opens a transaction to prevent concurrent double-credit", async () => {
    const { db } = await import("@db/index");
    const { resolveStuckCharge } = await import("@/server/actions/loyalty");
    await resolveStuckCharge(CHARGE_ID);
    expect(vi.mocked(db.transaction)).toHaveBeenCalledOnce();
  });
});
