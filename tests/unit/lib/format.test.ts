import { describe, it, expect } from "vitest";
import { formatZar, formatDate, revenueDay } from "@/lib/format";

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
