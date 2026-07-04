// Yoco webhook handler — task G6, AT-119 (BUG-Y2/Y3)
// Verify HMAC → parse → idempotency check → SELECT FOR UPDATE → apply.
// BUG-Y2: match pending charges by checkoutId (not paymentId).
// BUG-Y3: SELECT FOR UPDATE prevents duplicate processing under concurrent delivery.
// Docs: docs/API.md → POST /api/payments/yoco/webhook

import { NextResponse } from "next/server";
import { and, eq, isNull, or } from "drizzle-orm";
import { db } from "@/lib/db";
import { payments, orders, pendingCharges } from "@db/schema";
import { writeAudit } from "@/server/audit";
import { verifyYocoSignature } from "@/server/yoco/signature";
import { parseYocoEvent } from "@/server/yoco/webhook";
import { activatePendingCharge } from "@/server/actions/loyalty";
import { accrueOrderLoyalty, reverseOrderLoyalty } from "@/server/loyalty/accrue";
import { sendPointsEarnedPush } from "@/server/push/send";
import { isValidPushSubscription } from "@/server/push/payload";
import type { DB } from "@/lib/db";

const SIGNATURE_HEADER = "webhook-signature";

export async function POST(request: Request) {
  const secret = process.env.YOCO_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "Webhook not configured" }, { status: 500 });
  }

  const rawBody = await request.text();
  const signature = request.headers.get(SIGNATURE_HEADER) ?? "";

  if (!verifyYocoSignature(rawBody, signature, secret)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const event = parseYocoEvent(parsedJson);
  if (!event) {
    return NextResponse.json({ error: "Unrecognised event" }, { status: 400 });
  }

  // ── Pending charge path (wallet_topup, coffee_pack) ───────────────────────
  // BUG-Y2 fix: match by checkoutId (what we stored at charge creation).
  // The paymentId in the event is the *payment transaction* ID; checkoutId is
  // the *checkout session* ID we stored in yoco_checkout_id.
  const chargeCheckoutId = event.checkoutId ?? event.paymentId;
  const [pendingChargeRow] = await db
    .select({ id: pendingCharges.id, status: pendingCharges.status })
    .from(pendingCharges)
    .where(eq(pendingCharges.yocoCheckoutId, chargeCheckoutId));

  if (pendingChargeRow) {
    // BUG-Y3 fix: SELECT FOR UPDATE inside a transaction prevents two concurrent
    // webhook deliveries from both seeing status='pending' and double-processing.
    await db.transaction(async (tx) => {
      const [locked] = await tx
        .select({ id: pendingCharges.id, status: pendingCharges.status })
        .from(pendingCharges)
        .where(eq(pendingCharges.id, pendingChargeRow.id))
        .for("update");

      if (!locked || locked.status !== "pending") return; // idempotent no-op

      if (event.type === "payment.succeeded") {
        await activatePendingCharge(locked.id, tx as unknown as DB);
      } else if (event.type === "payment.failed") {
        await tx
          .update(pendingCharges)
          .set({ status: "failed" })
          .where(eq(pendingCharges.id, locked.id));
        await writeAudit(
          {
            entityKind: "payment",
            entityId: event.paymentId,
            action: "yoco_charge_failed",
            actorRole: "system",
            after: { chargeId: locked.id },
          },
          tx as unknown as DB
        );
      }
    });

    return NextResponse.json({ ok: true });
  }

  // ── Order payment path ────────────────────────────────────────────────────
  // BUG-Y2 fix: match by yocoPaymentId OR yocoCheckoutId. After redeemLoyalty,
  // the new checkout may not have a yocoPaymentId yet; matching by checkoutId
  // ensures we find the row and backfill the paymentId atomically.
  const paymentConditions = [eq(payments.yocoPaymentId, event.paymentId)];
  if (event.checkoutId) {
    paymentConditions.push(eq(payments.yocoCheckoutId, event.checkoutId));
  }

  const [existingPayment] = await db
    .select({ id: payments.id, status: payments.status, orderId: payments.orderId })
    .from(payments)
    .where(or(...paymentConditions));

  if (!existingPayment) {
    return NextResponse.json({ ok: true, skipped: "no matching payment" });
  }

  // Loyalty earn details captured inside the transaction for the post-commit
  // points-earned push (L06 / AT-128). Populated only when points are accrued.
  let earnPush: {
    subscription: unknown;
    earnedPoints: number;
    newLoyaltyBalance: number;
  } | null = null;

  // BUG-Y3 fix: SELECT FOR UPDATE prevents concurrent webhook deliveries from
  // double-processing the same event. The lock ensures only the first delivery
  // runs the updates; subsequent ones see status !== 'pending' and no-op.
  await db.transaction(async (tx) => {
    const txDb = tx as unknown as DB;

    const [locked] = await tx
      .select({ id: payments.id, status: payments.status, orderId: payments.orderId })
      .from(payments)
      .where(eq(payments.id, existingPayment!.id))
      .for("update");

    if (!locked) return;
    // succeeded/failed act only on a still-pending payment. A refund, by
    // contrast, arrives against an already-successful payment — so it has its
    // own guard. Both are idempotent: a repeat delivery finds the terminal
    // status and no-ops.
    const isRefund = event.type === "refund.succeeded";
    if (!isRefund && locked.status !== "pending") return;
    if (isRefund && locked.status !== "successful") return;

    // Backfill yocoPaymentId so future webhook lookups hit the fast path.
    const paymentIdSet = { yocoPaymentId: event.paymentId };

    if (event.type === "payment.succeeded") {
      await tx
        .update(payments)
        .set({ status: "successful", webhookReceivedAt: new Date(), ...paymentIdSet })
        .where(eq(payments.id, locked.id));

      // ── Loyalty accrual on payment confirmation (L06) ────────────────────
      // Earn triggers here — on the Yoco webhook — NOT on the order state
      // change. Shared with the deferred-payment retry cron so every
      // confirmation site earns consistently and idempotently.
      if (locked.orderId) {
        earnPush = await accrueOrderLoyalty(locked.orderId, txDb);
      }
    } else if (event.type === "payment.failed") {
      await tx
        .update(payments)
        .set({ status: "failed", webhookReceivedAt: new Date(), ...paymentIdSet })
        .where(eq(payments.id, locked.id));

      if (locked.orderId) {
        // Only cancel if still in 'ordered' state — barista may have already
        // progressed the order before the failure webhook arrived.
        await tx
          .update(orders)
          .set({ state: "cancelled" })
          .where(and(eq(orders.id, locked.orderId), eq(orders.state, "ordered")));

        await writeAudit(
          {
            entityKind: "order",
            entityId: locked.orderId,
            action: "cancel",
            actorRole: "system",
            before: { state: "ordered" },
            after: { state: "cancelled" },
            reason: "payment_failed",
          },
          txDb
        );
      }
    } else if (event.type === "refund.succeeded") {
      // Do NOT overwrite yocoPaymentId here — a refund event carries the
      // refund's id, not the original payment's, and the column is unique.
      await tx
        .update(payments)
        .set({ status: "refunded", webhookReceivedAt: new Date() })
        .where(eq(payments.id, locked.id));

      // Claw back any loyalty earned on this order (idempotent, clamped to the
      // customer's balance) so a refunded order doesn't leave points behind.
      if (locked.orderId) {
        await reverseOrderLoyalty(locked.orderId, txDb, { role: "system", reason: "refund" });
      }
    }

    await writeAudit(
      {
        entityKind: "payment",
        entityId: event.paymentId,
        action: `yoco_${event.type.replace(".", "_")}`,
        actorRole: "system",
        after: { type: event.type, orderId: locked.orderId ?? null },
      },
      txDb
    );
  });

  // ── Post-transaction side effect: points-earned push (AT-128) ─────────────
  // Fire-and-forget after the transaction commits — mirrors transitionOrder's
  // previous behaviour. Only fires when this delivery actually accrued points.
  const push = earnPush as {
    subscription: unknown;
    earnedPoints: number;
    newLoyaltyBalance: number;
  } | null;
  if (push && push.subscription && isValidPushSubscription(push.subscription)) {
    const { subscription, earnedPoints, newLoyaltyBalance } = push;
    sendPointsEarnedPush(subscription, earnedPoints, newLoyaltyBalance)
      .then(() => {
        // Subscription expiry is logged inside sendPointsEarnedPush; pruning of
        // stale subscriptions is handled by the order-ready push path.
      })
      .catch((err: unknown) => {
        console.error("[push] sendPointsEarnedPush failed for order", existingPayment!.orderId, err);
      });
  }

  return NextResponse.json({ ok: true });
}
