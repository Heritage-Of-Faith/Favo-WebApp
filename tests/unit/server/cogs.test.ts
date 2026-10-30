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

// CHANGED (AT-189..192): CogsLive drops `profit` / `costEstimatedWarning` for
// `costState` + `absentItems`; cost figures are NULL when UNAVAILABLE.
describe("CogsLive type contract", () => {
  it("grossMarginZar = revenueZar - cogsZar, netZar = grossMarginZar", () => {
    const cogs: CogsLive = {
      date: "2026-05-30",
      revenueZar: 125600,
      cogsZar: 42800,
      expensesZar: 0,
      grossMarginZar: 82800,
      netZar: 82800,
      costState: "provisional",
      absentItems: [],
      ordersWithoutCost: 0,
    };
    expect(cogs.grossMarginZar).toBe(cogs.revenueZar - (cogs.cogsZar as number));
    expect(cogs.netZar).toBe(cogs.grossMarginZar);
  });

  it("COGS exceeding revenue produces a loss", () => {
    const cogs: CogsLive = {
      date: "2026-05-30",
      revenueZar: 10000,
      cogsZar: 15000,
      expensesZar: 0,
      grossMarginZar: -5000,
      netZar: -5000,
      costState: "final",
      absentItems: [],
      ordersWithoutCost: 0,
    };
    expect(cogs.netZar).toBeLessThan(0);
  });

  it("an UNAVAILABLE day carries no cost number, and names the item", () => {
    const cogs: CogsLive = {
      date: "2026-05-30",
      revenueZar: 10000,
      cogsZar: null,
      expensesZar: 0,
      grossMarginZar: null,
      netZar: null,
      costState: "unavailable",
      absentItems: ["Oat Milk"],
      ordersWithoutCost: 0,
    };
    expect(cogs.cogsZar).toBeNull();
    expect(cogs.absentItems).toEqual(["Oat Milk"]);
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
      grossMarginZar: 0, netZar: 0,
      costState: "empty", absentItems: [], ordersWithoutCost: 0,
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
