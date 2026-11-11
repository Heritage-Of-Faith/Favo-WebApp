// AT-206 — PRD v7 §9.6.2 job 3: generateWeeklyPnL(), Monday 06:00 SAST.
//
//   Who is told: "Admin push carries 'for week ending …' — so a late report
//   is never mistaken for the current one." REQ-123 widens the audience to
//   "the three baristas and the Admin": every active staff device, on the
//   scheduled run. A startup catch-up (a late run) tells the Admin only.
//   Rule (2): no job initiates a payment or creates revenue — this job reads,
//   writes one weekly_reports row, and pushes.
//
// This file is the handler only. WHEN it runs (Monday 06:00, and the startup
// catch-up for every complete week with no report), the audit row for every
// run and catch-up (rule 1) and the one Admin push on failure (rule 3) all
// belong to the scheduler (src/server/jobs/registry.ts, scheduler.ts).

import { sql } from "drizzle-orm";
import webpush from "web-push";
import { db } from "@/lib/db";
import { initVapid } from "@/server/push/vapid";
import { isValidPushSubscription, type PushSubscriptionShape } from "@/server/push/payload";
import { generateWeeklyPnL, weekBounds } from "@/server/crons/generate-weekly-pnl";
import { formatWeekEnding } from "@/lib/week-ending";

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

/**
 * REQ-123: the three baristas and the Admin are told the week's summary is
 * ready. A late (catch-up) report goes to the Admin only. A push failure is
 * logged, never allowed to turn a written report into a failed job.
 */
async function announce(weekStarting: string, weekEnding: string, adminOnly: boolean): Promise<void> {
  try {
    await pushAll(await recipients(adminOnly), {
      title: "Weekly ops summary",
      body: `Weekly ops summary for week ending ${formatWeekEnding(weekEnding)}`,
      data: { url: `/pos/weekly?week=${weekStarting}` },
      tag: `favo-weekly-${weekStarting}`,
    });
  } catch (err) {
    console.error("[weekly-pnl] could not push the weekly summary", err);
  }
}

/**
 * Job 3's run, called by the scheduler with a moment inside the completed
 * week it covers (the registry's `completedWeek(firedAt)`), and `late` = this
 * is a startup catch-up. Writes the week's report (idempotent per week) and
 * announces only a newly written report, so a re-run pushes nobody. A failure
 * is raised for the scheduler to audit and alert on.
 */
export async function runWeeklyPnLJob(
  reference: Date,
  late: boolean,
  now: Date = new Date()
): Promise<WeeklyJobResult> {
  const { weekStarting } = weekBounds(reference);
  const weekEnding = addDays(weekStarting, 6);
  const result = await generateWeeklyPnL(reference, now);
  if (!result.alreadyExists) await announce(weekStarting, weekEnding, late);
  return { weekStarting, weekEnding, reportId: result.reportId, alreadyExists: result.alreadyExists };
}
