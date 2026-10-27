// SEC-1 — failure budget helpers: checking does not spend, recording does.
import { describe, it, expect, beforeEach, vi } from "vitest";
import { checkFailureBudget, recordFailure, _resetStoreForTest } from "@/server/rate-limit";

beforeEach(() => {
  _resetStoreForTest();
  vi.useRealTimers();
});

describe("checkFailureBudget / recordFailure", () => {
  it("checking alone never locks", () => {
    for (let i = 0; i < 50; i++) expect(checkFailureBudget("k", 3).allowed).toBe(true);
  });

  it("locks once the limit of failures is recorded, with a retry time", () => {
    recordFailure("k", 60_000);
    recordFailure("k", 60_000);
    expect(checkFailureBudget("k", 3).allowed).toBe(true);
    recordFailure("k", 60_000);
    const r = checkFailureBudget("k", 3);
    expect(r.allowed).toBe(false);
    if (!r.allowed) expect(r.retryAfterSecs).toBeGreaterThanOrEqual(1);
  });

  it("unlocks when the window from the first failure ends", () => {
    vi.useFakeTimers();
    const t0 = Date.now();
    vi.setSystemTime(t0);
    for (let i = 0; i < 3; i++) recordFailure("k", 60_000);
    expect(checkFailureBudget("k", 3).allowed).toBe(false);
    vi.setSystemTime(t0 + 60_000);
    expect(checkFailureBudget("k", 3).allowed).toBe(true);
  });
});
