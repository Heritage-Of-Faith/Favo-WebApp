// POS daily summary server-action unit tests — pos-summary.ts
// Tests RBAC guard, happy path, and zero-count handling for getPosToday.

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("@db/index", () => ({
  db: {
    execute: vi.fn().mockResolvedValue([{ revenue_zar: "15000", n: "5" }]),
  },
}));

vi.mock("@/server/auth/guard", () => ({
  authorize: vi.fn().mockResolvedValue({
    ok: true,
    session: { id: "staff_admin_gian", name: "Gian", role: "admin" },
  }),
}));

vi.mock("@/server/cogs/compute", () => ({
  todaySast: vi.fn().mockReturnValue("2026-06-14"),
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

const FORBIDDEN_RESULT = { ok: false as const, code: "FORBIDDEN" as const, message: "Insufficient role." };
const UNAUTHORIZED_RESULT = { ok: false as const, code: "UNAUTHORIZED" as const, message: "Not authenticated." };

// ─── getPosToday — RBAC ───────────────────────────────────────────────────────

describe("getPosToday — RBAC", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns FORBIDDEN for unauthenticated caller", async () => {
    const { authorize } = await import("@/server/auth/guard");
    vi.mocked(authorize).mockResolvedValueOnce(UNAUTHORIZED_RESULT);
    const { getPosToday } = await import("@/server/actions/pos-summary");
    const result = await getPosToday();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("UNAUTHORIZED");
  });

  it("returns FORBIDDEN when role is insufficient", async () => {
    const { authorize } = await import("@/server/auth/guard");
    vi.mocked(authorize).mockResolvedValueOnce(FORBIDDEN_RESULT);
    const { getPosToday } = await import("@/server/actions/pos-summary");
    const result = await getPosToday();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("FORBIDDEN");
  });
});

// ─── getPosToday — happy path ─────────────────────────────────────────────────

describe("getPosToday — happy path", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns ok with correct shape and types", async () => {
    const { db } = await import("@db/index");
    // Three sequential execute calls: revenue, orderCount, wasteCount
    vi.mocked(db.execute)
      .mockResolvedValueOnce([{ revenue_zar: "15000", n: "5" }] as never)
      .mockResolvedValueOnce([{ revenue_zar: null, n: "3" }] as never)
      .mockResolvedValueOnce([{ revenue_zar: null, n: "2" }] as never);

    const { getPosToday } = await import("@/server/actions/pos-summary");
    const result = await getPosToday();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.date).toBe("2026-06-14");
      expect(typeof result.data.orderCount).toBe("number");
      expect(typeof result.data.revenueZar).toBe("number");
      expect(typeof result.data.wasteCount).toBe("number");
      expect(result.data.revenueZar).toBe(15000);
      expect(result.data.orderCount).toBe(3);
      expect(result.data.wasteCount).toBe(2);
    }
  });
});

// ─── getPosToday — zero/null handling ────────────────────────────────────────

describe("getPosToday — zero/null handling", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns zero values when execute returns null fields", async () => {
    const { db } = await import("@db/index");
    vi.mocked(db.execute)
      .mockResolvedValueOnce([{ revenue_zar: null, n: null }] as never)
      .mockResolvedValueOnce([{ revenue_zar: null, n: null }] as never)
      .mockResolvedValueOnce([{ revenue_zar: null, n: null }] as never);

    const { getPosToday } = await import("@/server/actions/pos-summary");
    const result = await getPosToday();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.revenueZar).toBe(0);
      expect(result.data.orderCount).toBe(0);
      expect(result.data.wasteCount).toBe(0);
    }
  });

  it("returns zero values when execute returns empty array (no rows)", async () => {
    const { db } = await import("@db/index");
    vi.mocked(db.execute)
      .mockResolvedValueOnce([] as never)
      .mockResolvedValueOnce([] as never)
      .mockResolvedValueOnce([] as never);

    const { getPosToday } = await import("@/server/actions/pos-summary");
    const result = await getPosToday();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.revenueZar).toBe(0);
      expect(result.data.orderCount).toBe(0);
      expect(result.data.wasteCount).toBe(0);
    }
  });
});
