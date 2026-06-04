// Waste + purchase unit tests — task G10
// Tests validation logic and error paths. DB calls are mocked.

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("@db/index", () => ({
  db: {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    transaction: vi.fn(),
  },
}));

vi.mock("@/server/auth/guard", () => ({
  authorize: vi.fn(),
}));

vi.mock("@/server/audit", () => ({
  writeAudit: vi.fn().mockResolvedValue(undefined),
}));

// ─── logWaste validation ──────────────────────────────────────────────────────

describe("logWaste — validation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects quantity = 0", async () => {
    const { authorize } = await import("@/server/auth/guard");
    vi.mocked(authorize).mockResolvedValue({
      ok: true,
      session: { id: "staff_barista_sam", name: "Sam", role: "barista" },
    });

    const { logWaste } = await import("@/server/actions/waste");
    const result = await logWaste({ category: "spilled", quantity: 0 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("VALIDATION_ERROR");
  });

  it("rejects negative quantity", async () => {
    const { authorize } = await import("@/server/auth/guard");
    vi.mocked(authorize).mockResolvedValue({
      ok: true,
      session: { id: "staff_barista_sam", name: "Sam", role: "barista" },
    });

    const { logWaste } = await import("@/server/actions/waste");
    const result = await logWaste({ category: "damaged", quantity: -5 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("VALIDATION_ERROR");
  });

  it("rejects float quantity (not an integer)", async () => {
    const { authorize } = await import("@/server/auth/guard");
    vi.mocked(authorize).mockResolvedValue({
      ok: true,
      session: { id: "staff_barista_sam", name: "Sam", role: "barista" },
    });

    const { logWaste } = await import("@/server/actions/waste");
    const result = await logWaste({ category: "spilled", quantity: 1.5 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("VALIDATION_ERROR");
  });

  it("returns UNAUTHORIZED for unauthenticated calls", async () => {
    const { authorize } = await import("@/server/auth/guard");
    vi.mocked(authorize).mockResolvedValue({
      ok: false,
      code: "UNAUTHORIZED",
      message: "No session.",
    });

    const { logWaste } = await import("@/server/actions/waste");
    const result = await logWaste({ category: "expired", quantity: 10 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("UNAUTHORIZED");
  });
});

// ─── logWaste — lot state validation ─────────────────────────────────────────

describe("logWaste — lot state check", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects waste against an expired lot", async () => {
    const { authorize } = await import("@/server/auth/guard");
    vi.mocked(authorize).mockResolvedValue({
      ok: true,
      session: { id: "staff_barista_sam", name: "Sam", role: "barista" },
    });

    const { db } = await import("@db/index");
    vi.mocked(db.select).mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([{ id: "lot_001", state: "expired" }]),
      }),
    } as never);

    const { logWaste } = await import("@/server/actions/waste");
    const result = await logWaste({
      category: "expired",
      inventoryLotId: "lot_001",
      quantity: 10,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("INVALID_LOT_STATE");
  });

  it("rejects waste against a quarantined lot", async () => {
    const { authorize } = await import("@/server/auth/guard");
    vi.mocked(authorize).mockResolvedValue({
      ok: true,
      session: { id: "staff_barista_sam", name: "Sam", role: "barista" },
    });

    const { db } = await import("@db/index");
    vi.mocked(db.select).mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([{ id: "lot_001", state: "quarantined" }]),
      }),
    } as never);

    const { logWaste } = await import("@/server/actions/waste");
    const result = await logWaste({
      category: "damaged",
      inventoryLotId: "lot_001",
      quantity: 5,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("INVALID_LOT_STATE");
  });

  it("returns NOT_FOUND for an unknown lot", async () => {
    const { authorize } = await import("@/server/auth/guard");
    vi.mocked(authorize).mockResolvedValue({
      ok: true,
      session: { id: "staff_barista_sam", name: "Sam", role: "barista" },
    });

    const { db } = await import("@db/index");
    vi.mocked(db.select).mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
      }),
    } as never);

    const { logWaste } = await import("@/server/actions/waste");
    const result = await logWaste({
      category: "damaged",
      inventoryLotId: "lot_nonexistent",
      quantity: 5,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("NOT_FOUND");
  });
});

// ─── recordPurchase — validation ─────────────────────────────────────────────

describe("recordPurchase — validation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects empty items array", async () => {
    const { authorize } = await import("@/server/auth/guard");
    vi.mocked(authorize).mockResolvedValue({
      ok: true,
      session: { id: "staff_manager_mia", name: "Mia", role: "admin" },
    });

    const { recordPurchase } = await import("@/server/actions/purchases");
    const result = await recordPurchase({
      sourceName: "Supplier",
      kind: "planned",
      items: [],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("VALIDATION_ERROR");
  });

  it("rejects non-integer totalZar (float)", async () => {
    const { authorize } = await import("@/server/auth/guard");
    vi.mocked(authorize).mockResolvedValue({
      ok: true,
      session: { id: "staff_manager_mia", name: "Mia", role: "admin" },
    });

    const { recordPurchase } = await import("@/server/actions/purchases");
    const result = await recordPurchase({
      sourceName: "Supplier",
      kind: "planned",
      items: [
        {
          inventoryItemId: "inv_item_espresso_beans",
          quantity: 1000,
          unitCostZar: "0.4500",
          totalZar: 450.50, // float — invalid
        },
      ],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("VALIDATION_ERROR");
  });

  it("rejects negative quantity", async () => {
    const { authorize } = await import("@/server/auth/guard");
    vi.mocked(authorize).mockResolvedValue({
      ok: true,
      session: { id: "staff_manager_mia", name: "Mia", role: "admin" },
    });

    const { recordPurchase } = await import("@/server/actions/purchases");
    const result = await recordPurchase({
      sourceName: "Supplier",
      kind: "planned",
      items: [
        {
          inventoryItemId: "inv_item_espresso_beans",
          quantity: -500,
          unitCostZar: "0.4500",
          totalZar: 45000,
        },
      ],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("VALIDATION_ERROR");
  });

  it("returns UNAUTHORIZED for unauthenticated calls", async () => {
    const { authorize } = await import("@/server/auth/guard");
    vi.mocked(authorize).mockResolvedValue({
      ok: false,
      code: "UNAUTHORIZED",
      message: "No session.",
    });

    const { recordPurchase } = await import("@/server/actions/purchases");
    const result = await recordPurchase({
      sourceName: "Supplier",
      kind: "planned",
      items: [],
    });
    expect(result.ok).toBe(false);
  });
});

// ─── approveEmergencyPurchase — guards ────────────────────────────────────────

describe("approveEmergencyPurchase — guards", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns FORBIDDEN for barista (not admin)", async () => {
    const { authorize } = await import("@/server/auth/guard");
    vi.mocked(authorize).mockResolvedValue({
      ok: false,
      code: "FORBIDDEN",
      message: "Insufficient role.",
    });

    const { approveEmergencyPurchase } = await import("@/server/actions/purchases");
    const result = await approveEmergencyPurchase("purch_001");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("FORBIDDEN");
  });

  it("returns NOT_FOUND for unknown purchase id", async () => {
    const { authorize } = await import("@/server/auth/guard");
    vi.mocked(authorize).mockResolvedValue({
      ok: true,
      session: { id: "staff_manager_mia", name: "Mia", role: "admin" },
    });

    const { db } = await import("@db/index");
    vi.mocked(db.select).mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
      }),
    } as never);

    const { approveEmergencyPurchase } = await import("@/server/actions/purchases");
    const result = await approveEmergencyPurchase("purch_nonexistent");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("NOT_FOUND");
  });

  it("rejects approval of a non-emergency purchase", async () => {
    const { authorize } = await import("@/server/auth/guard");
    vi.mocked(authorize).mockResolvedValue({
      ok: true,
      session: { id: "staff_manager_mia", name: "Mia", role: "admin" },
    });

    const { db } = await import("@db/index");
    vi.mocked(db.select).mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([{
          id: "purch_001",
          inventoryLotId: "lot_001",
          kind: "planned", // not emergency
          status: "active",
        }]),
      }),
    } as never);

    const { approveEmergencyPurchase } = await import("@/server/actions/purchases");
    const result = await approveEmergencyPurchase("purch_001");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("CONFLICT");
  });

  it("rejects approval of an already-approved emergency purchase", async () => {
    const { authorize } = await import("@/server/auth/guard");
    vi.mocked(authorize).mockResolvedValue({
      ok: true,
      session: { id: "staff_manager_mia", name: "Mia", role: "admin" },
    });

    const { db } = await import("@db/index");
    vi.mocked(db.select).mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([{
          id: "purch_001",
          inventoryLotId: "lot_001",
          kind: "emergency",
          status: "active", // already approved
        }]),
      }),
    } as never);

    const { approveEmergencyPurchase } = await import("@/server/actions/purchases");
    const result = await approveEmergencyPurchase("purch_001");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("CONFLICT");
  });
});
