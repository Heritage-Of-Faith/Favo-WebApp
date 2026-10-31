// AT-208 · REQ-139 · REQ-106 · REQ-109 · REQ-110. PRD §6.2.3 L762, §7.1 L1940,
// §7.0.2 (order_cogs is THE ONE ROUNDING POINT), §7.0.3 FIXTURE-A L1881–1889.
//
// Margin broken out by shot count is built on the one figure path: each
// order's frozen order_cogs integer and its orders.total_zar, rolled up by
// rollupOrderCogs and passed through periodFigures. Nothing is re-rounded,
// nothing is apportioned: an order is attributed WHOLE to one shot bucket.
//
// The order integers and charges are typed in from the PRD's FIXTURE-A tables
// (L1867–1873 gross, L1881–1889 order_cogs). The Mochas and the Americano are
// single-shot (PRD L1917).

import { describe, it, expect } from "vitest";
import { dayMode, marginByShot, shotBucket, type ShotOrder } from "@/lib/margin-by-shot";
import { netTone } from "@/lib/cost-state";

const est = (cogsZar: number) => ({ cogsZar, absentItemIds: [], estimated: true });

// The thirteen FAVO orders of Sunday 2026-08-16.
const FIXTURE_A: ShotOrder[] = [
  ...Array.from({ length: 5 }, (): ShotOrder => ({ mode: "sunday", netChargedZar: 2000, coffeeShots: [2], cogs: est(1352) })), // #2649 #2643 #2642 #2640 #2639
  { mode: "sunday", netChargedZar: 4000, coffeeShots: [1, 2], cogs: est(2382) }, // #2648 double + single
  { mode: "sunday", netChargedZar: 2000, coffeeShots: [1], cogs: est(441) }, // #2647 Americano
  { mode: "sunday", netChargedZar: 4000, coffeeShots: [2], cogs: est(2704) }, // #2645
  { mode: "sunday", netChargedZar: 4000, coffeeShots: [2], cogs: est(2704) }, // #2636
  { mode: "sunday", netChargedZar: 2000, coffeeShots: [], cogs: est(743) }, // #2644 Hot Chocolate
  { mode: "sunday", netChargedZar: 2000, coffeeShots: [], cogs: est(743) }, // #2641 Hot Chocolate
  { mode: "sunday", netChargedZar: 5000, coffeeShots: [1], cogs: est(2128) }, // #2638 2 × Mocha
  { mode: "sunday", netChargedZar: 2000, coffeeShots: [1], cogs: est(1031) }, // #2637
];

describe("shotBucket", () => {
  it("one shot count across the order's coffee lines → that count", () => {
    expect(shotBucket([2])).toBe(2);
    expect(shotBucket([4, 4])).toBe(4);
  });
  it("two different shot counts → mixed (never split across buckets)", () => {
    expect(shotBucket([1, 2])).toBe("mixed");
  });
  it("no coffee line (hot chocolate) → no_coffee, never counted as a single shot", () => {
    expect(shotBucket([])).toBe("no_coffee");
  });
});

describe("marginByShot — FIXTURE-A (REQ-139)", () => {
  const rows = marginByShot(FIXTURE_A);
  const by = (b: string | number) => rows.find((r) => r.bucket === b)!;

  it("buckets in order 1, 2, mixed, no_coffee; absent buckets are not invented", () => {
    expect(rows.map((r) => r.bucket)).toEqual([1, 2, "mixed", "no_coffee"]);
  });

  it("the buckets sum to the PRD's day: cogs R196.36, gross R350.00, margin R153.64, 13 orders", () => {
    expect(rows.reduce((s, r) => s + (r.cogsZar ?? 0), 0)).toBe(19636);
    expect(rows.reduce((s, r) => s + r.revenueZar, 0)).toBe(35000);
    expect(rows.reduce((s, r) => s + (r.grossMarginZar ?? 0), 0)).toBe(15364);
    expect(rows.reduce((s, r) => s + r.orderCount, 0)).toBe(13);
  });

  it("single shot: R90.00 revenue, R36.00 cogs, R54.00 margin (60%)", () => {
    expect(by(1)).toMatchObject({ revenueZar: 9000, cogsZar: 3600, grossMarginZar: 5400, grossMarginPct: 60, orderCount: 3 });
  });

  it("double shot: R180.00 revenue, R121.68 cogs, R58.32 margin (32.4%) — the worst-margin form is visible", () => {
    expect(by(2)).toMatchObject({ revenueZar: 18000, cogsZar: 12168, grossMarginZar: 5832, grossMarginPct: 32.4, orderCount: 7 });
    expect(by(2).grossMarginPct!).toBeLessThan(by(1).grossMarginPct!);
  });

  it("mixed order #2648 stays whole: R40.00, R23.82, never apportioned", () => {
    expect(by("mixed")).toMatchObject({ revenueZar: 4000, cogsZar: 2382, grossMarginZar: 1618, orderCount: 1 });
  });

  it("every bucket renders provisional, never green (REQ-110, L39)", () => {
    for (const r of rows) {
      expect(r.costState).toBe("provisional");
      expect(r.tone).toBe("warn");
      expect(netTone(r.costState, r.grossMarginZar)).not.toBe("positive");
    }
  });
});

describe("marginByShot — by mode, never blended (§7.1)", () => {
  it("a weekday free cup (R0, real COGS) does not lower the Sunday double-shot bucket", () => {
    const freeCup: ShotOrder = { mode: "weekday", netChargedZar: 0, coffeeShots: [2], cogs: est(1352) };
    const rows = marginByShot([...FIXTURE_A, freeCup]);
    const sunday2 = rows.find((r) => r.mode === "sunday" && r.bucket === 2)!;
    expect(sunday2).toMatchObject({ revenueZar: 18000, cogsZar: 12168, grossMarginZar: 5832, grossMarginPct: 32.4, orderCount: 7 });
    expect(rows.find((r) => r.mode === "weekday" && r.bucket === 2)).toMatchObject({
      revenueZar: 0,
      cogsZar: 1352,
      grossMarginZar: -1352,
      orderCount: 1,
    });
  });

  it("modes sort Sunday, event, weekday, then days with mixed or no sessions", () => {
    const o = (mode: ShotOrder["mode"]): ShotOrder => ({ mode, netChargedZar: 2000, coffeeShots: [1], cogs: est(1031) });
    const rows = marginByShot([o("no_session"), o("weekday"), o("mixed_day"), o("event"), o("sunday")]);
    expect(rows.map((r) => r.mode)).toEqual(["sunday", "event", "weekday", "mixed_day", "no_session"]);
  });

  it("dayMode maps unknown or NULL to no_session", () => {
    expect(dayMode("sunday")).toBe("sunday");
    expect(dayMode(null)).toBe("no_session");
    expect(dayMode("bogus")).toBe("no_session");
  });
});

describe("marginByShot — the three render states", () => {
  it("no orders → no buckets (the screen shows its own empty state, never zeroes per shot)", () => {
    expect(marginByShot([])).toEqual([]);
  });

  it("an absent cost input anywhere in the period → EVERY bucket UNAVAILABLE, the item named (REQ-109, §7.0.2)", () => {
    const rows = marginByShot([
      { mode: "sunday", netChargedZar: 2000, coffeeShots: [1], cogs: est(1031) },
      { mode: "sunday", netChargedZar: 2000, coffeeShots: [2], cogs: { cogsZar: null, absentItemIds: ["inv_oat"], estimated: true } },
    ]);
    expect(rows).toHaveLength(2);
    for (const r of rows) {
      expect(r.costState).toBe("unavailable");
      expect(r.cogsZar).toBeNull();
      expect(r.grossMarginZar).toBeNull();
      expect(r.grossMarginPct).toBeNull();
      expect(r.absentItemIds).toEqual(["inv_oat"]);
      expect(r.tone).toBe("unavailable");
    }
    // Revenue is not cost-dependent.
    expect(rows.map((r) => r.revenueZar)).toEqual([2000, 2000]);
  });

  it("an order with no order_cogs row also refuses every bucket (REQ-109)", () => {
    const rows = marginByShot([
      { mode: "sunday", netChargedZar: 2000, coffeeShots: [1], cogs: est(1031) },
      { mode: "sunday", netChargedZar: 2000, coffeeShots: [3], cogs: { cogsZar: null, absentItemIds: [], estimated: null, missing: true } },
    ]);
    for (const r of rows) {
      expect(r.costState).toBe("unavailable");
      expect(r.ordersWithoutCost).toBe(1);
    }
  });

  it("an all-invoice bucket is final; an estimated one beside it stays provisional", () => {
    const rows = marginByShot([
      { mode: "sunday", netChargedZar: 3000, coffeeShots: [3], cogs: { cogsZar: 1400, absentItemIds: [], estimated: false } },
      { mode: "sunday", netChargedZar: 2000, coffeeShots: [2], cogs: est(1352) },
    ]);
    expect(rows.find((r) => r.bucket === 3)).toMatchObject({ costState: "final", tone: "positive" });
    expect(rows.find((r) => r.bucket === 2)).toMatchObject({ costState: "provisional", tone: "warn" });
  });
});
