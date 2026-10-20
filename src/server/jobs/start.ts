// Boots the scheduler once per server process (AT-169). Called from
// src/instrumentation.ts, which Next.js runs once when the server starts.
//
// SCHEDULER_ENABLED: "true" / "false" override; unset means on in production
// and off everywhere else, so `next dev`, unit tests and CI never fire jobs.

import { Scheduler } from "./scheduler";
import { JOBS } from "./registry";
import { auditJobStore } from "./store";
import { pushAdminsOnFailure } from "./alert";

export function schedulerEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.SCHEDULER_ENABLED === "true") return true;
  if (env.SCHEDULER_ENABLED === "false") return false;
  return env.NODE_ENV === "production";
}

const globalForScheduler = globalThis as unknown as { __favoScheduler?: Scheduler };

export function startScheduler(): Scheduler | null {
  if (!process.env.CRON_SECRET) {
    console.warn("[scheduler] CRON_SECRET is not set — the manual /api/crons/* triggers will answer 503");
  }
  if (!schedulerEnabled()) {
    console.info("[scheduler] disabled (SCHEDULER_ENABLED / NODE_ENV)");
    return null;
  }
  // One scheduler per process, even if register() runs twice.
  if (globalForScheduler.__favoScheduler) return globalForScheduler.__favoScheduler;
  const scheduler = new Scheduler(JOBS, { store: auditJobStore, alert: pushAdminsOnFailure });
  globalForScheduler.__favoScheduler = scheduler;
  scheduler.start();
  return scheduler;
}
