// Unit tests for N8 status helpers: variance bands (T01) + freshness (T02).

import { describe, it, expect } from "vitest";
import { varianceBand, varianceBandLabel } from "@/lib/status/variance-band";
import { freshness, daysSinceRoast, freshnessLabel } from "@/lib/status/freshness";
import { varianceBand as serverVarianceBand } from "@/server/inventory/variance";

describe("varianceBand (T01)", () => {
  it("classifies within tolerance below 5%", () => {
    expect(varianceBand(0)).toBe("ok");
    expect(varianceBand(4.99)).toBe("ok");
  });

  it("classifies investigate at the 5% boundary up to 10%", () => {
    expect(varianceBand(5)).toBe("investigate");
    expect(varianceBand(5.01)).toBe("investigate");
    expect(varianceBand(9.99)).toBe("investigate");
  });

  it("classifies critical at 10% and above", () => {
    expect(varianceBand(10)).toBe("critical");
    expect(varianceBand(50)).toBe("critical");
  });

  it("treats variance as absolute (negative input)", () => {
    expect(varianceBand(-12)).toBe("critical");
    expect(varianceBand(-3)).toBe("ok");
  });

  it("server module re-exports the same implementation", () => {
    expect(serverVarianceBand).toBe(varianceBand);
  });

  it("provides human labels", () => {
    expect(varianceBandLabel("ok")).toMatch(/tolerance/i);
    expect(varianceBandLabel("critical")).toBe("Critical");
  });
});

describe("freshness (T02)", () => {
  const roast = new Date("2026-06-01T08:00:00+02:00");

  it("is fresh within 7 days", () => {
    expect(freshness(roast, new Date("2026-06-01T09:00:00+02:00"))).toBe("fresh");
    expect(freshness(roast, new Date("2026-06-08T08:00:00+02:00"))).toBe("fresh");
  });

  it("is ageing between 8 and 14 days", () => {
    expect(freshness(roast, new Date("2026-06-09T08:00:00+02:00"))).toBe("ageing");
    expect(freshness(roast, new Date("2026-06-15T08:00:00+02:00"))).toBe("ageing"); // 14 days
  });

  it("is stale at 15 days and beyond (warning fires)", () => {
    expect(freshness(roast, new Date("2026-06-16T08:00:00+02:00"))).toBe("stale"); // 15 days
    expect(freshness(roast, new Date("2026-07-01T08:00:00+02:00"))).toBe("stale");
  });

  it("clamps future roast dates to 0 days", () => {
    expect(daysSinceRoast(roast, new Date("2026-05-30T08:00:00+02:00"))).toBe(0);
    expect(freshness(roast, new Date("2026-05-30T08:00:00+02:00"))).toBe("fresh");
  });

  it("handles invalid date strings gracefully", () => {
    expect(daysSinceRoast("not-a-date")).toBe(0);
  });

  it("provides human labels", () => {
    expect(freshnessLabel("fresh")).toBe("Fresh");
    expect(freshnessLabel("stale")).toMatch(/peak/i);
  });
});
