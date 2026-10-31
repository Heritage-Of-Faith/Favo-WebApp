// Sliding-window attempt counters and cooldowns used by PRD §9.5.3 limits
// (replaces rate-limit-failure-budget.test.ts — CHANGED: those helpers are gone).
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  clearAttempts,
  cooldownSecsLeft,
  countRecent,
  noteAttempt,
  startCooldown,
  _resetAttemptsForTest,
} from "@/server/auth/attempts";

beforeEach(() => {
  _resetAttemptsForTest();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(Date.parse("2026-10-25T08:00:00+02:00"));
});
afterEach(() => vi.useRealTimers());

describe("countRecent / noteAttempt", () => {
  it("counts only events inside the sliding window", () => {
    noteAttempt("k", 60_000);
    vi.advanceTimersByTime(30_000);
    noteAttempt("k", 60_000);
    expect(countRecent("k", 60_000)).toBe(2);
    vi.advanceTimersByTime(30_000);
    expect(countRecent("k", 60_000)).toBe(1);
    clearAttempts("k");
    expect(countRecent("k", 60_000)).toBe(0);
  });
});

describe("cooldowns", () => {
  it("reports seconds left, then 0 once over", () => {
    expect(cooldownSecsLeft("c")).toBe(0);
    startCooldown("c", 5 * 60_000);
    expect(cooldownSecsLeft("c")).toBe(300);
    vi.advanceTimersByTime(5 * 60_000);
    expect(cooldownSecsLeft("c")).toBe(0);
  });
});
