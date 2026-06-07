"use server";

// Staff Web Push subscription — task M10.
// Stores the logged-in staff member's PushSubscription on staff.push_subscription.
// The G14 checkLowStock cron reads this column to alert baristas. POST
// /api/push/subscribe is customer-scoped (G7), so staff opt-in goes through
// this action which targets the current session's staff row.
// Docs: FAVO_PRD_v3.md §05 §07 · BUSINESS_RULES.md L08

import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { staff } from "@db/schema";
import { authorize } from "@/server/auth/guard";
import { writeAudit } from "@/server/audit";
import { isValidPushSubscription } from "@/server/push/payload";
import type { ActionResult } from "@/lib/types";

const STAFF_ROLES = ["barista", "roaster", "manager", "admin", "finance", "owner"] as const;

/**
 * Save the current staff member's push subscription.
 * `subscription` must be a valid PushSubscription JSON object.
 */
export async function subscribeStaffPush(
  subscription: unknown
): Promise<ActionResult> {
  const auth = await authorize(...STAFF_ROLES);
  if (!auth.ok) return auth;
  const session = auth.session;

  if (!isValidPushSubscription(subscription)) {
    return {
      ok: false,
      code: "VALIDATION_ERROR",
      message: "A valid push subscription is required.",
    };
  }

  await db
    .update(staff)
    .set({ pushSubscription: subscription })
    .where(eq(staff.id, session.id));

  await writeAudit({
    entityKind: "staff",
    entityId: session.id,
    action: "push_subscribe",
    actorId: session.id,
    actorRole: session.role,
  });

  return { ok: true, data: undefined };
}
