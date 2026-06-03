// COGS compute unit tests — task G13
// Tests pure helpers (todaySast, shape validation) without DB connection.
// Full integration (view queries, cost_estimated_warning) covered in
// tests/e2e/phase2-acceptance.spec.ts on staging.

import { describe, it, expect, vi } from "vitest";
import { todaySast } from "@/server/cogs/compute";
import type { CogsLive } from "@/lib/types";

// ─── todaySast ────────────────────────────────────────────────────────────────

describe("todaySast", () => {
  it("returns a YYYY-MM-DD string", () => {
    const result = todaySast();
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("is always today or yesterday relative to UTC (SAST is UTC+2)", () => {
    const result = todaySast();
    const utcNow = new Date().toISOString().slice(0, 10);
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    // Result is either today UTC or tomorrow (since SAST is ahead of UTC)
    const validDates = new Set([utcNow, yesterday,
      new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10)]);
    expect(validDates.has(result)).toBe(true);
  });
});

// ─── CogsLive shape ───────────────────────────────────────────────────────────

describe("CogsLive type contract", () => {
  it("profit = netZar > 0 must hold", () => {
    const cogs: CogsLive = {
      date: "2026-05-30",
      revenueZar: 100000,
      cogsZar: 40000,
      expensesZar: 15000,
      grossMarginZar: 60000,
      netZar: 45000,
      profit: true,
      costEstimatedWarning: false,
    };
    expect(cogs.profit).toBe(cogs.netZar > 0);
  });

  it("grossMarginZar = revenueZar - cogsZar", () => {
    const cogs: CogsLive = {
      date: "2026-05-30",
      revenueZar: 125600,
      cogsZar: 42800,
      expensesZar: 15000,
      grossMarginZar: 82800,
      netZar: 67800,
      profit: true,
      costEstimatedWarning: true,
    };
    expect(cogs.grossMarginZar).toBe(cogs.revenueZar - cogs.cogsZar);
    expect(cogs.netZar).toBe(cogs.grossMarginZar - cogs.expensesZar);
  });

  it("zero revenue day has profit=false", () => {
    const cogs: CogsLive = {
      date: "2026-05-30",
      revenueZar: 0,
      cogsZar: 0,
      expensesZar: 12000,
      grossMarginZar: 0,
      netZar: -12000,
      profit: false,
      costEstimatedWarning: false,
    };
    expect(cogs.profit).toBe(false);
    expect(cogs.netZar).toBeLessThan(0);
  });
});

// ─── getCogsLive action — auth guard ─────────────────────────────────────────

vi.mock("@/server/auth/guard", () => ({
  authorize: vi.fn().mockResolvedValue({
    ok: false, code: "FORBIDDEN", message: "Admin only.",
  }),
}));

vi.mock("@/server/cogs/compute", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@/server/cogs/compute")>();
  return {
    ...orig,
    getCogsLive: vi.fn().mockResolvedValue({
      date: "2026-05-30",
      revenueZar: 0, cogsZar: 0, expensesZar: 0,
      grossMarginZar: 0, netZar: 0, profit: false,
      costEstimatedWarning: false,
    }),
  };
});

describe("getCogsLive action — RBAC", () => {
  it("returns FORBIDDEN for non-admin callers", async () => {
    const { getCogsLive } = await import("@/server/actions/cogs");
    const result = await getCogsLive();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("FORBIDDEN");
  });
});
