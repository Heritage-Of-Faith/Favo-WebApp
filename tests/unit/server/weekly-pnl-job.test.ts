// AT-206 — PRD §9.6.2 job 3 (generateWeeklyPnL, Monday 06:00), §7.3, REQ-123.
//   * "Given a completed week · When Monday 06:00 passes · Then the three
//     baristas and the Admin receive a push" — the run reports the week that
//     has just ENDED, never the week that has just begun.
//   * "Admin push carries 'for week ending …'" — a late (catch-up) report
//     goes to the Admin only, still naming its week.
//   * Idempotent per week: a re-run writes nothing and pushes nobody.
//   * Rule (3): a failure is raised for the scheduler, which audits it and
//     sends the one Admin failure push (tested with the scheduler, not here).
// The catch-up loop and the per-run audit row are the scheduler's
// (src/server/jobs/scheduler.ts), not this handler's.
// db and web-push are mocked.

import { describe, it, expect, vi, beforeEach } from "vitest";

const sent: { endpoint: string; payload: Record<string, unknown> }[] = [];
const generated: string[] = [];
const state = {
  existingWeeks: new Set<string>(),
  failOn: null as string | null,
};

const SUB = (id: string) => ({ endpoint: `https://push.example/${id}`, keys: { p256dh: "p", auth: "a" } });
const STAFF = [
  { id: "louis", role: "barista", push_subscription: SUB("louis") },
  { id: "thandeka", role: "barista", push_subscription: SUB("thandeka") },
  { id: "nkuli", role: "barista", push_subscription: SUB("nkuli") },
  { id: "admin", role: "admin", push_subscription: SUB("admin") },
];

vi.mock("web-push", () => ({
  default: {
    sendNotification: vi.fn().mockImplementation(async (sub: { endpoint: string }, payload: string) => {
      sent.push({ endpoint: sub.endpoint, payload: JSON.parse(payload) });
    }),
  },
}));
vi.mock("@/server/push/vapid", () => ({ initVapid: vi.fn() }));

vi.mock("@/server/crons/generate-weekly-pnl", async (orig) => {
  const real = await orig<typeof import("@/server/crons/generate-weekly-pnl")>();
  return {
    ...real,
    generateWeeklyPnL: vi.fn().mockImplementation(async (ref: Date) => {
      const { weekStarting } = real.weekBounds(ref);
      if (state.failOn === weekStarting) throw new Error("boom");
      if (state.existingWeeks.has(weekStarting)) return { weekStarting, reportId: `wr_${weekStarting}`, alreadyExists: true };
      state.existingWeeks.add(weekStarting);
      generated.push(weekStarting);
      return { weekStarting, reportId: `wr_${weekStarting}`, alreadyExists: false };
    }),
  };
});

vi.mock("@db/index", async () => {
  const { PgDialect } = await import("drizzle-orm/pg-core");
  const dialect = new PgDialect();
  return {
    db: {
      execute: vi.fn().mockImplementation(async (q: Parameters<typeof dialect.sqlToQuery>[0]) => {
        const text = dialect.sqlToQuery(q).sql;
        if (text.includes("FROM staff")) {
          const adminOnly = text.includes("'admin'");
          return STAFF.filter((s) => !adminOnly || s.role === "admin");
        }
        throw new Error(`unexpected query: ${text}`);
      }),
    },
  };
});

// Monday 17 Aug 2026, 06:00 SAST — the week Mon 10 .. Sun 16 Aug has just ended.
const MONDAY_0600 = new Date("2026-08-17T06:00:00+02:00");

describe("lastCompleteWeek — the week a Monday 06:00 run reports", () => {
  it("Monday 06:00 → the week Mon 10 Aug .. Sun 16 Aug, not the week just begun", async () => {
    const { lastCompleteWeek } = await import("@/server/crons/generate-weekly-pnl");
    expect(lastCompleteWeek(MONDAY_0600)).toEqual({ weekStarting: "2026-08-10", weekEnding: "2026-08-16" });
  });

  it("Sunday 23:00 SAST → the week before (the current Sunday's week is not complete)", async () => {
    const { lastCompleteWeek } = await import("@/server/crons/generate-weekly-pnl");
    expect(lastCompleteWeek(new Date("2026-08-16T23:00:00+02:00"))).toEqual({
      weekStarting: "2026-08-03",
      weekEnding: "2026-08-09",
    });
  });

  it("Monday 00:30 SAST (Sunday 22:30 UTC) → the week that ended at midnight SAST", async () => {
    const { lastCompleteWeek } = await import("@/server/crons/generate-weekly-pnl");
    expect(lastCompleteWeek(new Date("2026-08-16T22:30:00Z"))).toEqual({
      weekStarting: "2026-08-10",
      weekEnding: "2026-08-16",
    });
  });
});

describe("runWeeklyPnLJob — job 3's handler, as the scheduler calls it", () => {
  beforeEach(() => {
    sent.length = 0;
    generated.length = 0;
    state.existingWeeks = new Set();
    state.failOn = null;
  });

  it("the Monday 06:00 run, through the register, generates the completed week and pushes the three baristas and the Admin, 'for week ending' 16 Aug", async () => {
    const { JOBS } = await import("@/server/jobs/registry");
    const job = JOBS.find((j) => j.name === "generateWeeklyPnL")!;
    const r = await job.run(MONDAY_0600, false);
    expect(generated).toEqual(["2026-08-10"]);
    expect(r).toMatchObject({ weekStarting: "2026-08-10", weekEnding: "2026-08-16", alreadyExists: false });
    expect(sent.map((s) => s.endpoint).sort()).toEqual(
      ["admin", "louis", "nkuli", "thandeka"].map((id) => `https://push.example/${id}`)
    );
    for (const s of sent) {
      expect(String(s.payload.body)).toContain("for week ending");
      expect(String(s.payload.body)).toContain("16 Aug 2026");
      expect(s.payload.data).toMatchObject({ url: "/pos/weekly?week=2026-08-10" });
    }
  });

  it("a late (startup catch-up) run tells the Admin only, naming the week it covers", async () => {
    const { JOBS } = await import("@/server/jobs/registry");
    const job = JOBS.find((j) => j.name === "generateWeeklyPnL")!;
    await job.run(MONDAY_0600, true);
    expect(generated).toEqual(["2026-08-10"]);
    expect(sent).toHaveLength(1);
    expect(sent[0].endpoint).toBe("https://push.example/admin");
    expect(String(sent[0].payload.body)).toContain("for week ending 16 Aug 2026");
  });

  it("is idempotent per week: a second run creates no report and pushes nobody", async () => {
    const { runWeeklyPnLJob } = await import("@/server/crons/weekly-pnl-job");
    const ref = new Date("2026-08-10T12:00:00+02:00");
    await runWeeklyPnLJob(ref, false, MONDAY_0600);
    sent.length = 0;
    const r = await runWeeklyPnLJob(ref, false, MONDAY_0600);
    expect(r.alreadyExists).toBe(true);
    expect(generated).toEqual(["2026-08-10"]);
    expect(sent).toEqual([]);
  });

  it("rule (3): a failure is raised for the scheduler, and the handler itself pushes nobody", async () => {
    state.failOn = "2026-08-10";
    const { runWeeklyPnLJob } = await import("@/server/crons/weekly-pnl-job");
    await expect(runWeeklyPnLJob(new Date("2026-08-10T12:00:00+02:00"), false, MONDAY_0600)).rejects.toThrow("boom");
    expect(sent).toEqual([]);
  });
});

describe("generateWeeklyPnL — never freezes a week that has not ended", () => {
  it("refuses the week still in progress", async () => {
    const real = await vi.importActual<typeof import("@/server/crons/generate-weekly-pnl")>(
      "@/server/crons/generate-weekly-pnl"
    );
    await expect(real.generateWeeklyPnL(new Date("2026-08-14T12:00:00+02:00"), new Date("2026-08-16T23:59:00+02:00"))).rejects.toThrow(
      "WEEK_NOT_COMPLETE"
    );
  });
});
