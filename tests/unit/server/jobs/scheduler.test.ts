// AT-169 — the in-app job scheduler (PRD §9.6.2).
// Pure: the store and alerter are in-memory fakes, time is injected.

import { describe, it, expect, vi } from "vitest";
import { Scheduler, CATCH_UP_WINDOW_MS } from "@/server/jobs/scheduler";
import type { JobDefinition, JobStore, RunRecord } from "@/server/jobs/scheduler";
import { sastMinute } from "@/server/jobs/schedule";

const quiet = { info: () => {}, warn: () => {}, error: () => {} };

function memoryStore(firstStart: Date | null = null) {
  const runs: RunRecord[] = [];
  const starts: Date[] = [];
  const store: JobStore = {
    hasRun: async (job, period) => runs.some((r) => r.job === job && r.period === period),
    firstStartedAt: async () => firstStart,
    recordStart: async (at) => { starts.push(at); },
    recordRun: async (r) => { runs.push(r); },
  };
  return { store, runs, starts };
}

function job(over: Partial<JobDefinition> = {}): JobDefinition {
  return {
    name: "testJob",
    cron: "*/15 * * * *",
    missedRun: "skip",
    periodFor: sastMinute,
    run: vi.fn(async () => ({ ok: true })),
    ...over,
  };
}

// 2026-10-20 10:15 SAST = 08:15 UTC
const T = (iso: string) => new Date(iso);

describe("Scheduler.tick — fires on the SAST schedule", () => {
  it("runs a job whose expression matches the tick minute, and audits it", async () => {
    const { store, runs } = memoryStore();
    const j = job();
    const s = new Scheduler([j], { store, alert: vi.fn(), log: quiet });
    await s.tick(T("2026-10-20T08:15:20Z"));
    expect(j.run).toHaveBeenCalledTimes(1);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ job: "testJob", period: "2026-10-20T10:15", action: "job_run", late: false });
  });

  it("does not run off-schedule, and never fires the same minute twice", async () => {
    const { store } = memoryStore();
    const j = job();
    const s = new Scheduler([j], { store, alert: vi.fn(), log: quiet });
    await s.tick(T("2026-10-20T08:14:00Z"));
    expect(j.run).not.toHaveBeenCalled();
    await s.tick(T("2026-10-20T08:15:00Z"));
    await s.tick(T("2026-10-20T08:15:59Z"));
    expect(j.run).toHaveBeenCalledTimes(1);
  });

  it("replays a minute skipped by a stalled event loop", async () => {
    const { store } = memoryStore();
    const j = job();
    const s = new Scheduler([j], { store, alert: vi.fn(), log: quiet });
    await s.tick(T("2026-10-20T08:14:00Z"));
    await s.tick(T("2026-10-20T08:17:00Z")); // 08:15 and 08:16 never ticked
    expect(j.run).toHaveBeenCalledTimes(1);
    expect(vi.mocked(j.run).mock.calls[0][0].toISOString()).toBe("2026-10-20T08:15:00.000Z");
  });

  it("after a long stall, a skip job replays only the last few minutes but a catchUp job replays its missed firing, marked late", async () => {
    const { store, runs } = memoryStore();
    const skipJob = job({ name: "skipJob" });
    const weekly = job({ name: "weekly", cron: "0 6 * * 1", missedRun: "catchUp", periodFor: (t) => t.toISOString().slice(0, 10) });
    const s = new Scheduler([skipJob, weekly], { store, alert: vi.fn(), log: quiet });
    await s.tick(T("2026-10-19T03:00:00Z")); // Mon 05:00 SAST
    await s.tick(T("2026-10-19T05:02:00Z")); // Mon 07:02 SAST — stalled past 06:00
    expect(weekly.run).toHaveBeenCalledTimes(1);
    expect(runs.find((r) => r.job === "weekly")).toMatchObject({ period: "2026-10-19", action: "job_catch_up", late: true });
    // 03:00 fired on the first tick; 03:15 … 04:45 fell outside the 5-minute replay window, 05:00 did not.
    expect(vi.mocked(skipJob.run).mock.calls.map((c) => (c[0] as Date).toISOString())).toEqual(["2026-10-19T03:00:00.000Z", "2026-10-19T05:00:00.000Z"]);
  });

  it("after a multi-week stall, replays every missed catchUp period in order, each audited, and skips ones already done", async () => {
    const { store, runs } = memoryStore();
    runs.push({ job: "weekly", period: "2026-10-12", action: "job_run", scheduledFor: T("2026-10-12T04:00:00Z"), startedAt: T("2026-10-12T04:00:00Z"), finishedAt: T("2026-10-12T04:00:01Z"), late: false });
    const weekly = job({ name: "weekly", cron: "0 6 * * 1", missedRun: "catchUp", periodFor: (t) => t.toISOString().slice(0, 10) });
    const s = new Scheduler([weekly], { store, alert: vi.fn(), log: quiet });
    await s.tick(T("2026-10-02T08:00:00Z"));
    await s.tick(T("2026-10-20T08:00:00Z")); // missed Mondays 5, 12 (already run) and 19 Oct
    expect(vi.mocked(weekly.run).mock.calls.map((c) => (c[0] as Date).toISOString().slice(0, 10))).toEqual(["2026-10-05", "2026-10-19"]);
    expect(runs.filter((r) => r.action === "job_catch_up").map((r) => r.period)).toEqual(["2026-10-05", "2026-10-19"]);
  });

  it("evaluates the expression in SAST, not UTC (00:05 SAST is 22:05 UTC)", async () => {
    const { store } = memoryStore();
    const j = job({ cron: "5 0 * * *" });
    const s = new Scheduler([j], { store, alert: vi.fn(), log: quiet });
    await s.tick(T("2026-10-20T00:05:00Z")); // 02:05 SAST
    expect(j.run).not.toHaveBeenCalled();
    await s.tick(T("2026-10-20T22:05:00Z")); // 00:05 SAST on the 21st
    expect(j.run).toHaveBeenCalledTimes(1);
  });
});

describe("Scheduler.runJob — failure raises, never retries silently (rule 3)", () => {
  it("audits a failure as job_failed and sends exactly one alert naming job and period", async () => {
    const { store, runs } = memoryStore();
    const alert = vi.fn(async () => {});
    const j = job({ run: vi.fn(async () => { throw new Error("db down"); }) });
    const s = new Scheduler([j], { store, alert, log: quiet });
    await s.tick(T("2026-10-20T08:15:00Z"));
    expect(j.run).toHaveBeenCalledTimes(1);
    expect(alert).toHaveBeenCalledTimes(1);
    expect(alert).toHaveBeenCalledWith("testJob", "2026-10-20T10:15", "db down");
    expect(runs[0]).toMatchObject({ action: "job_failed", error: "db down" });
  });

  it("does not throw when the alert itself fails", async () => {
    const { store, runs } = memoryStore();
    const j = job({ run: async () => { throw new Error("boom"); } });
    const s = new Scheduler([j], { store, alert: async () => { throw new Error("push down"); }, log: quiet });
    await expect(s.runJob(j, T("2026-10-20T08:15:00Z"))).resolves.toMatchObject({ action: "job_failed" });
    expect(runs).toHaveLength(1);
  });

  it("skips a run while the previous one is still in progress (no overlap)", async () => {
    const { store } = memoryStore();
    let release!: () => void;
    const j = job({ run: vi.fn(() => new Promise<void>((r) => { release = r; })) });
    const s = new Scheduler([j], { store, alert: vi.fn(), log: quiet });
    const first = s.runJob(j, T("2026-10-20T08:15:00Z"));
    expect(await s.runJob(j, T("2026-10-20T08:30:00Z"))).toBeNull();
    release();
    await first;
    expect(j.run).toHaveBeenCalledTimes(1);
  });
});

describe("Scheduler.catchUp — startup catch-up per §9.6.2", () => {
  const weekly = (over: Partial<JobDefinition> = {}) =>
    job({ name: "weekly", cron: "0 6 * * 1", missedRun: "catchUp", periodFor: (t) => t.toISOString().slice(0, 10), ...over });

  it("on the very first start records the start and catches nothing up", async () => {
    const { store, starts, runs } = memoryStore(null);
    const j = weekly();
    const s = new Scheduler([j], { store, alert: vi.fn(), log: quiet, now: () => T("2026-10-20T08:00:00Z") });
    expect(await s.catchUp()).toEqual([]);
    expect(starts).toHaveLength(1);
    expect(runs).toHaveLength(0);
  });

  it("runs each missed period once, oldest first, recorded as a late catch-up", async () => {
    // Live since Fri 2 Oct; now Tue 20 Oct. Mondays 06:00 SAST on 5, 12, 19 Oct were due.
    const { store, runs } = memoryStore(T("2026-10-02T08:00:00Z"));
    runs.push({ job: "weekly", period: "2026-10-12", action: "job_run", scheduledFor: T("2026-10-12T04:00:00Z"), startedAt: T("2026-10-12T04:00:00Z"), finishedAt: T("2026-10-12T04:00:01Z"), late: false });
    const j = weekly();
    const s = new Scheduler([j], { store, alert: vi.fn(), log: quiet, now: () => T("2026-10-20T08:00:00Z") });
    const done = await s.catchUp();
    expect(done.map((r) => r.period)).toEqual(["2026-10-05", "2026-10-19"]);
    expect(done.every((r) => r.action === "job_catch_up" && r.late)).toBe(true);
  });

  it("never catches up a skip job", async () => {
    const { store } = memoryStore(T("2026-10-02T08:00:00Z"));
    const j = job({ missedRun: "skip" });
    const s = new Scheduler([j], { store, alert: vi.fn(), log: quiet, now: () => T("2026-10-20T08:00:00Z") });
    await s.catchUp();
    expect(j.run).not.toHaveBeenCalled();
  });

  it("treats a failed run as attempted — catch-up is not a silent retry", async () => {
    const { store, runs } = memoryStore(T("2026-10-10T08:00:00Z"));
    runs.push({ job: "weekly", period: "2026-10-12", action: "job_failed", scheduledFor: T("2026-10-12T04:00:00Z"), startedAt: T("2026-10-12T04:00:00Z"), finishedAt: T("2026-10-12T04:00:01Z"), late: false, error: "x" });
    const j = weekly();
    const s = new Scheduler([j], { store, alert: vi.fn(), log: quiet, now: () => T("2026-10-13T08:00:00Z") });
    expect(await s.catchUp()).toEqual([]);
  });

  it("looks back no further than the catch-up window", async () => {
    const now = T("2026-10-20T08:00:00Z");
    const { store } = memoryStore(T("2025-01-01T00:00:00Z"));
    const j = weekly();
    const s = new Scheduler([j], { store, alert: vi.fn(), log: quiet, now: () => now });
    const done = await s.catchUp();
    const oldest = done[0].scheduledFor.getTime();
    expect(now.getTime() - oldest).toBeLessThanOrEqual(CATCH_UP_WINDOW_MS);
    expect(done).toHaveLength(5);
  });
});

describe("Scheduler construction", () => {
  it("rejects duplicate job names and bad cron expressions", () => {
    expect(() => new Scheduler([job(), job()], { store: memoryStore().store, alert: vi.fn() })).toThrow(/Duplicate/);
    expect(() => new Scheduler([job({ cron: "5 0 * *" })], { store: memoryStore().store, alert: vi.fn() })).toThrow();
  });
});
