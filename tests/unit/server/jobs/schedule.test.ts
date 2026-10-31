// AT-169 — SAST wall-clock helpers and the cron subset used by the scheduler.

import { describe, it, expect } from "vitest";
import { fireTimesBetween, parseCron, sastDate, sastMiddayDaysBack, sastMinute } from "@/server/jobs/schedule";

describe("SAST helpers", () => {
  it("22:30 UTC is already the next SAST day", () => {
    expect(sastDate(new Date("2026-10-20T22:30:00Z"))).toBe("2026-10-21");
    expect(sastMinute(new Date("2026-10-20T22:30:00Z"))).toBe("2026-10-21T00:30");
  });

  it("sastMiddayDaysBack lands at 12:00 SAST on the right day", () => {
    const d = sastMiddayDaysBack(new Date("2026-10-20T22:05:00Z"), 1); // 00:05 SAST on the 21st
    expect(d.toISOString()).toBe("2026-10-20T10:00:00.000Z");
  });
});

describe("parseCron", () => {
  it("supports *, */n, single values and lists", () => {
    const m = parseCron("0,30 6 * * 1");
    expect(m(new Date("2026-10-19T04:00:00Z"))).toBe(true); // Mon 06:00 SAST
    expect(m(new Date("2026-10-19T04:30:00Z"))).toBe(true);
    expect(m(new Date("2026-10-20T04:00:00Z"))).toBe(false); // Tuesday
  });

  it("rejects anything outside the supported subset", () => {
    expect(() => parseCron("* * * *")).toThrow();
    expect(() => parseCron("1-5 * * * *")).toThrow(/Unsupported/);
    expect(() => parseCron("60 * * * *")).toThrow(/outside/);
    expect(() => parseCron("*/0 * * * *")).toThrow();
  });
});

describe("fireTimesBetween", () => {
  it("is exclusive of the start and inclusive of the end, oldest first", () => {
    const times = fireTimesBetween(
      parseCron("*/15 * * * *"),
      new Date("2026-10-20T08:00:00Z"),
      new Date("2026-10-20T08:30:00Z"),
    ).map((d) => d.toISOString());
    expect(times).toEqual(["2026-10-20T08:15:00.000Z", "2026-10-20T08:30:00.000Z"]);
  });
});
