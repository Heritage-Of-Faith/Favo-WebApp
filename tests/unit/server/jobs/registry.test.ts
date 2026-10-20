// AT-169 — the job register as code: times and periods signed off for §9.6.2.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/server/crons/check-low-stock", () => ({ checkLowStock: vi.fn(async () => ({})) }));
vi.mock("@/server/crons/close-daily", () => ({ closeDaily: vi.fn(async () => ({})) }));
vi.mock("@/server/crons/generate-weekly-pnl", async (orig) => ({
  ...(await orig<typeof import("@/server/crons/generate-weekly-pnl")>()),
  generateWeeklyPnL: vi.fn(async () => ({})),
}));

import { JOBS } from "@/server/jobs/registry";
import { parseCron, sastDate } from "@/server/jobs/schedule";
import { closeDaily } from "@/server/crons/close-daily";
import { generateWeeklyPnL, weekBounds } from "@/server/crons/generate-weekly-pnl";

const byName = (n: string) => {
  const j = JOBS.find((x) => x.name === n);
  if (!j) throw new Error(`no job ${n}`);
  return j;
};

beforeEach(() => vi.clearAllMocks());

describe("job register", () => {
  it("wires exactly the three jobs signed off for AT-169", () => {
    expect(JOBS.map((j) => j.name)).toEqual(["checkLowStock", "closeDaily", "generateWeeklyPnL"]);
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
    await j.run(firedAt);
    expect(sastDate(vi.mocked(closeDaily).mock.calls[0][0]!)).toBe("2026-10-20");
  });

  it("generateWeeklyPnL: Monday 06:00 SAST, for the completed Mon–Sun week, caught up on startup", async () => {
    const j = byName("generateWeeklyPnL");
    const m = parseCron(j.cron);
    const firedAt = new Date("2026-10-19T04:00:00Z"); // Mon 19 Oct 06:00 SAST
    expect(m(firedAt)).toBe(true);
    expect(m(new Date("2026-10-18T21:59:00Z"))).toBe(false); // Sun 23:59 SAST
    expect(j.periodFor(firedAt)).toBe("2026-10-12");
    expect(j.missedRun).toBe("catchUp");
    await j.run(firedAt);
    expect(weekBounds(vi.mocked(generateWeeklyPnL).mock.calls[0][0]).weekStarting).toBe("2026-10-12");
  });
});
