// The job scheduler (AT-169) — server-side timers on one instance, PRD §9.6.2.
//
// A minute-aligned ticker evaluates each registered job's cron expression in
// SAST and runs it in-process. No HTTP hop, no second container: §9.6 says the
// jobs run as "server-side timers, not platform cron functions".
//
// The three rules §9.6.2 applies to every job live here, so no job repeats them:
//   (1) every run, and every catch-up, is an audit_log row (actor_role 'system')
//       naming the period it covered and whether it was late;
//   (2) no job may initiate a payment or create revenue — enforced by
//       scripts/verify-v7.ts over src/server/crons/ and src/server/jobs/;
//   (3) a job that fails raises one Admin push naming the job and the period,
//       and is not retried — the next scheduled run is the retry.
//
// This module holds no DB or push code of its own: the store and the alerter
// are injected, so the timing and catch-up rules are testable without either.

import { fireTimesBetween, floorToMinute, parseCron } from "./schedule";
import type { CronMatcher } from "./schedule";

export type MissedRunPolicy = "skip" | "catchUp";

export type JobDefinition = {
  /** Stable name; the audit entity id is `${name}:${period}`. */
  name: string;
  /** 5-field cron expression evaluated in SAST (see ./schedule.ts). */
  cron: string;
  /** §9.6.2 "Missed-run behaviour". `catchUp` jobs must be idempotent per period. */
  missedRun: MissedRunPolicy;
  /** The period a firing at `firedAt` covers, e.g. the revenue day or ISO week. */
  periodFor(firedAt: Date): string;
  /** `late` is true for a startup catch-up, so a job can record that it ran late. */
  run(firedAt: Date, late: boolean): Promise<unknown>;
  /**
   * For `catchUp` jobs: whether `period` is already done, judged by the job's
   * own durable record rather than by a scheduler run row. A run that failed
   * leaves no record, so the period is caught up at the next startup.
   * Defaults to "a run of this job for this period was audited".
   */
  isDone?(period: string): Promise<boolean>;
};

export type RunAction = "job_run" | "job_catch_up" | "job_failed";

export type RunRecord = {
  job: string;
  period: string;
  action: RunAction;
  scheduledFor: Date;
  startedAt: Date;
  finishedAt: Date;
  late: boolean;
  result?: unknown;
  error?: string;
};

export type JobStore = {
  /** True if any run of `job` for `period` has been recorded (failed runs included). */
  hasRun(job: string, period: string): Promise<boolean>;
  /** When the scheduler first ever started on this database, or null. */
  firstStartedAt(): Promise<Date | null>;
  recordStart(at: Date): Promise<void>;
  recordRun(record: RunRecord): Promise<void>;
};

export type FailureAlerter = (job: string, period: string, error: string) => Promise<void>;

export type SchedulerDeps = {
  store: JobStore;
  alert: FailureAlerter;
  now?: () => Date;
  log?: Pick<Console, "info" | "warn" | "error">;
};

/** How far back startup catch-up looks. Bounded so a long-dead DB cannot trigger a flood. */
export const CATCH_UP_WINDOW_MS = 35 * 24 * 60 * 60 * 1000;
/** If the event loop stalls, at most this many missed minutes are replayed on the next tick. */
const MAX_TICK_REPLAY_MINUTES = 5;

type Compiled = { job: JobDefinition; matches: CronMatcher };

export class Scheduler {
  private readonly jobs: Compiled[];
  private readonly running = new Set<string>();
  private readonly now: () => Date;
  private readonly log: Pick<Console, "info" | "warn" | "error">;
  private lastTick: Date | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(jobs: JobDefinition[], private readonly deps: SchedulerDeps) {
    const names = new Set<string>();
    this.jobs = jobs.map((job) => {
      if (names.has(job.name)) throw new Error(`Duplicate job name "${job.name}"`);
      names.add(job.name);
      return { job, matches: parseCron(job.cron) };
    });
    this.now = deps.now ?? (() => new Date());
    this.log = deps.log ?? console;
  }

  /**
   * Run one job for the firing at `firedAt`. Never throws: a failure is
   * audited and alerted (rule 3). A job already running is skipped rather
   * than overlapped.
   */
  async runJob(job: JobDefinition, firedAt: Date, late = false): Promise<RunRecord | null> {
    const period = job.periodFor(firedAt);
    if (this.running.has(job.name)) {
      this.log.warn(`[scheduler] ${job.name}:${period} skipped — previous run still in progress`);
      return null;
    }
    this.running.add(job.name);
    const startedAt = this.now();
    let record: RunRecord;
    try {
      const result = await job.run(firedAt, late);
      record = {
        job: job.name, period, action: late ? "job_catch_up" : "job_run",
        scheduledFor: firedAt, startedAt, finishedAt: this.now(), late, result,
      };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      record = {
        job: job.name, period, action: "job_failed",
        scheduledFor: firedAt, startedAt, finishedAt: this.now(), late, error,
      };
      this.log.error(`[scheduler] ${job.name}:${period} failed: ${error}`);
      await this.deps.alert(job.name, period, error).catch((e) =>
        this.log.error(`[scheduler] failure alert for ${job.name}:${period} not sent:`, e),
      );
    } finally {
      this.running.delete(job.name);
    }
    await this.deps.store.recordRun(record).catch((e) =>
      this.log.error(`[scheduler] audit row for ${job.name}:${period} not written:`, e),
    );
    return record;
  }

  /**
   * Startup catch-up (§9.6.2): for each `catchUp` job, every period whose
   * firing fell between the scheduler's first-ever start (bounded by
   * CATCH_UP_WINDOW_MS) and now, that is not done (`isDone`, else no recorded
   * run), is run once, oldest first, marked late. `skip` jobs are never
   * caught up. On the very first start there is nothing to catch up — the
   * scheduler was not live before.
   */
  async catchUp(): Promise<RunRecord[]> {
    const now = this.now();
    const firstStart = await this.deps.store.firstStartedAt();
    await this.deps.store.recordStart(now);
    if (!firstStart) return [];

    const from = new Date(Math.max(firstStart.getTime(), now.getTime() - CATCH_UP_WINDOW_MS));
    const done: RunRecord[] = [];
    for (const { job, matches } of this.jobs) {
      if (job.missedRun !== "catchUp") continue;
      done.push(...(await this.runMissed(job, fireTimesBetween(matches, from, now))));
    }
    return done;
  }

  /**
   * Whether `period` is already done, so a catch-up must not repeat it: the
   * job's own `isDone` when it has one (e.g. the day's close record exists),
   * else whether a run for `period` was audited.
   */
  private isPeriodDone(job: JobDefinition, period: string): Promise<boolean> {
    return job.isDone ? job.isDone(period) : this.deps.store.hasRun(job.name, period);
  }

  /**
   * Run missed firings of a `catchUp` job one at a time, oldest first, once per
   * period, skipping periods already done. Sequential on purpose: the overlap
   * guard would otherwise skip every firing after the first, leaving no row.
   */
  private async runMissed(job: JobDefinition, firings: Date[]): Promise<RunRecord[]> {
    const done: RunRecord[] = [];
    const seen = new Set<string>();
    for (const firedAt of firings) {
      const period = job.periodFor(firedAt);
      if (seen.has(period)) continue;
      seen.add(period);
      if (await this.isPeriodDone(job, period)) continue;
      this.log.info(`[scheduler] catching up ${job.name}:${period}`);
      const record = await this.runJob(job, firedAt, true);
      if (record) done.push(record);
    }
    return done;
  }

  /**
   * Handle one tick at time `at`: fire every job whose expression matches a
   * minute since the last tick (replaying at most a few minutes after a stall),
   * never the same minute twice.
   */
  tick(at: Date = this.now()): Promise<unknown> {
    const current = floorToMinute(at);
    if (this.lastTick && current <= this.lastTick) return Promise.resolve();
    const previous = this.lastTick ?? new Date(current.getTime() - 60_000);
    this.lastTick = current;

    // After a long stall, `skip` jobs replay at most a few minutes (their own
    // rule says a missed run is skipped) and the gap is logged; `catchUp` jobs
    // replay every missed firing in the window, since each is idempotent per period.
    const replayFrom = new Date(current.getTime() - MAX_TICK_REPLAY_MINUTES * 60_000);
    const catchUpFrom = new Date(current.getTime() - CATCH_UP_WINDOW_MS);
    if (previous < replayFrom) {
      this.log.warn(`[scheduler] ticks stalled from ${previous.toISOString()} to ${current.toISOString()}; skip-jobs replay only the last ${MAX_TICK_REPLAY_MINUTES} minutes`);
    }

    // Jobs run in parallel with each other; one job's firings run in order.
    const runs: Promise<unknown>[] = [];
    for (const { job, matches } of this.jobs) {
      const floor = job.missedRun === "catchUp" ? catchUpFrom : replayFrom;
      const after = previous > floor ? previous : floor;
      const firings = fireTimesBetween(matches, after, current);
      if (firings.length === 0) continue;
      const missed = firings.filter((t) => t < current);
      const onTime = firings.filter((t) => t.getTime() === current.getTime());
      runs.push((async () => {
        if (job.missedRun === "catchUp") await this.runMissed(job, missed);
        else for (const t of missed) await this.runJob(job, t, true);
        for (const t of onTime) await this.runJob(job, t);
      })());
    }
    return Promise.all(runs);
  }

  /** Catch up, then tick on every minute boundary until stop(). */
  start(): void {
    if (this.timer) return;
    this.lastTick = floorToMinute(this.now());
    void this.catchUp().catch((e) => this.log.error("[scheduler] startup catch-up failed:", e));
    const schedule = () => {
      const ms = 60_000 - (this.now().getTime() % 60_000) + 50;
      this.timer = setTimeout(() => {
        void this.tick();
        schedule();
      }, ms);
      // Do not hold the process open on shutdown.
      this.timer.unref?.();
    };
    schedule();
    this.log.info(`[scheduler] started: ${this.jobs.map(({ job }) => `${job.name} (${job.cron})`).join(", ")}`);
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}
