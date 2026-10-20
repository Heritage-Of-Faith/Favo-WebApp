// AT-169 / AT-193 / AT-194 — the job register as code: times and periods
// signed off for §9.6.2.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/server/crons/check-low-stock", () => ({ checkLowStock: vi.fn(async () => ({})) }));
vi.mock("@/server/crons/close-daily", () => ({
  closeDaily: vi.fn(async () => ({})),
  closedDays: vi.fn(async (days: string[]) => new Set(days.filter((d) => d === "2026-10-19"))),
}));
vi.mock("@/server/crons/collected-sweep", () => ({ sweepCollected: vi.fn(async () => ({})) }));
vi.mock("@/server/jobs/close-watch", () => ({ checkMissingCloses: vi.fn(async () => ({})) }));
vi.mock("@/server/crons/generate-weekly-pnl", async (orig) => ({
  ...(await orig<typeof import("@/server/crons/generate-weekly-pnl")>()),
  generateWeeklyPnL: vi.fn(async () => ({})),
}));

import { JOBS } from "@/server/jobs/registry";
import { parseCron, sastDate } from "@/server/jobs/schedule";
import { closeDaily } from "@/server/crons/close-daily";
import { sweepCollected } from "@/server/crons/collected-sweep";
import { checkMissingCloses } from "@/server/jobs/close-watch";
import { generateWeeklyPnL, weekBounds } from "@/server/crons/generate-weekly-pnl";

const byName = (n: string) => {
  const j = JOBS.find((x) => x.name === n);
  if (!j) throw new Error(`no job ${n}`);
  return j;
};

beforeEach(() => vi.clearAllMocks());

describe("job register", () => {
  it("wires exactly the jobs signed off for AT-169, AT-193 and AT-194", () => {
    expect(JOBS.map((j) => j.name)).toEqual([
      "checkLowStock", "closeDaily", "closeDailyWatch", "generateWeeklyPnL", "collectedSweep",
    ]);
  });

  it("checkLowStock: every 15 minutes, skipped when missed", () => {
    const j = byName("checkLowStock");
    const m = parseCron(j.cron);
    expect(m(new Date("2026-10-20T08:00:00Z"))).toBe(true);
    expect(m(new Date("2026-10-20T08:45:00Z"))).toBe(true);
    expect(m(new Date("2026-10-20T08:20:00Z"))).toBe(false);
    expect(j.missedRun).toBe("skip");
  });

  it("closeDaily: 00:05 SAST — not 23:55 or 23:59 — and closes the completed day", async () => {
    const j = byName("closeDaily");
    const m = parseCron(j.cron);
    const firedAt = new Date("2026-10-20T22:05:00Z"); // 00:05 SAST, Wed 21 Oct
    expect(m(firedAt)).toBe(true);
    expect(m(new Date("2026-10-20T21:59:00Z"))).toBe(false); // 23:59 SAST
    expect(j.periodFor(firedAt)).toBe("2026-10-20");
    await j.run(firedAt, false);
    expect(sastDate(vi.mocked(closeDaily).mock.calls[0][0]!)).toBe("2026-10-20");
    expect(vi.mocked(closeDaily).mock.calls[0][1]).toEqual({ wasCatchUp: false });
  });

  it("closeDaily: caught up on startup, done = the day has a close record (AT-193)", async () => {
    const j = byName("closeDaily");
    expect(j.missedRun).toBe("catchUp");
    expect(await j.isDone!("2026-10-19")).toBe(true);
    expect(await j.isDone!("2026-10-18")).toBe(false);
    await j.run(new Date("2026-10-19T22:05:00Z"), true);
    expect(vi.mocked(closeDaily).mock.calls[0][1]).toEqual({ wasCatchUp: true });
  });

  it("closeDailyWatch: 06:00 SAST every day, skipped when missed (AT-193)", async () => {
    const j = byName("closeDailyWatch");
    const m = parseCron(j.cron);
    const firedAt = new Date("2026-10-21T04:00:00Z"); // 06:00 SAST
    expect(m(firedAt)).toBe(true);
    expect(m(new Date("2026-10-21T04:05:00Z"))).toBe(false);
    expect(j.missedRun).toBe("skip");
    expect(j.periodFor(firedAt)).toBe("2026-10-21");
    await j.run(firedAt, false);
    expect(checkMissingCloses).toHaveBeenCalledWith(firedAt);
  });

  it("collectedSweep: every 5 minutes, skipped when missed (AT-194, §9.6.2 #5)", async () => {
    const j = byName("collectedSweep");
    const m = parseCron(j.cron);
    expect(m(new Date("2026-10-20T08:05:00Z"))).toBe(true);
    expect(m(new Date("2026-10-20T08:10:00Z"))).toBe(true);
    expect(m(new Date("2026-10-20T08:07:00Z"))).toBe(false);
    expect(j.missedRun).toBe("skip");
    const firedAt = new Date("2026-10-20T08:05:00Z");
    expect(j.periodFor(firedAt)).toBe("2026-10-20T10:05");
    await j.run(firedAt, false);
    expect(sweepCollected).toHaveBeenCalledWith(firedAt);
  });

  it("generateWeeklyPnL: Monday 06:00 SAST, for the completed Mon–Sun week, caught up on startup", async () => {
    const j = byName("generateWeeklyPnL");
    const m = parseCron(j.cron);
    const firedAt = new Date("2026-10-19T04:00:00Z"); // Mon 19 Oct 06:00 SAST
    expect(m(firedAt)).toBe(true);
    expect(m(new Date("2026-10-18T21:59:00Z"))).toBe(false); // Sun 23:59 SAST
    expect(j.periodFor(firedAt)).toBe("2026-10-12");
    expect(j.missedRun).toBe("catchUp");
    await j.run(firedAt, false);
    expect(weekBounds(vi.mocked(generateWeeklyPnL).mock.calls[0][0]).weekStarting).toBe("2026-10-12");
  });
});
