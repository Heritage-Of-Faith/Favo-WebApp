// Cron unit tests — task G14
// Tests pure helpers (weekBounds) without DB or network.
// formatZarField/pnlColor moved to tests/unit/lib/format.test.ts when the
// Discord integration they used to live under (src/server/discord/webhook.ts)
// was deleted — the functions themselves were rehomed to src/lib/format.ts.

import { describe, it, expect } from "vitest";
import { weekBounds } from "@/server/crons/generate-weekly-pnl";

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
