// AT-206 — PRD §9.6.2 job 3 (generateWeeklyPnL, Monday 06:00), §7.3, REQ-123.
//   * "Given a completed week · When Monday 06:00 passes · Then the three
//     baristas and the Admin receive a push" — the run reports the week that
//     has just ENDED, never the week that has just begun.
//   * "Catch-up on startup, once, for any complete week with no report.
//     Idempotent per (year, week)."
//   * "Admin push carries 'for week ending …'".
//   * Rule (1): a catch-up is recorded as a catch-up — an audit_log row,
//     actor 'system', the fact it was late, and the period it covered.
//   * Rule (3): a job that fails raises — one Admin push naming the job and
//     the period — and never retries silently.
// db, web-push and the audit writer are mocked.

import { describe, it, expect, vi, beforeEach } from "vitest";

const sent: { endpoint: string; payload: Record<string, unknown> }[] = [];
const audits: Record<string, unknown>[] = [];
const generated: string[] = [];
const state = {
  existingWeeks: new Set<string>(),
  firstRevenueDay: null as string | null,
  failOn: null as string | null,
  failSelect: false,
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
vi.mock("@/server/audit", () => ({
  writeAudit: vi.fn().mockImplementation(async (a: Record<string, unknown>) => {
    audits.push(a);
  }),
}));

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
        if (text.includes("FROM weekly_reports")) return [...state.existingWeeks].map((w) => ({ week_starting: w }));
        if (text.includes("MIN(revenue_day)")) {
          if (state.failSelect) throw new Error("db down");
          return [{ first_day: state.firstRevenueDay }];
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

describe("runWeeklyPnLJob — job 3, the scheduled Monday 06:00 run", () => {
  beforeEach(() => {
    sent.length = 0;
    audits.length = 0;
    generated.length = 0;
    state.existingWeeks = new Set();
    state.firstRevenueDay = null;
    state.failOn = null;
  });

  it("generates the completed week and pushes the three baristas and the Admin, 'for week ending' 16 Aug", async () => {
    const { runWeeklyPnLJob } = await import("@/server/crons/weekly-pnl-job");
    const r = await runWeeklyPnLJob(MONDAY_0600);
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
    // The scheduled run is not a catch-up.
    expect(audits).toEqual([]);
  });

  it("is idempotent per week: a second run creates no report and pushes nobody", async () => {
    const { runWeeklyPnLJob } = await import("@/server/crons/weekly-pnl-job");
    await runWeeklyPnLJob(MONDAY_0600);
    sent.length = 0;
    const r = await runWeeklyPnLJob(MONDAY_0600);
    expect(r.alreadyExists).toBe(true);
    expect(generated).toEqual(["2026-08-10"]);
    expect(sent).toEqual([]);
  });

  it("rule (3): a failure raises, and one Admin push names the job and the period", async () => {
    state.failOn = "2026-08-10";
    const { runWeeklyPnLJob } = await import("@/server/crons/weekly-pnl-job");
    await expect(runWeeklyPnLJob(MONDAY_0600)).rejects.toThrow("boom");
    expect(sent).toHaveLength(1);
    expect(sent[0].endpoint).toBe("https://push.example/admin");
    expect(String(sent[0].payload.title)).toContain("generateWeeklyPnL");
    expect(String(sent[0].payload.body)).toContain("for week ending 16 Aug 2026");
  });
});

describe("catchUpWeeklyPnL — job 3's missed-run behaviour", () => {
  beforeEach(() => {
    sent.length = 0;
    audits.length = 0;
    generated.length = 0;
    state.existingWeeks = new Set();
    state.firstRevenueDay = null;
    state.failOn = null;
    state.failSelect = false;
  });

  it("reports every complete week with no report, oldest first, each audited as a late system catch-up", async () => {
    // First order on Wed 29 Jul 2026 (week of Mon 27 Jul). The week of 3 Aug
    // already has a report. Startup on Tue 18 Aug 07:00 SAST: the week of
    // 17 Aug is not complete and is not touched.
    state.firstRevenueDay = "2026-07-29";
    state.existingWeeks = new Set(["2026-08-03"]);
    const { catchUpWeeklyPnL } = await import("@/server/crons/weekly-pnl-job");
    const r = await catchUpWeeklyPnL(new Date("2026-08-18T07:00:00+02:00"));

    expect(generated).toEqual(["2026-07-27", "2026-08-10"]);
    expect(r.map((w) => w.weekStarting)).toEqual(["2026-07-27", "2026-08-10"]);
    expect(audits).toHaveLength(2);
    expect(audits[0]).toMatchObject({
      entityKind: "weekly_report",
      entityId: "wr_2026-07-27",
      action: "weekly_pnl_catch_up",
      actorRole: "system",
      after: { wasCatchUp: true, weekStarting: "2026-07-27", weekEnding: "2026-08-02" },
    });
    expect(audits[1]).toMatchObject({ after: { wasCatchUp: true, weekStarting: "2026-08-10", weekEnding: "2026-08-16" } });

    // ONE push in total, to the Admin only — not one per week to every device.
    expect(sent).toHaveLength(1);
    expect(sent[0].endpoint).toBe("https://push.example/admin");
    expect(String(sent[0].payload.body)).toContain("2 missed weekly reports were created");
    expect(String(sent[0].payload.body)).toContain("for week ending 16 Aug 2026");
  });

  it("one failed week does not stop the rest: later weeks are still created, ONE Admin push names the failure, then it raises", async () => {
    state.firstRevenueDay = "2026-07-29";
    state.failOn = "2026-07-27";
    const { catchUpWeeklyPnL } = await import("@/server/crons/weekly-pnl-job");
    await expect(catchUpWeeklyPnL(new Date("2026-08-18T07:00:00+02:00"))).rejects.toThrow(
      "generateWeeklyPnL catch-up failed for week ending 2 Aug 2026"
    );
    expect(generated).toEqual(["2026-08-03", "2026-08-10"]);
    expect(audits).toHaveLength(2);
    expect(sent).toHaveLength(1);
    expect(sent[0].endpoint).toBe("https://push.example/admin");
    expect(String(sent[0].payload.title)).toContain("generateWeeklyPnL");
    expect(String(sent[0].payload.body)).toContain("2 missed weekly reports were created");
    expect(String(sent[0].payload.body)).toContain("failed for week ending 2 Aug 2026");
  });

  it("its own first reads failing → one Admin failure push, and the error is raised", async () => {
    state.failSelect = true;
    const { catchUpWeeklyPnL } = await import("@/server/crons/weekly-pnl-job");
    await expect(catchUpWeeklyPnL(MONDAY_0600)).rejects.toThrow("db down");
    expect(sent).toHaveLength(1);
    expect(sent[0].endpoint).toBe("https://push.example/admin");
    expect(String(sent[0].payload.title)).toContain("generateWeeklyPnL");
    expect(generated).toEqual([]);
  });

  it("no orders ever → nothing to catch up, nothing written, nobody pushed", async () => {
    const { catchUpWeeklyPnL } = await import("@/server/crons/weekly-pnl-job");
    expect(await catchUpWeeklyPnL(MONDAY_0600)).toEqual([]);
    expect(generated).toEqual([]);
    expect(audits).toEqual([]);
    expect(sent).toEqual([]);
  });

  it("every complete week already reported → a catch-up writes nothing (idempotent)", async () => {
    state.firstRevenueDay = "2026-08-12";
    state.existingWeeks = new Set(["2026-08-10"]);
    const { catchUpWeeklyPnL } = await import("@/server/crons/weekly-pnl-job");
    expect(await catchUpWeeklyPnL(MONDAY_0600)).toEqual([]);
    expect(audits).toEqual([]);
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
