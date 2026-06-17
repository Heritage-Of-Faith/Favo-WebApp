// Yoco webhook handler — task G6
// Verify HMAC → parse → idempotency check (payments.yoco_payment_id) → apply.
// Docs: docs/API.md → POST /api/payments/yoco/webhook

import { NextResponse } from "next/server";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { payments, orders, pendingCharges } from "@db/schema";
import { writeAudit } from "@/server/audit";
import { verifyYocoSignature } from "@/server/yoco/signature";
import { parseYocoEvent, decideWebhookOutcome } from "@/server/yoco/webhook";
import { activatePendingCharge } from "@/server/actions/loyalty";
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

  // Check if this payment id belongs to an order payment or a pending charge.
  // Run both lookups in parallel; the order-payment lookup may need a second
  // attempt (orderId fallback) if the row was created before the webhook fired.
  const [[paymentByYocoId], [pendingCharge]] = await Promise.all([
    db
      .select({ id: payments.id, status: payments.status, yocoPaymentId: payments.yocoPaymentId })
      .from(payments)
      .where(eq(payments.yocoPaymentId, event.paymentId)),
    db
      .select({ id: pendingCharges.id, status: pendingCharges.status })
      .from(pendingCharges)
      .where(eq(pendingCharges.yocoCheckoutId, event.paymentId)),
  ]);

  // Fallback: if no row has yocoPaymentId set yet, look up by orderId from the
  // webhook metadata (Yoco echoes back metadata.orderId in the event payload).
  // This covers the gap where createOrder inserted the payments row with only
  // yocoCheckoutId and the webhook is the first time we see the paymentId.
  let existingPayment = paymentByYocoId;
  let needsPaymentIdUpdate = false;
  if (!existingPayment && event.orderId) {
    const [byOrderId] = await db
      .select({ id: payments.id, status: payments.status, yocoPaymentId: payments.yocoPaymentId })
      .from(payments)
      .where(and(eq(payments.orderId, event.orderId), isNull(payments.yocoPaymentId)));
    if (byOrderId) {
      existingPayment = byOrderId;
      needsPaymentIdUpdate = true;
    }
  }

  // ── Wallet / pack charge path ─────────────────────────────────────────────
  if (pendingCharge) {
    const alreadyProcessed = pendingCharge.status !== "pending";
    if (alreadyProcessed) {
      return NextResponse.json({ ok: true, deduped: true });
    }

    if (event.type === "payment.succeeded") {
      await db.transaction(async (tx) => {
        await activatePendingCharge(pendingCharge.id, tx as unknown as DB);
      });
    } else if (event.type === "payment.failed") {
      await db
        .update(pendingCharges)
        .set({ status: "failed" })
        .where(eq(pendingCharges.id, pendingCharge.id));
      await writeAudit({
        entityKind: "payment",
        entityId: event.paymentId,
        action: "yoco_charge_failed",
        actorRole: "system",
        after: { chargeId: pendingCharge.id },
      });
    }

    return NextResponse.json({ ok: true });
  }

  // ── Order payment path (original G6 logic) ────────────────────────────────
  const alreadyProcessed = Boolean(existingPayment && existingPayment.status !== "pending");

  const outcome = decideWebhookOutcome(event, alreadyProcessed);
  if (outcome.action === "noop") {
    return NextResponse.json({ ok: true, deduped: true });
  }

  // All update WHERE clauses use payments.id so they work whether the row was
  // found by yocoPaymentId or by the orderId fallback. When found via fallback,
  // we also backfill yocoPaymentId so future lookups hit the fast path.
  const paymentIdSet = needsPaymentIdUpdate ? { yocoPaymentId: event.paymentId } : {};

  if (outcome.action === "mark_paid") {
    await db
      .update(payments)
      .set({ status: "successful", webhookReceivedAt: new Date(), ...paymentIdSet })
      .where(eq(payments.id, existingPayment!.id));
  } else if (outcome.action === "fail_payment") {
    await db
      .update(payments)
      .set({ status: "failed", webhookReceivedAt: new Date(), ...paymentIdSet })
      .where(eq(payments.id, existingPayment!.id));
    // Rule L01: failed payment cancels the order (only while still 'ordered').
    if (outcome.orderId) {
      await db
        .update(orders)
        .set({ state: "cancelled" })
        .where(eq(orders.id, outcome.orderId));
    }
  } else if (outcome.action === "record_refund") {
    await db
      .update(payments)
      .set({ status: "refunded", webhookReceivedAt: new Date(), ...paymentIdSet })
      .where(eq(payments.id, existingPayment!.id));
  }

  await writeAudit({
    entityKind: "payment",
    entityId: event.paymentId,
    action: `yoco_${outcome.action}`,
    actorRole: "system",
    after: { type: event.type, orderId: outcome.orderId ?? null },
  });

  return NextResponse.json({ ok: true });
}
