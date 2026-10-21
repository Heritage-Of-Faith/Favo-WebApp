// The 06:00 missing-close alert (AT-193) — PRD §9.6.2 job 2, "Who is told":
// a revenue day with no close record by 06:00 raises an Admin push, repeated
// each morning until it is closed. L09's gate cannot fire on a job that never
// ran, so the absence of the close is itself the alert.
//
// This is job 2's alert, not an eighth register row. The §6.0.5 banner at the
// next opening window is UI work and is not built here.

import { closedDays } from "@/server/crons/close-daily";
import { sastDate, sastMiddayDaysBack } from "./schedule";
import { auditJobStore } from "./store";
import { pushAdmins } from "./alert";

/**
 * The completed revenue days the scheduler was responsible for closing, oldest
 * first: from the SAST day it first started up to yesterday. Deliberately not
 * bounded by the catch-up window: REQ-067's push "repeats daily until
 * resolved", so a day too old to be caught up is still reported every
 * morning. Days before the scheduler existed are not its to close and are
 * never reported.
 */
export function daysToHaveClosed(firstStart: Date, now: Date): string[] {
  const firstDay = sastDate(firstStart);
  const days: string[] = [];
  for (let back = 1; ; back++) {
    const day = sastDate(sastMiddayDaysBack(now, back));
    if (day < firstDay) break;
    days.push(day);
  }
  return days.reverse();
}

export function buildMissingClosePayload(missing: string[]): string {
  const list = missing.length <= 3 ? missing.join(", ") : `${missing.slice(0, 3).join(", ")} and ${missing.length - 3} more`;
  return JSON.stringify({
    title: `Daily close missing — ${missing.length === 1 ? missing[0] : `${missing.length} days`}`,
    body: `No daily close was recorded for ${list}. The close runs at 00:05 and catches up on restart; check the server.`,
    data: { missing, url: "/admin" },
  });
}

export type MissingCloseDeps = {
  firstStartedAt(): Promise<Date | null>;
  closedDays(days: string[]): Promise<Set<string>>;
  push(payload: string, label: string): Promise<void>;
};

const defaultDeps: MissingCloseDeps = {
  firstStartedAt: () => auditJobStore.firstStartedAt(),
  closedDays: (days) => closedDays(days),
  push: pushAdmins,
};

/** Push the Admins once, naming every unclosed day. Silent when all are closed. */
export async function checkMissingCloses(
  now: Date = new Date(),
  deps: MissingCloseDeps = defaultDeps,
): Promise<{ checked: number; missing: string[] }> {
  const firstStart = await deps.firstStartedAt();
  if (!firstStart) return { checked: 0, missing: [] };
  const days = daysToHaveClosed(firstStart, now);
  const closed = await deps.closedDays(days);
  const missing = days.filter((d) => !closed.has(d));
  if (missing.length > 0) await deps.push(buildMissingClosePayload(missing), "closeDailyWatch");
  return { checked: days.length, missing };
}
