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
vi.mock("@/server/crons/unconfirmed-payments", () => ({
  shouldRunUnconfirmedPayments: vi.fn(async () => true),
  reconcileUnconfirmedPayments: vi.fn(async () => ({ due: 0, lookedUp: 0, alerted: 0 })),
}));
// CHANGED (DEC-29): jobs 8–10 mocked like job 4.
vi.mock("@/server/jobs/deferred-reminder", () => ({
  shouldRunDeferredReminder: vi.fn(async () => true),
  runDeferredReminder: vi.fn(async () => ({ reminded: 1 })),
}));
vi.mock("@/server/jobs/import-watch", () => ({
  YOCO_IMPORT_WATCH_JOB: "yocoImportWatch",
  shouldRunImportWatch: vi.fn(async () => true),
  checkMissingImports: vi.fn(async () => ({ checked: 1, missing: [] })),
}));
vi.mock("@/server/jobs/shift-reminder", () => ({
  shouldRunShiftReminder: vi.fn(async () => true),
  runShiftReminders: vi.fn(async () => ({ pushed: [], failed: [] })),
}));
vi.mock("@/server/crons/generate-weekly-pnl", async (orig) => ({
  ...(await orig<typeof import("@/server/crons/generate-weekly-pnl")>()),
  // CHANGED (AT-206): the run now goes through runWeeklyPnLJob, which pushes
  // only for a newly written report; "already exists" keeps this test push-free.
  generateWeeklyPnL: vi.fn(async () => ({ reportId: "wr", alreadyExists: true })),
  hasWeeklyReport: vi.fn(async (weekStarting: string) => weekStarting === "2026-10-12"),
}));

import { JOBS } from "@/server/jobs/registry";
import { parseCron, sastDate } from "@/server/jobs/schedule";
import { closeDaily } from "@/server/crons/close-daily";
import { sweepCollected } from "@/server/crons/collected-sweep";
import { checkMissingCloses } from "@/server/jobs/close-watch";
import { reconcileUnconfirmedPayments, shouldRunUnconfirmedPayments } from "@/server/crons/unconfirmed-payments";
import { generateWeeklyPnL, weekBounds } from "@/server/crons/generate-weekly-pnl";
import { runDeferredReminder, shouldRunDeferredReminder } from "@/server/jobs/deferred-reminder";
import { checkMissingImports, shouldRunImportWatch } from "@/server/jobs/import-watch";
import { runShiftReminders, shouldRunShiftReminder } from "@/server/jobs/shift-reminder";

const byName = (n: string) => {
  const j = JOBS.find((x) => x.name === n);
  if (!j) throw new Error(`no job ${n}`);
  return j;
};

beforeEach(() => vi.clearAllMocks());

describe("job register", () => {
  // CHANGED (job 4): unconfirmedPayments added between jobs 3 and 5.
  // CHANGED (DEC-29): jobs 8–10 appended.
  it("wires exactly the jobs signed off for AT-169, AT-193, AT-194, job 4 and DEC-29's jobs 8–10", () => {
    expect(JOBS.map((j) => j.name)).toEqual([
      "checkLowStock", "closeDaily", "closeDailyWatch", "generateWeeklyPnL", "unconfirmedPayments", "collectedSweep",
      "deferredModeReminder", "yocoImportWatch", "shiftReminder",
    ]);
  });

  it("deferredModeReminder (§9.6.2 #8, REQ-005): every minute, skipped when missed, gated", async () => {
    const j = byName("deferredModeReminder");
    const m = parseCron(j.cron);
    expect(j.cron).toBe("* * * * *");
    expect(m(new Date("2026-11-08T07:31:00Z"))).toBe(true);
    expect(j.missedRun).toBe("skip");
    expect(j.isDone).toBeUndefined();
    const firedAt = new Date("2026-11-08T07:30:00Z"); // Sun 09:30 SAST
    expect(j.periodFor(firedAt)).toBe("2026-11-08T09:30");
    expect(await j.runsAt!(firedAt)).toBe(true);
    expect(shouldRunDeferredReminder).toHaveBeenCalledWith(firedAt);
    await j.run(firedAt, false);
    expect(runDeferredReminder).toHaveBeenCalledWith(firedAt);
  });

  it("yocoImportWatch (§9.6.2 #9, REQ-067): 09:00 SAST daily, skipped when missed, gated, period = the morning", async () => {
    const j = byName("yocoImportWatch");
    const m = parseCron(j.cron);
    const firedAt = new Date("2026-11-10T07:00:00Z"); // Tue 09:00 SAST
    expect(m(firedAt)).toBe(true);
    expect(m(new Date("2026-11-10T09:00:00Z"))).toBe(false); // 11:00 SAST
    expect(m(new Date("2026-11-10T07:01:00Z"))).toBe(false);
    expect(j.missedRun).toBe("skip");
    expect(j.periodFor(firedAt)).toBe("2026-11-10");
    expect(await j.runsAt!(firedAt)).toBe(true);
    expect(shouldRunImportWatch).toHaveBeenCalledWith(firedAt);
    await j.run(firedAt, false);
    expect(checkMissingImports).toHaveBeenCalledWith(firedAt);
  });

  it("shiftReminder (§9.6.2 #10): every minute, skipped when missed, gated", async () => {
    const j = byName("shiftReminder");
    expect(j.cron).toBe("* * * * *");
    expect(j.missedRun).toBe("skip");
    const firedAt = new Date("2026-11-08T04:30:00Z"); // Sun 06:30 SAST
    expect(j.periodFor(firedAt)).toBe("2026-11-08T06:30");
    expect(await j.runsAt!(firedAt)).toBe(true);
    expect(shouldRunShiftReminder).toHaveBeenCalledWith(firedAt);
    await j.run(firedAt, false);
    expect(runShiftReminders).toHaveBeenCalledWith(firedAt);
  });

  it("unconfirmedPayments (§9.6.2 #4): every 15 minutes, skipped when missed, gated by DEC-27", async () => {
    const j = byName("unconfirmedPayments");
    const m = parseCron(j.cron);
    expect(j.cron).toBe("*/15 * * * *");
    expect(m(new Date("2026-11-08T07:00:00Z"))).toBe(true);
    expect(m(new Date("2026-11-08T07:15:00Z"))).toBe(true);
    expect(m(new Date("2026-11-08T07:20:00Z"))).toBe(false);
    expect(j.missedRun).toBe("skip");
    expect(j.isDone).toBeUndefined();
    const firedAt = new Date("2026-11-08T07:15:00Z"); // Sun 8 Nov 09:15 SAST
    expect(j.periodFor(firedAt)).toBe("2026-11-08T09:15");
    expect(await j.runsAt!(firedAt)).toBe(true);
    expect(shouldRunUnconfirmedPayments).toHaveBeenCalledWith(firedAt);
    await j.run(firedAt, false);
    expect(reconcileUnconfirmedPayments).toHaveBeenCalledTimes(1);
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

  it("generateWeeklyPnL: done = the week's weekly_reports row exists, so a failed week is caught up", async () => {
    const j = byName("generateWeeklyPnL");
    expect(await j.isDone!("2026-10-12")).toBe(true);
    expect(await j.isDone!("2026-10-05")).toBe(false);
  });
});
