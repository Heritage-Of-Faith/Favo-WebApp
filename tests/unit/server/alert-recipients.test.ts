// Stock alert recipient server-action unit tests — alert-recipients.ts
// Tests RBAC guards, CONFLICT on duplicate, NOT_FOUND on remove, and happy paths.

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

// ─── listStockAlertRecipients — RBAC ─────────────────────────────────────────

describe("listStockAlertRecipients — RBAC", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns FORBIDDEN for barista", async () => {
    const { authorize } = await import("@/server/auth/guard");
    vi.mocked(authorize).mockResolvedValueOnce(FORBIDDEN_RESULT);
    const { listStockAlertRecipients } = await import("@/server/actions/alert-recipients");
    const result = await listStockAlertRecipients();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("FORBIDDEN");
  });

  it("returns recipients list for admin", async () => {
    const { listStockAlertRecipients } = await import("@/server/actions/alert-recipients");
    const result = await listStockAlertRecipients();
    expect(result.ok).toBe(true);
    if (result.ok) expect(Array.isArray(result.data.recipients)).toBe(true);
  });
});

// ─── addStockAlertRecipient — RBAC ────────────────────────────────────────────

describe("addStockAlertRecipient — RBAC", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns FORBIDDEN for barista", async () => {
    const { authorize } = await import("@/server/auth/guard");
    vi.mocked(authorize).mockResolvedValueOnce(FORBIDDEN_RESULT);
    const { addStockAlertRecipient } = await import("@/server/actions/alert-recipients");
    const result = await addStockAlertRecipient({ staffId: "staff_1", inventoryItemId: "item_1" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("FORBIDDEN");
  });
});

// ─── addStockAlertRecipient — CONFLICT ────────────────────────────────────────

describe("addStockAlertRecipient — CONFLICT", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns CONFLICT when recipient already exists", async () => {
    const { db } = await import("@db/index");
    vi.mocked(db.select).mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([{ id: "rec_existing" }]),
      }),
    } as never);
    const { addStockAlertRecipient } = await import("@/server/actions/alert-recipients");
    const result = await addStockAlertRecipient({ staffId: "staff_1", inventoryItemId: "item_1" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("CONFLICT");
  });
});

// ─── addStockAlertRecipient — success ─────────────────────────────────────────

describe("addStockAlertRecipient — success", () => {
  beforeEach(() => vi.clearAllMocks());

  it("inserts and returns recipientId when no duplicate exists", async () => {
    const { db } = await import("@db/index");
    // select returns [] — no duplicate
    vi.mocked(db.select).mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
      }),
    } as never);
    const { addStockAlertRecipient } = await import("@/server/actions/alert-recipients");
    const result = await addStockAlertRecipient({ staffId: "staff_1", inventoryItemId: "item_1" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.recipientId).toBe("rec_new");
  });

  it("accepts null inventoryItemId (global alert)", async () => {
    const { db } = await import("@db/index");
    vi.mocked(db.select).mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
      }),
    } as never);
    const { addStockAlertRecipient } = await import("@/server/actions/alert-recipients");
    const result = await addStockAlertRecipient({ staffId: "staff_1", inventoryItemId: null });
    expect(result.ok).toBe(true);
    if (result.ok) expect(typeof result.data.recipientId).toBe("string");
  });
});

// ─── removeStockAlertRecipient — RBAC ────────────────────────────────────────

describe("removeStockAlertRecipient — RBAC", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns FORBIDDEN for barista", async () => {
    const { authorize } = await import("@/server/auth/guard");
    vi.mocked(authorize).mockResolvedValueOnce(FORBIDDEN_RESULT);
    const { removeStockAlertRecipient } = await import("@/server/actions/alert-recipients");
    const result = await removeStockAlertRecipient("rec_1");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("FORBIDDEN");
  });
});

// ─── removeStockAlertRecipient — NOT_FOUND ────────────────────────────────────

describe("removeStockAlertRecipient — NOT_FOUND", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns NOT_FOUND when select returns empty array", async () => {
    const { db } = await import("@db/index");
    vi.mocked(db.select).mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
      }),
    } as never);
    const { removeStockAlertRecipient } = await import("@/server/actions/alert-recipients");
    const result = await removeStockAlertRecipient("rec_nonexistent");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("NOT_FOUND");
  });
});

// ─── removeStockAlertRecipient — success ─────────────────────────────────────

describe("removeStockAlertRecipient — success", () => {
  beforeEach(() => vi.clearAllMocks());

  it("deletes and returns ok when recipient exists", async () => {
    const { db } = await import("@db/index");
    vi.mocked(db.select).mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([{ id: "rec_1" }]),
      }),
    } as never);
    const { removeStockAlertRecipient } = await import("@/server/actions/alert-recipients");
    const result = await removeStockAlertRecipient("rec_1");
    expect(result.ok).toBe(true);
  });
});
