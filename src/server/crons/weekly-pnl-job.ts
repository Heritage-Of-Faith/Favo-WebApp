// AT-206 — PRD v7 §9.6.2 job 3: generateWeeklyPnL(), Monday 06:00 SAST.
//
//   Missed-run behaviour: "Catch-up on startup, once, for any complete week
//   with no report. Idempotent per (year, week)."
//   Who is told: "Admin push carries 'for week ending …' — so a late report
//   is never mistaken for the current one." REQ-123 widens the audience to
//   "the three baristas and the Admin": every active staff device, on the
//   scheduled run. A startup catch-up tells the Admin only, in one push.
//   Rule (1): a catch-up is recorded as a catch-up (audit_log, actor system,
//   late, the period covered). Rule (2): no job initiates a payment or creates
//   revenue — this job reads, writes one weekly_reports row, and pushes.
//   Rule (3): a job that fails raises — one Admin push naming the job and the
//   period — and the next scheduled run is the retry.
//
// This file is the handler only. WHEN it runs (Monday 06:00, and once on
// startup for the catch-up) belongs to the scheduler, not here.

import { sql } from "drizzle-orm";
import webpush from "web-push";
import { db } from "@/lib/db";
import { writeAudit } from "@/server/audit";
import { initVapid } from "@/server/push/vapid";
import { isValidPushSubscription, type PushSubscriptionShape } from "@/server/push/payload";
import { generateWeeklyPnL, lastCompleteWeek, weekBounds } from "@/server/crons/generate-weekly-pnl";
import { formatWeekEnding } from "@/lib/week-ending";

export const WEEKLY_JOB_NAME = "generateWeeklyPnL";

export type WeeklyJobResult = {
  weekStarting: string;
  weekEnding: string;
  reportId: string;
  alreadyExists: boolean;
};

function addDays(yyyymmdd: string, days: number): string {
  const d = new Date(`${yyyymmdd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Noon SAST on a calendar day — a reference instant safely inside it (and its week). */
function noonSast(yyyymmdd: string): Date {
  return new Date(`${yyyymmdd}T12:00:00+02:00`);
}

type StaffRow = { id: string; role: string; push_subscription: unknown };

async function recipients(adminOnly: boolean): Promise<PushSubscriptionShape[]> {
  const rows = adminOnly
    ? await db.execute<StaffRow>(sql`
        SELECT id, role, push_subscription FROM staff
        WHERE active = true AND push_subscription IS NOT NULL AND role = 'admin'
      `)
    : await db.execute<StaffRow>(sql`
        SELECT id, role, push_subscription FROM staff
        WHERE active = true AND push_subscription IS NOT NULL
      `);
  return [...rows].map((r) => r.push_subscription).filter(isValidPushSubscription);
}

/** One push to each subscription. A dead or failing device never fails the job. */
async function pushAll(subs: readonly PushSubscriptionShape[], payload: Record<string, unknown>): Promise<void> {
  if (subs.length === 0) return;
  initVapid();
  const body = JSON.stringify(payload);
  for (const sub of subs) {
    try {
      await webpush.sendNotification(sub, body);
    } catch (err) {
      const statusCode = (err as { statusCode?: number }).statusCode;
      if (statusCode !== 404 && statusCode !== 410) {
        console.error("[weekly-pnl] push failed", { statusCode, endpoint: sub.endpoint }, err);
      }
    }
  }
}

/** REQ-123: the three baristas and the Admin are told the week's summary is ready. */
async function announce(weekStarting: string, weekEnding: string): Promise<void> {
  await pushAll(await recipients(false), {
    title: "Weekly ops summary",
    body: `Weekly ops summary for week ending ${formatWeekEnding(weekEnding)}`,
    data: { url: `/pos/weekly?week=${weekStarting}` },
    tag: `favo-weekly-${weekStarting}`,
  });
}

/** One Admin push. A push failure is logged, never allowed to mask the job's own outcome. */
async function pushAdmins(payload: Record<string, unknown>): Promise<void> {
  try {
    await pushAll(await recipients(true), payload);
  } catch (err) {
    console.error("[weekly-pnl] could not push the Admin", err);
  }
}

/** Rule (3): one Admin push naming the job and the period. */
async function reportFailure(period: string): Promise<void> {
  await pushAdmins({
    title: `Scheduled job failed: ${WEEKLY_JOB_NAME}`,
    body: `${WEEKLY_JOB_NAME} failed ${period}. The next scheduled run is the retry.`,
    data: { url: "/admin/reports" },
    tag: "favo-job-failed-weekly",
  });
}

const forWeekEnding = (weekEnding: string) => `for week ending ${formatWeekEnding(weekEnding)}`;

/** The scheduled Monday 06:00 run: the week that has just ended. */
export async function runWeeklyPnLJob(now: Date = new Date()): Promise<WeeklyJobResult> {
  const { weekStarting, weekEnding } = lastCompleteWeek(now);
  let result: { reportId: string; alreadyExists: boolean };
  try {
    result = await generateWeeklyPnL(noonSast(weekStarting), now);
  } catch (err) {
    await reportFailure(forWeekEnding(weekEnding));
    throw err;
  }
  // Announce only a newly written report (idempotent: a re-run pushes nobody).
  if (!result.alreadyExists) await announce(weekStarting, weekEnding);
  return { weekStarting, weekEnding, reportId: result.reportId, alreadyExists: result.alreadyExists };
}

/**
 * The startup catch-up: every complete week with no report, oldest first,
 * from the week of the first order ever taken to the last complete week.
 * Each created report is audited as a late system run. The Admin — and only
 * the Admin — gets ONE push in total for the whole catch-up, naming how many
 * reports were created and any week that failed. One failed week does not
 * stop the rest; the failure is raised after every week has been tried.
 */
export async function catchUpWeeklyPnL(now: Date = new Date()): Promise<WeeklyJobResult[]> {
  const to = lastCompleteWeek(now).weekStarting;

  let from: string;
  let have: Set<string>;
  try {
    const [first] = await db.execute<{ first_day: string | null }>(sql`
      SELECT TO_CHAR(MIN(revenue_day), 'YYYY-MM-DD') AS first_day FROM orders
    `);
    if (!first?.first_day) return [];
    from = weekBounds(noonSast(first.first_day)).weekStarting;
    if (from > to) return [];
    const existing = await db.execute<{ week_starting: string }>(sql`
      SELECT week_starting FROM weekly_reports
      WHERE week_starting >= ${from} AND week_starting <= ${to}
    `);
    have = new Set([...existing].map((r) => r.week_starting));
  } catch (err) {
    await reportFailure(`during its startup catch-up, up to week ending ${formatWeekEnding(addDays(to, 6))}`);
    throw err;
  }

  const out: WeeklyJobResult[] = [];
  const failed: { weekEnding: string; error: unknown }[] = [];
  for (let w = from; w <= to; w = addDays(w, 7)) {
    if (have.has(w)) continue;
    const weekEnding = addDays(w, 6);
    try {
      const r = await generateWeeklyPnL(noonSast(w), now);
      if (r.alreadyExists) continue;
      await writeAudit({
        entityKind: "weekly_report",
        entityId: r.reportId,
        action: "weekly_pnl_catch_up",
        actorRole: "system",
        after: { job: WEEKLY_JOB_NAME, wasCatchUp: true, weekStarting: w, weekEnding, ranAt: now.toISOString() },
        reason: "late run: catch-up on startup for a complete week with no report",
      });
      out.push({ weekStarting: w, weekEnding, reportId: r.reportId, alreadyExists: false });
    } catch (error) {
      failed.push({ weekEnding, error });
    }
  }

  if (out.length > 0 || failed.length > 0) {
    const created = `${out.length} missed weekly report${out.length === 1 ? " was" : "s were"} created`;
    const latest = out.length > 0 ? ` (latest: ${forWeekEnding(out[out.length - 1].weekEnding)})` : "";
    const failures =
      failed.length > 0 ? ` ${WEEKLY_JOB_NAME} failed ${failed.map((f) => forWeekEnding(f.weekEnding)).join(", ")}.` : "";
    await pushAdmins({
      title: failed.length > 0 ? `Scheduled job failed: ${WEEKLY_JOB_NAME}` : "Weekly ops summary — catch-up",
      body: `${created}${latest}.${failures}`,
      data: { url: out.length > 0 ? `/pos/weekly?week=${out[out.length - 1].weekStarting}` : "/admin/reports" },
      tag: "favo-weekly-catch-up",
    });
  }

  if (failed.length > 0) {
    throw new AggregateError(
      failed.map((f) => f.error),
      `${WEEKLY_JOB_NAME} catch-up failed ${failed.map((f) => forWeekEnding(f.weekEnding)).join(", ")}`
    );
  }
  return out;
}
