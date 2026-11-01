// R3-2: "VS PREV" compares the visible window with the equal-length window
// immediately before it — not the first half against the second half.
import { describe, it, expect, vi } from "vitest";
import type { CogsLive } from "@/lib/types";

vi.mock("@/server/actions/cogs", () => ({ getCogsLive: vi.fn(), getCogsHistory: vi.fn() }));
vi.mock("@/hooks/useCogsLive", () => ({ useCogsLive: vi.fn() }));

function day(date: string, revenueZar: number): CogsLive {
  return {
    date, revenueZar, cogsZar: 0, expensesZar: 0, grossMarginZar: null, netZar: null,
    costState: "final", absentItems: [], ordersWithoutCost: 0,
  };
}

/** 14 Oct … 27 Oct; 14–20 Oct carry R2 703 (270300 c) on 20 Oct, 21–27 Oct R0. */
const FOURTEEN = Array.from({ length: 14 }, (_, i) => {
  const d = `2026-10-${String(14 + i).padStart(2, "0")}`;
  return day(d, d === "2026-10-20" ? 270300 : 0);
});

describe("periodComparison (R3-2)", () => {
  it("7d: R0 this week vs R2 703 the week before → down, not 'no change'", async () => {
    const { periodComparison, trendOf } = await import("@/components/admin/CogsDashboard");
    const { current, previous } = periodComparison(FOURTEEN, 7, "2026-10-27");
    expect(current.revenueZar).toBe(0);
    expect(previous?.revenueZar).toBe(270300);
    expect(trendOf(current.revenueZar, previous?.revenueZar)).toEqual({ direction: "down", label: "-100% vs prev" });
  });

  it("14d: R2 703 vs R410 in the 14 days before → up", async () => {
    const { periodComparison, trendOf } = await import("@/components/admin/CogsDashboard");
    const earlier = Array.from({ length: 14 }, (_, i) => {
      const d = new Date(Date.UTC(2026, 8, 30 + i)).toISOString().slice(0, 10); // 30 Sep … 13 Oct
      return day(d, i === 0 ? 41000 : 0);
    });
    const { current, previous } = periodComparison([...earlier, ...FOURTEEN], 14, "2026-10-27");
    expect(current.revenueZar).toBe(270300);
    expect(previous?.revenueZar).toBe(41000);
    expect(trendOf(current.revenueZar, previous?.revenueZar)?.direction).toBe("up");
  });

  it("no full prior window loaded → no arrow at all", async () => {
    const { periodComparison, trendOf } = await import("@/components/admin/CogsDashboard");
    const { previous } = periodComparison(FOURTEEN, 14, "2026-10-27");
    expect(previous).toBeUndefined();
    expect(trendOf(270300, previous?.revenueZar)).toBeUndefined();
  });
});
