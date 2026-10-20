// Failure alert for scheduled jobs (AT-169, PRD §9.6.2 rule 3).
// A job that fails raises exactly one Admin push naming the job and the period
// it covered. It is never retried silently — the next scheduled run is the retry.

import { and, eq, isNotNull } from "drizzle-orm";
import webpush from "web-push";
import { db } from "@/lib/db";
import { staff } from "@db/schema";
import { initVapid } from "@/server/push/vapid";
import { isValidPushSubscription } from "@/server/push/payload";
import type { FailureAlerter } from "./scheduler";

export function buildJobFailurePayload(job: string, period: string, error: string): string {
  return JSON.stringify({
    title: `Scheduled job failed — ${job}`,
    body: `${job} did not complete for ${period}: ${error.slice(0, 160)}. It will not retry until its next scheduled run.`,
    data: { job, period, url: "/admin" },
  });
}

export const pushAdminsOnFailure: FailureAlerter = async (job, period, error) => {
  const admins = await db
    .select({ pushSubscription: staff.pushSubscription })
    .from(staff)
    .where(and(eq(staff.role, "admin"), isNotNull(staff.pushSubscription)));

  const payload = buildJobFailurePayload(job, period, error);
  initVapid();
  for (const { pushSubscription } of admins) {
    if (!isValidPushSubscription(pushSubscription)) continue;
    await webpush.sendNotification(pushSubscription, payload).catch((e) =>
      console.error(`[scheduler] admin push for ${job}:${period} failed:`, e),
    );
  }
};
