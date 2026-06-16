import { describe, it, expect } from "vitest";
import { computeItemAvailability } from "@/lib/menu-availability";

describe("computeItemAvailability", () => {
  it("is available when the item has no required ingredients (tea/food)", () => {
    expect(computeItemAvailability(new Map(), [])).toBe(true);
  });

  it("is available when every required ingredient has net stock > 0", () => {
    const stocks = new Map([
      ["beans", 500],
      ["milk", 200],
    ]);
    expect(computeItemAvailability(stocks, ["beans", "milk"])).toBe(true);
  });

  it("is unavailable when any required ingredient is at zero", () => {
    const stocks = new Map([
      ["beans", 500],
      ["milk", 0],
    ]);
    expect(computeItemAvailability(stocks, ["beans", "milk"])).toBe(false);
  });

  it("treats a missing ingredient as zero stock", () => {
    const stocks = new Map([["beans", 500]]);
    expect(computeItemAvailability(stocks, ["beans", "milk"])).toBe(false);
  });
});
