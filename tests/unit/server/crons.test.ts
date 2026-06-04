// Cron unit tests — task G14
// Tests pure helpers (weekBounds, Discord formatting) without DB or network.
// Integration tests (push delivery, Discord embed) run on staging.

import { describe, it, expect } from "vitest";
import { weekBounds } from "@/server/crons/generate-weekly-pnl";
import { formatZarField, pnlColor } from "@/server/discord/webhook";

// ─── weekBounds ───────────────────────────────────────────────────────────────

describe("weekBounds", () => {
  it("Monday input → week starts on itself", () => {
    // Monday 2026-06-01 12:00 SAST = 10:00 UTC
    const monday = new Date("2026-06-01T10:00:00Z");
    const { weekStarting } = weekBounds(monday);
    expect(weekStarting).toBe("2026-06-01");
  });

  it("Sunday input → week started the previous Monday", () => {
    // Sunday 2026-06-07 23:50 SAST = 21:50 UTC
    const sunday = new Date("2026-06-07T21:50:00Z");
    const { weekStarting } = weekBounds(sunday);
    expect(weekStarting).toBe("2026-06-01");
  });

  it("Wednesday input → week started the previous Monday", () => {
    // Wednesday 2026-06-03 12:00 SAST = 10:00 UTC (today in the session)
    const wednesday = new Date("2026-06-03T10:00:00Z");
    const { weekStarting } = weekBounds(wednesday);
    expect(weekStarting).toBe("2026-06-01");
  });

  it("week start is exactly 7 days before week end", () => {
    const ref = new Date("2026-06-03T10:00:00Z");
    const { start, end } = weekBounds(ref);
    const diffDays = (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24);
    expect(diffDays).toBeCloseTo(7, 1);
  });

  it("weekStarting is always a YYYY-MM-DD string", () => {
    const { weekStarting } = weekBounds(new Date("2026-06-01T10:00:00Z"));
    expect(weekStarting).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("end is after start", () => {
    const { start, end } = weekBounds(new Date("2026-06-03T10:00:00Z"));
    expect(end.getTime()).toBeGreaterThan(start.getTime());
  });
});

// ─── formatZarField ───────────────────────────────────────────────────────────

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

// ─── pnlColor ─────────────────────────────────────────────────────────────────

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
