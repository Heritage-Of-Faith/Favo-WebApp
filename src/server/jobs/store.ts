// audit_log-backed JobStore for the scheduler (AT-169).
//
// §9.6.2 rule 1: a run — and especially a catch-up — is an audit_log row with
// the system as actor, the fact that it was late, and the period it covered.
// audit_log has `actor_role` rather than an `actor_kind` column, so the system
// actor is recorded there; no migration is needed.
//
//   entity_kind  'scheduled_job'
//   entity_id    '<job>:<period>'  (or 'scheduler' for a start marker)
//   action       job_run | job_catch_up | job_failed | scheduler_started

import { and, eq, inArray, min } from "drizzle-orm";
import { db } from "@/lib/db";
import { auditLog } from "@db/schema";
import { writeAudit } from "@/server/audit";
import type { JobStore, RunRecord } from "./scheduler";

export const JOB_ENTITY_KIND = "scheduled_job";
const RUN_ACTIONS = ["job_run", "job_catch_up", "job_failed"];

export const auditJobStore: JobStore = {
  async hasRun(job, period) {
    const [row] = await db
      .select({ id: auditLog.id })
      .from(auditLog)
      .where(
        and(
          eq(auditLog.entityKind, JOB_ENTITY_KIND),
          eq(auditLog.entityId, `${job}:${period}`),
          inArray(auditLog.action, RUN_ACTIONS),
        ),
      )
      .limit(1);
    return Boolean(row);
  },

  async firstStartedAt() {
    const [row] = await db
      .select({ at: min(auditLog.at) })
      .from(auditLog)
      .where(and(eq(auditLog.entityKind, JOB_ENTITY_KIND), eq(auditLog.action, "scheduler_started")));
    return row?.at ?? null;
  },

  async recordStart(at) {
    await writeAudit({
      entityKind: JOB_ENTITY_KIND,
      entityId: "scheduler",
      action: "scheduler_started",
      actorRole: "system",
      after: { startedAt: at.toISOString() },
    });
  },

  async recordRun(r: RunRecord) {
    await writeAudit({
      entityKind: JOB_ENTITY_KIND,
      entityId: `${r.job}:${r.period}`,
      action: r.action,
      actorRole: "system",
      after: {
        job: r.job,
        period: r.period,
        late: r.late,
        scheduledFor: r.scheduledFor.toISOString(),
        startedAt: r.startedAt.toISOString(),
        finishedAt: r.finishedAt.toISOString(),
        ...(r.error !== undefined ? { error: r.error } : { result: r.result ?? null }),
      },
      reason: r.late ? "catch-up on startup: the scheduled run was missed" : undefined,
    });
  },
};
