// Immediate Admin alert: a web push to every admin with a saved subscription.
// Same recipients and transport as the daily-close mismatch alert
// (src/server/crons/close-daily.ts). Never throws — an alert that fails must
// not break the request that raised it.

import webpush from "web-push";
import { and, eq, isNotNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { staff } from "@db/schema";
import { initVapid } from "@/server/push/vapid";
import { isValidPushSubscription } from "@/server/push/payload";

export async function alertAdmins(title: string, body: string, data: Record<string, unknown> = {}): Promise<void> {
  try {
    const admins = await db
      .select({ pushSubscription: staff.pushSubscription })
      .from(staff)
      .where(and(eq(staff.role, "admin"), isNotNull(staff.pushSubscription)));
    initVapid();
    const payload = JSON.stringify({ title, body, data });
    for (const a of admins) {
      if (!isValidPushSubscription(a.pushSubscription)) continue;
      await webpush.sendNotification(a.pushSubscription, payload).catch(() => {});
    }
  } catch {
    // Swallow: the audit_log row is the durable record of the breach.
  }
}
