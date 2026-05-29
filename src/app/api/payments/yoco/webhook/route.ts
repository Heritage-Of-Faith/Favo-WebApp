// Yoco webhook handler — task G6
// Verify HMAC → parse → idempotency check (payments.yoco_payment_id) → apply.
// Docs: docs/API.md → POST /api/payments/yoco/webhook

import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { payments, orders } from "@db/schema";
import { writeAudit } from "@/server/audit";
import { verifyYocoSignature } from "@/server/yoco/signature";
import { parseYocoEvent, decideWebhookOutcome } from "@/server/yoco/webhook";

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

  // Idempotency: has this payment id already been recorded as processed?
  const [existing] = await db
    .select({ id: payments.id, status: payments.status })
    .from(payments)
    .where(eq(payments.yocoPaymentId, event.paymentId));
  const alreadyProcessed = Boolean(existing && existing.status !== "pending");

  const outcome = decideWebhookOutcome(event, alreadyProcessed);
  if (outcome.action === "noop") {
    return NextResponse.json({ ok: true, deduped: true });
  }

  if (outcome.action === "mark_paid") {
    await db
      .update(payments)
      .set({ status: "successful", webhookReceivedAt: new Date() })
      .where(eq(payments.yocoPaymentId, event.paymentId));
  } else if (outcome.action === "fail_payment") {
    await db
      .update(payments)
      .set({ status: "failed", webhookReceivedAt: new Date() })
      .where(eq(payments.yocoPaymentId, event.paymentId));
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
      .set({ status: "refunded", webhookReceivedAt: new Date() })
      .where(eq(payments.yocoPaymentId, event.paymentId));
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
