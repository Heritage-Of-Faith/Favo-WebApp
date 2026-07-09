import { describe, it, expect } from "vitest";
import {
  earnPoints,
  canRedeem,
  pointsValueZar,
  formatLoyaltyBalance,
  MIN_REDEEM_POINTS,
} from "@/server/loyalty/calc";
import { formatZar } from "@/lib/format";

describe("loyalty: earning (5 pts per R10)", () => {
  it("earns 5 points per whole R10", () => {
    expect(earnPoints(1000)).toBe(5); // R10
    expect(earnPoints(5000)).toBe(25); // R50
    expect(earnPoints(10000)).toBe(50); // R100
  });

  it("only whole R10 increments earn (rounds down)", () => {
    expect(earnPoints(1999)).toBe(5); // R19.99 → one R10 unit
    expect(earnPoints(999)).toBe(0); // under R10
  });

  it("earns nothing on zero or negative totals", () => {
    expect(earnPoints(0)).toBe(0);
    expect(earnPoints(-500)).toBe(0);
  });
});

describe("loyalty: redemption threshold", () => {
  it("requires at least the minimum balance", () => {
    expect(canRedeem(MIN_REDEEM_POINTS)).toBe(true);
    expect(canRedeem(99)).toBe(false);
    expect(canRedeem(150)).toBe(true);
  });
});

describe("loyalty: points value (100 pts = R20)", () => {
  it("values whole 100-point units at R20 each", () => {
    expect(pointsValueZar(100)).toBe(2000);
    expect(pointsValueZar(250)).toBe(4000); // two whole units
  });

  it("is zero below the redemption unit", () => {
    expect(pointsValueZar(99)).toBe(0);
    expect(pointsValueZar(0)).toBe(0);
  });
});

describe("loyalty: balance display (AT-139 — money-first, points parenthetical)", () => {
  // Exact currency punctuation varies with the runtime's ICU data, so assert
  // structure via formatZar (which has its own tests) rather than literals.
  it("formats redeemable value first with points in parentheses", () => {
    expect(formatLoyaltyBalance(100)).toBe(`${formatZar(2000)} (100 pts)`);
    expect(formatLoyaltyBalance(250)).toBe(`${formatZar(4000)} (250 pts)`);
  });

  it("shows zero rand below the redemption unit but still shows the points", () => {
    expect(formatLoyaltyBalance(60)).toBe(`${formatZar(0)} (60 pts)`);
    expect(formatLoyaltyBalance(0)).toBe(`${formatZar(0)} (0 pts)`);
  });

  it("puts the money before the points and never says wallet", () => {
    const s = formatLoyaltyBalance(500);
    expect(s.indexOf("R")).toBeLessThan(s.indexOf("pts"));
    expect(s.toLowerCase()).not.toContain("wallet");
  });
});
