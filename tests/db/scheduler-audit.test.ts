// AT-169 · PRD §9.6.2 rule 1: every scheduled run — and every catch-up — is an
// audit_log row with the system as actor, whether it was late, and the period
// it covered. Exercises the real audit_log-backed JobStore against Postgres.
// Skips when no real DB is reachable (see tests/db/helpers.ts).

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Sql } from "postgres";
import { connect, hasRealDb } from "./helpers";

const maybe = hasRealDb() ? describe : describe.skip;

maybe("scheduler audit trail (AT-169)", () => {
  let sql: Sql;
  // audit_log is append-only, so every run of this suite uses fresh job names.
  const suffix = Math.random().toString(36).slice(2, 8);
  const jobName = `testWeekly_${suffix}`;

  beforeAll(() => {
    sql = connect();
  });

  afterAll(async () => {
    await sql?.end({ timeout: 5 });
  });

  it("records a start marker and reads back the first start", async () => {
    const { auditJobStore } = await import("@/server/jobs/store");
    const at = new Date();
    await auditJobStore.recordStart(at);
    const first = await auditJobStore.firstStartedAt();
    expect(first).toBeInstanceOf(Date);
    expect(first!.getTime()).toBeLessThanOrEqual(at.getTime() + 1000);
  });

  it("a catch-up run is written as a system row naming the period and that it was late", async () => {
    const { Scheduler } = await import("@/server/jobs/scheduler");
    const { auditJobStore } = await import("@/server/jobs/store");

    // Pretend the scheduler was first live two weeks ago, with no run recorded
    // since for this job: catch-up must run both missed Mondays exactly once.
    const now = new Date("2026-10-20T08:00:00Z");
    const store = { ...auditJobStore, firstStartedAt: async () => new Date("2026-10-06T08:00:00Z"), recordStart: async () => {} };
    const ran: string[] = [];
    const scheduler = new Scheduler(
      [{
        name: jobName,
        cron: "0 6 * * 1",
        missedRun: "catchUp",
        periodFor: (t) => t.toISOString().slice(0, 10),
        run: async (t) => { ran.push(t.toISOString()); return { rows: 0 }; },
      }],
      { store, alert: async () => {}, now: () => now, log: { info() {}, warn() {}, error() {} } },
    );

    await scheduler.catchUp();
    expect(ran).toEqual(["2026-10-12T04:00:00.000Z", "2026-10-19T04:00:00.000Z"]);

    const rows = await sql`
      SELECT entity_id, action, actor_role, after, reason
      FROM audit_log
      WHERE entity_kind = 'scheduled_job' AND entity_id LIKE ${jobName + ":%"}
      ORDER BY entity_id
    `;
    expect(rows.map((r) => r.entity_id)).toEqual([`${jobName}:2026-10-12`, `${jobName}:2026-10-19`]);
    for (const r of rows) {
      expect(r.action).toBe("job_catch_up");
      expect(r.actor_role).toBe("system");
      expect(r.after).toMatchObject({ late: true, job: jobName, result: { rows: 0 } });
      expect(r.reason).toMatch(/catch-up/);
    }

    // Idempotent across restarts: a second startup finds both periods recorded.
    expect(await auditJobStore.hasRun(jobName, "2026-10-12")).toBe(true);
    await scheduler.catchUp();
    expect(ran).toHaveLength(2);
  });
});
