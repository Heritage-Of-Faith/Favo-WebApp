import { describe, it, expect } from "vitest";
import {
  computeUnitPriceZar,
  computeLineTotalZar,
  computeOrderTotalZar,
} from "@/server/orders/pricing";

describe("pricing: unit price", () => {
  it("returns base price when there are no modifications", () => {
    expect(computeUnitPriceZar(3800, [])).toBe(3800);
  });

  it("adds modification deltas", () => {
    expect(
      computeUnitPriceZar(3800, [{ priceDeltaZar: 1200 }, { priceDeltaZar: 800 }])
    ).toBe(5800);
  });

  it("handles zero-cost modifications (e.g. decaf)", () => {
    expect(computeUnitPriceZar(3800, [{ priceDeltaZar: 0 }])).toBe(3800);
  });
});

describe("pricing: line total", () => {
  it("multiplies unit price by quantity", () => {
    expect(
      computeLineTotalZar({ unitPriceZar: 3800, quantity: 2, modifications: [] })
    ).toBe(7600);
  });

  it("applies mods per unit, then multiplies", () => {
    // (3800 + 1200) × 3 = 15000
    expect(
      computeLineTotalZar({
        unitPriceZar: 3800,
        quantity: 3,
        modifications: [{ priceDeltaZar: 1200 }],
      })
    ).toBe(15000);
  });
});

describe("pricing: order total", () => {
  it("sums all lines", () => {
    // Cappuccino + Extra Shot (5000) + Croissant (3500) = 8500
    const total = computeOrderTotalZar([
      { unitPriceZar: 3800, quantity: 1, modifications: [{ priceDeltaZar: 1200 }] },
      { unitPriceZar: 3500, quantity: 1, modifications: [] },
    ]);
    expect(total).toBe(8500);
  });

  it("is zero for an empty order", () => {
    expect(computeOrderTotalZar([])).toBe(0);
  });

  it("always returns an integer (cents)", () => {
    const total = computeOrderTotalZar([
      { unitPriceZar: 2500, quantity: 4, modifications: [{ priceDeltaZar: 800 }] },
    ]);
    expect(Number.isInteger(total)).toBe(true);
  });
});
