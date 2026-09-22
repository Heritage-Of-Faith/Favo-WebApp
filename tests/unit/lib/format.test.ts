import { describe, it, expect } from "vitest";
import { formatZar, formatDate, revenueDay, formatZarField, pnlColor } from "@/lib/format";

describe("formatZar", () => {
  it("formats whole rands correctly", () => {
    expect(formatZar(1000)).toContain("10");
  });

  it("formats cents correctly", () => {
    expect(formatZar(1250)).toContain("12");
    expect(formatZar(1250)).toContain("50");
  });

  it("formats zero", () => {
    expect(formatZar(0)).toContain("0");
  });

  it("always includes R prefix", () => {
    expect(formatZar(500)).toMatch(/R/);
  });

  it("formats large amounts", () => {
    const result = formatZar(100000);
    expect(result).toContain("1");
    expect(result).toContain("000");
  });
});

describe("formatDate", () => {
  it("returns a non-empty string for a valid date", () => {
    const result = formatDate(new Date("2026-05-29T08:00:00Z"), "Africa/Johannesburg");
    expect(result).toBeTruthy();
    expect(typeof result).toBe("string");
  });

  it("accepts a string date", () => {
    const result = formatDate("2026-05-29T08:00:00Z");
    expect(result).toBeTruthy();
  });
});

describe("revenueDay", () => {
  it("returns a YYYY-MM-DD string", () => {
    const result = revenueDay(new Date("2026-05-29T08:00:00Z"));
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

// Rehomed from tests/unit/server/crons.test.ts when formatZarField/pnlColor
// moved out of the (now-deleted) Discord webhook helper into this module.
describe("formatZarField", () => {
  it("100000 cents → R 1 000,00 (ZA locale)", () => {
    // ZA locale uses comma as decimal separator, space as thousands separator
    const result = formatZarField(100000);
    expect(result).toContain("1");
    expect(result).toContain("000");
    expect(result.startsWith("R ")).toBe(true);
  });

  it("0 cents → R 0,00", () => {
    const result = formatZarField(0);
    expect(result.startsWith("R ")).toBe(true);
    expect(result).toContain("0");
  });

  it("3800 cents → R 38,00", () => {
    const result = formatZarField(3800);
    expect(result).toContain("38");
    expect(result.startsWith("R ")).toBe(true);
  });

  it("negative cents → negative formatted string", () => {
    const result = formatZarField(-50000);
    expect(result).toContain("-");
  });
});

describe("pnlColor", () => {
  it("positive net → green (0x2ecc71)", () => {
    expect(pnlColor(1000)).toBe(0x2ecc71);
  });

  it("zero net → green (break-even treated as ok)", () => {
    expect(pnlColor(0)).toBe(0x2ecc71);
  });

  it("negative net → red (0xe74c3c)", () => {
    expect(pnlColor(-1)).toBe(0xe74c3c);
  });
});
