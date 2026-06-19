// Unit tests for the in-process rate limiter (src/server/rate-limit.ts)

import { describe, it, expect, beforeEach, vi } from "vitest";
import { checkRateLimit, _resetStoreForTest } from "@/server/rate-limit";

beforeEach(() => {
  _resetStoreForTest();
  vi.useRealTimers();
});

describe("checkRateLimit — basic sliding window", () => {
  it("allows the first request", () => {
    const result = checkRateLimit("test:1.2.3.4", 5, 60_000);
    expect(result.allowed).toBe(true);
  });

  it("allows up to the limit", () => {
    for (let i = 0; i < 5; i++) {
      const r = checkRateLimit("test:1.2.3.4", 5, 60_000);
      expect(r.allowed).toBe(true);
    }
  });

  it("blocks on the attempt after the limit", () => {
    for (let i = 0; i < 5; i++) checkRateLimit("test:1.2.3.4", 5, 60_000);
    const result = checkRateLimit("test:1.2.3.4", 5, 60_000);
    expect(result.allowed).toBe(false);
  });

  it("blocked result includes retryAfterSecs >= 1", () => {
    for (let i = 0; i <= 5; i++) checkRateLimit("test:1.2.3.4", 5, 60_000);
    const result = checkRateLimit("test:1.2.3.4", 5, 60_000);
    if (!result.allowed) expect(result.retryAfterSecs).toBeGreaterThanOrEqual(1);
  });

  it("uses separate buckets for different keys", () => {
    for (let i = 0; i < 5; i++) checkRateLimit("login:1.1.1.1", 5, 60_000);
    const blocked = checkRateLimit("login:1.1.1.1", 5, 60_000);
    const different = checkRateLimit("login:2.2.2.2", 5, 60_000);
    expect(blocked.allowed).toBe(false);
    expect(different.allowed).toBe(true);
  });
});

describe("checkRateLimit — window expiry", () => {
  it("resets the window after windowMs elapses", () => {
    vi.useFakeTimers();
    const now = Date.now();
    vi.setSystemTime(now);

    for (let i = 0; i <= 5; i++) checkRateLimit("test:1.2.3.4", 5, 60_000);
    expect(checkRateLimit("test:1.2.3.4", 5, 60_000).allowed).toBe(false);

    // Advance past the window
    vi.setSystemTime(now + 60_001);
    expect(checkRateLimit("test:1.2.3.4", 5, 60_000).allowed).toBe(true);
  });
});

describe("checkRateLimit — auth limits (5/min, 3/hr for reset)", () => {
  it("enforces 5 attempts per 60s for login key", () => {
    for (let i = 0; i < 5; i++) {
      expect(checkRateLimit("login:10.0.0.1", 5, 60_000).allowed).toBe(true);
    }
    expect(checkRateLimit("login:10.0.0.1", 5, 60_000).allowed).toBe(false);
  });

  it("enforces 3 attempts per hour for reset key", () => {
    for (let i = 0; i < 3; i++) {
      expect(checkRateLimit("reset:user@example.com", 3, 3_600_000).allowed).toBe(true);
    }
    expect(checkRateLimit("reset:user@example.com", 3, 3_600_000).allowed).toBe(false);
  });
});
