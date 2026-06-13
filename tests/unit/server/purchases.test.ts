// Purchase server-action unit tests — purchases.ts
// Focuses on input validation (L08 money rules), L10 emergency-purchase logic,
// and approveEmergencyPurchase error branches. DB happy paths covered by E2E.

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("@db/index", () => {
  function chain() {
    const c: Record<string, unknown> = {
      then: (resolve: (v: unknown[]) => void) => resolve([]),
      from: vi.fn(), where: vi.fn(), orderBy: vi.fn(),
    };
    for (const k of ["from", "where", "orderBy"]) {
      (c[k] as ReturnType<typeof vi.fn>).mockReturnValue(c);
    }
    return c;
  }
  return {
    db: {
      select: vi.fn().mockImplementation(chain),
      insert: vi.fn().mockReturnValue({
        values: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([{ id: "purch_new", inventoryLotId: "lot_new" }]),
        }),
      }),
      update: vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }),
      }),
      transaction: vi.fn().mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => {
        const tx = {
          insert: vi.fn().mockReturnValue({
            values: vi.fn().mockReturnValue({
              returning: vi.fn().mockResolvedValue([{ id: "purch_new", inventoryLotId: "lot_new" }]),
            }),
          }),
          update: vi.fn().mockReturnValue({
            set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }),
          }),
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

const ADMIN_SESSION = { ok: true as const, session: { id: "staff_admin_gian", name: "Gian", role: "admin" as const } };
const BARISTA_SESSION = { ok: true as const, session: { id: "staff_barista_sam", name: "Sam", role: "barista" as const } };

const validItem = {
  inventoryItemId: "inv_beans",
  quantity: 1000,
  totalZar: 15000,
  unitCostZar: 15,
};

// ─── recordPurchase — validation ──────────────────────────────────────────────

describe("recordPurchase — validation", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects empty items array", async () => {
    const { recordPurchase } = await import("@/server/actions/purchases");
    const result = await recordPurchase({ sourceName: "Supplier", kind: "standard", items: [] });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("VALIDATION_ERROR");
  });

  it("rejects fractional totalZar (L08 — cents must be integer)", async () => {
    const { recordPurchase } = await import("@/server/actions/purchases");
    const result = await recordPurchase({
      sourceName: "Supplier",
      kind: "standard",
      items: [{ ...validItem, totalZar: 149.99 }],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("VALIDATION_ERROR");
  });

  it("rejects zero totalZar", async () => {
    const { recordPurchase } = await import("@/server/actions/purchases");
    const result = await recordPurchase({
      sourceName: "Supplier",
      kind: "standard",
      items: [{ ...validItem, totalZar: 0 }],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("VALIDATION_ERROR");
  });

  it("rejects negative quantity", async () => {
    const { recordPurchase } = await import("@/server/actions/purchases");
    const result = await recordPurchase({
      sourceName: "Supplier",
      kind: "standard",
      items: [{ ...validItem, quantity: -50 }],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("VALIDATION_ERROR");
  });

  it("rejects zero quantity", async () => {
    const { recordPurchase } = await import("@/server/actions/purchases");
    const result = await recordPurchase({
      sourceName: "Supplier",
      kind: "standard",
      items: [{ ...validItem, quantity: 0 }],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("VALIDATION_ERROR");
  });
});

// ─── recordPurchase — RBAC ────────────────────────────────────────────────────

describe("recordPurchase — RBAC", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns UNAUTHORIZED for unauthenticated caller", async () => {
    const { authorize } = await import("@/server/auth/guard");
    vi.mocked(authorize).mockResolvedValueOnce({
      ok: false, code: "UNAUTHORIZED", message: "Not authenticated.",
    });
    const { recordPurchase } = await import("@/server/actions/purchases");
    const result = await recordPurchase({ sourceName: "Supplier", kind: "standard", items: [validItem] });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("UNAUTHORIZED");
  });
});

// ─── recordPurchase — L10 emergency logic ────────────────────────────────────

describe("recordPurchase — L10 emergency purchase", () => {
  beforeEach(() => vi.clearAllMocks());

  it("admin submitting emergency purchase succeeds (auto-approved)", async () => {
    const { authorize } = await import("@/server/auth/guard");
    vi.mocked(authorize).mockResolvedValue(ADMIN_SESSION);
    const { recordPurchase } = await import("@/server/actions/purchases");
    const result = await recordPurchase({ sourceName: "Emergency Supplier", kind: "emergency", items: [validItem] });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.purchaseIds.length).toBeGreaterThan(0);
  });

  it("barista submitting emergency purchase succeeds (set to pending_admin_approval)", async () => {
    const { authorize } = await import("@/server/auth/guard");
    vi.mocked(authorize).mockResolvedValue(BARISTA_SESSION);
    const { recordPurchase } = await import("@/server/actions/purchases");
    const result = await recordPurchase({ sourceName: "Emergency Supplier", kind: "emergency", items: [validItem] });
    // The call succeeds — a purchase row is created with pending_admin_approval status
    expect(result.ok).toBe(true);
  });
});

// ─── approveEmergencyPurchase — error paths ───────────────────────────────────

describe("approveEmergencyPurchase — error paths", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns FORBIDDEN for non-admin caller", async () => {
    const { authorize } = await import("@/server/auth/guard");
    vi.mocked(authorize).mockResolvedValueOnce({
      ok: false, code: "FORBIDDEN", message: "Insufficient role.",
    });
    const { approveEmergencyPurchase } = await import("@/server/actions/purchases");
    const result = await approveEmergencyPurchase("purch_1");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("FORBIDDEN");
  });

  it("returns NOT_FOUND for unknown purchase id", async () => {
    const { authorize } = await import("@/server/auth/guard");
    vi.mocked(authorize).mockResolvedValue(ADMIN_SESSION);
    const { db } = await import("@db/index");
    vi.mocked(db.select).mockReturnValueOnce({
      from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }),
    } as never);
    const { approveEmergencyPurchase } = await import("@/server/actions/purchases");
    const result = await approveEmergencyPurchase("purch_nonexistent");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("NOT_FOUND");
  });

  it("returns CONFLICT when purchase kind is not emergency", async () => {
    const { authorize } = await import("@/server/auth/guard");
    vi.mocked(authorize).mockResolvedValue(ADMIN_SESSION);
    const { db } = await import("@db/index");
    vi.mocked(db.select).mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([
          { id: "purch_1", inventoryLotId: "lot_1", kind: "standard", status: "active" },
        ]),
      }),
    } as never);
    const { approveEmergencyPurchase } = await import("@/server/actions/purchases");
    const result = await approveEmergencyPurchase("purch_1");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("CONFLICT");
  });

  it("returns CONFLICT when purchase is not pending approval", async () => {
    const { authorize } = await import("@/server/auth/guard");
    vi.mocked(authorize).mockResolvedValue(ADMIN_SESSION);
    const { db } = await import("@db/index");
    vi.mocked(db.select).mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([
          { id: "purch_1", inventoryLotId: "lot_1", kind: "emergency", status: "active" },
        ]),
      }),
    } as never);
    const { approveEmergencyPurchase } = await import("@/server/actions/purchases");
    const result = await approveEmergencyPurchase("purch_1");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("CONFLICT");
  });
});
