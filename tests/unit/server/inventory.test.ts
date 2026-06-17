// Inventory server-action unit tests — inventory.ts
// Tests validation, RBAC guards, NOT_FOUND paths, and happy paths for
// setItemThreshold, updateLotCost, getActiveBeanLot, and listInventory.

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("@db/index", () => {
  function chain() {
    const c: Record<string, unknown> = {
      then: (resolve: (v: unknown[]) => void) => resolve([]),
      from: vi.fn(), where: vi.fn(), orderBy: vi.fn(), limit: vi.fn(),
      innerJoin: vi.fn(), leftJoin: vi.fn(),
    };
    for (const k of ["from", "where", "orderBy", "limit", "innerJoin", "leftJoin"]) {
      (c[k] as ReturnType<typeof vi.fn>).mockReturnValue(c);
    }
    return c;
  }
  return {
    db: {
      select: vi.fn().mockImplementation(chain),
      insert: vi.fn().mockReturnValue({
        values: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([{ id: "rec_new" }]),
        }),
      }),
      update: vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }),
      }),
      delete: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }),
      execute: vi.fn().mockResolvedValue([]),
      transaction: vi.fn().mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => {
        const tx = {
          insert: vi.fn().mockReturnValue({
            values: vi.fn().mockReturnValue({
              returning: vi.fn().mockResolvedValue([{ id: "rec_new" }]),
            }),
          }),
          update: vi.fn().mockReturnValue({
            set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }),
          }),
          delete: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }),
          select: vi.fn().mockImplementation(chain),
        };
        return cb(tx);
      }),
    },
  };
});

vi.mock("@/server/auth/guard", () => ({
  authorize: vi.fn().mockResolvedValue({
    ok: true,
    session: { id: "staff_admin_gian", name: "Gian", role: "admin" },
  }),
}));

vi.mock("@/server/audit", () => ({ writeAudit: vi.fn().mockResolvedValue(undefined) }));

// ─── Helpers ──────────────────────────────────────────────────────────────────

const FORBIDDEN_RESULT = { ok: false as const, code: "FORBIDDEN" as const, message: "Insufficient role." };

// ─── setItemThreshold — validation ───────────────────────────────────────────

describe("setItemThreshold — validation", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects fractional threshold (5.5)", async () => {
    const { setItemThreshold } = await import("@/server/actions/inventory");
    const result = await setItemThreshold("inv_item_1", 5.5);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("VALIDATION_ERROR");
  });

  it("rejects negative threshold (-1)", async () => {
    const { setItemThreshold } = await import("@/server/actions/inventory");
    const result = await setItemThreshold("inv_item_1", -1);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("VALIDATION_ERROR");
  });
});

// ─── setItemThreshold — RBAC ──────────────────────────────────────────────────

describe("setItemThreshold — RBAC", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns FORBIDDEN for barista (not in ADMIN_ROLES)", async () => {
    const { authorize } = await import("@/server/auth/guard");
    vi.mocked(authorize).mockResolvedValueOnce(FORBIDDEN_RESULT);
    const { setItemThreshold } = await import("@/server/actions/inventory");
    const result = await setItemThreshold("inv_item_1", 10);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("FORBIDDEN");
  });
});

// ─── setItemThreshold — NOT_FOUND ────────────────────────────────────────────

describe("setItemThreshold — NOT_FOUND", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns NOT_FOUND when inventory item does not exist", async () => {
    const { db } = await import("@db/index");
    vi.mocked(db.select).mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
      }),
    } as never);
    const { setItemThreshold } = await import("@/server/actions/inventory");
    const result = await setItemThreshold("inv_item_nonexistent", 10);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("NOT_FOUND");
  });
});

// ─── setItemThreshold — success ───────────────────────────────────────────────

describe("setItemThreshold — success", () => {
  beforeEach(() => vi.clearAllMocks());

  it("updates threshold and returns ok when item exists", async () => {
    const { db } = await import("@db/index");
    vi.mocked(db.select).mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([{ id: "inv_item_1", lowStockThreshold: 5 }]),
      }),
    } as never);
    const { setItemThreshold } = await import("@/server/actions/inventory");
    const result = await setItemThreshold("inv_item_1", 20);
    expect(result.ok).toBe(true);
  });

  it("accepts zero threshold (edge case — valid non-negative integer)", async () => {
    const { db } = await import("@db/index");
    vi.mocked(db.select).mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([{ id: "inv_item_1", lowStockThreshold: 5 }]),
      }),
    } as never);
    const { setItemThreshold } = await import("@/server/actions/inventory");
    const result = await setItemThreshold("inv_item_1", 0);
    expect(result.ok).toBe(true);
  });
});

// ─── updateLotCost — validation ───────────────────────────────────────────────

describe("updateLotCost — validation", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects non-numeric string 'abc'", async () => {
    const { updateLotCost } = await import("@/server/actions/inventory");
    const result = await updateLotCost("lot_1", "abc");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("VALIDATION_ERROR");
  });

  it("rejects negative cost '-5'", async () => {
    const { updateLotCost } = await import("@/server/actions/inventory");
    const result = await updateLotCost("lot_1", "-5");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("VALIDATION_ERROR");
  });
});

// ─── updateLotCost — RBAC ────────────────────────────────────────────────────

describe("updateLotCost — RBAC", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns FORBIDDEN for non-admin caller", async () => {
    const { authorize } = await import("@/server/auth/guard");
    vi.mocked(authorize).mockResolvedValueOnce(FORBIDDEN_RESULT);
    const { updateLotCost } = await import("@/server/actions/inventory");
    const result = await updateLotCost("lot_1", "15.00");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("FORBIDDEN");
  });
});

// ─── updateLotCost — NOT_FOUND ────────────────────────────────────────────────

describe("updateLotCost — NOT_FOUND", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns NOT_FOUND when lot does not exist", async () => {
    const { db } = await import("@db/index");
    vi.mocked(db.select).mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
      }),
    } as never);
    const { updateLotCost } = await import("@/server/actions/inventory");
    const result = await updateLotCost("lot_nonexistent", "15.00");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("NOT_FOUND");
  });
});

// ─── updateLotCost — success ─────────────────────────────────────────────────

describe("updateLotCost — success", () => {
  beforeEach(() => vi.clearAllMocks());

  it("updates lot cost and returns ok when lot exists", async () => {
    const { db } = await import("@db/index");
    vi.mocked(db.select).mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([{ id: "lot_1", unitCostZar: "10.00" }]),
      }),
    } as never);
    const { updateLotCost } = await import("@/server/actions/inventory");
    const result = await updateLotCost("lot_1", "15.00");
    expect(result.ok).toBe(true);
  });
});

// ─── getActiveBeanLot ─────────────────────────────────────────────────────────

describe("getActiveBeanLot", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns { lot: null } when no lot found", async () => {
    const { db } = await import("@db/index");
    vi.mocked(db.select).mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          orderBy: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([]),
          }),
        }),
      }),
    } as never);
    const { getActiveBeanLot } = await import("@/server/actions/inventory");
    const result = await getActiveBeanLot();
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.lot).toBeNull();
  });

  it("returns lot data when an active bean lot exists", async () => {
    const { db } = await import("@db/index");
    const fakeLot = {
      id: "lot_beans_1",
      inventoryItemId: "inv_item_espresso_beans",
      sourceName: "Bean Farm",
      batchNumber: "BF-001",
      roastDate: new Date("2026-05-01"),
      receivedAt: new Date("2026-05-02"),
      state: "active",
      origin: "Ethiopia",
      unitCostZar: "12.50",
      quantityReceived: 10000,
    };
    // First select: getActiveBeanLot's lot query
    vi.mocked(db.select).mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          orderBy: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([fakeLot]),
          }),
        }),
      }),
    } as never);
    // Second select: lotRunningStock's stockMovements query
    vi.mocked(db.select).mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([{ total: 9500 }]),
      }),
    } as never);
    const { getActiveBeanLot } = await import("@/server/actions/inventory");
    const result = await getActiveBeanLot();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.lot).not.toBeNull();
      expect(result.data.lot?.id).toBe("lot_beans_1");
      expect(result.data.lot?.quantityRemaining).toBe(9500);
    }
  });
});

// ─── listInventory — RBAC ─────────────────────────────────────────────────────

describe("listInventory — RBAC", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns FORBIDDEN for barista", async () => {
    const { authorize } = await import("@/server/auth/guard");
    vi.mocked(authorize).mockResolvedValueOnce(FORBIDDEN_RESULT);
    const { listInventory } = await import("@/server/actions/inventory");
    const result = await listInventory();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("FORBIDDEN");
  });
});
