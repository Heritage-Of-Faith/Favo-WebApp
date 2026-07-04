// Deferred-payment retry cron — task G22
// Polls Yoco for every payment in status='deferred' (created while the POS was
// offline). On "succeeded" the payment is marked successful. On "failed" /
// "expired" a sync_conflict of kind='payment_mismatch' is opened so a manager
// can resolve it manually. "pending" results are left for the next cron run.
// Business rule L01: no payment → no settled order.
// Docs: docs/API.md · BUSINESS_RULES.md L01

import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { payments, orders, syncConflicts } from "@db/schema";
import { writeAudit } from "@/server/audit";
import { getCheckoutStatus } from "@/server/yoco/client";
import { accrueOrderLoyalty, type EarnResult } from "@/server/loyalty/accrue";
import { sendPointsEarnedPush } from "@/server/push/send";
import { isValidPushSubscription } from "@/server/push/payload";
import type { DB } from "@/lib/db";

export type DeferredRetryResult = {
  checked: number;
  resolved: number;
  conflicted: number;
  skipped: number;
};

export async function retryDeferredPayments(): Promise<DeferredRetryResult> {
  const deferred = await db
    .select()
    .from(payments)
    .where(eq(payments.status, "deferred"));

  let resolved = 0;
  let conflicted = 0;
  let skipped = 0;

  for (const payment of deferred) {
    let yocoStatus: string;
    try {
      // yocoCheckoutId is set at order creation; yocoPaymentId arrives via the
      // webhook and may still be null on deferred rows. Prefer checkoutId.
      const checkoutRef = payment.yocoCheckoutId ?? payment.yocoPaymentId;
      if (!checkoutRef) { skipped++; continue; }
      const result = await getCheckoutStatus(checkoutRef);
      yocoStatus = result.status;
    } catch {
      // Transient network error — leave for next cron run
      skipped++;
      continue;
    }

    if (yocoStatus === "succeeded") {
      // Mark successful + accrue loyalty in one transaction so the earn is
      // atomic with the confirmation. accrueOrderLoyalty is idempotent (partial
      // unique index), so if the Yoco webhook also confirms this same order the
      // points are credited exactly once (L06).
      const earn: EarnResult = await db.transaction(async (tx) => {
        const txDb = tx as unknown as DB;

        await tx
          .update(payments)
          .set({ status: "successful", webhookReceivedAt: new Date() })
          .where(eq(payments.id, payment.id));

        await writeAudit(
          {
            actorId: "system",
            actorRole: "admin",
            action: "payment.deferred_resolved",
            entityKind: "payments",
            entityId: payment.id,
            after: { status: "successful", resolvedBy: "retry_cron" },
          },
          txDb
        );

        return accrueOrderLoyalty(payment.orderId, txDb);
      });

      // Points-earned push, fire-and-forget after commit (L06 / AT-128).
      if (earn && isValidPushSubscription(earn.subscription)) {
        sendPointsEarnedPush(earn.subscription, earn.earnedPoints, earn.newLoyaltyBalance).catch(
          (err: unknown) =>
            console.error("[retry-deferred] points-earned push failed", payment.orderId, err)
        );
      }

      resolved++;
    } else if (yocoStatus === "failed" || yocoStatus === "expired") {
      const [order] = await db
        .select({ id: orders.id, state: orders.state, totalZar: orders.totalZar })
        .from(orders)
        .where(eq(orders.id, payment.orderId));

      await db.insert(syncConflicts).values({
        kind: "payment_mismatch",
        orderId: payment.orderId,
        clientPayload: {
          paymentId: payment.id,
          yocoCheckoutId: payment.yocoPaymentId,
          amountZar: payment.amountZar,
        },
        serverState: order
          ? { orderId: order.id, state: order.state, totalZar: order.totalZar }
          : null,
      });

      await db
        .update(payments)
        .set({ status: "failed" })
        .where(eq(payments.id, payment.id));

      await writeAudit({
        actorId: "system",
        actorRole: "admin",
        action: "payment.deferred_failed",
        entityKind: "payments",
        entityId: payment.id,
        after: { status: "failed", yocoStatus },
      });

      conflicted++;
    }
    // "pending" → leave for next cron run (no action)
  }

  return { checked: deferred.length, resolved, conflicted, skipped };
}
