import { describe, it, expect } from "vitest";
import {
  earnPoints,
  canRedeem,
  pointsValueZar,
  MIN_REDEEM_POINTS,
} from "@/server/loyalty/calc";

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
