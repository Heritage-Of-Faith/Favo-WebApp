// Yoco webhook handler — task G6, AT-119 (BUG-Y3)
// Verify HMAC → parse → idempotency check → SELECT FOR UPDATE → apply.
// BUG-Y3: SELECT FOR UPDATE prevents duplicate processing under concurrent delivery.
// Docs: docs/API.md → POST /api/payments/yoco/webhook

import { NextResponse } from "next/server";
import { and, eq, or } from "drizzle-orm";
import { db } from "@/lib/db";
import { payments, orders } from "@db/schema";
import { writeAudit } from "@/server/audit";
import { verifyYocoSignature } from "@/server/yoco/signature";
import { parseYocoEvent } from "@/server/yoco/webhook";
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

  // ── Order payment path ────────────────────────────────────────────────────
  // Match by yocoPaymentId OR yocoCheckoutId — the new checkout created by a
  // repriced order may not have a yocoPaymentId yet; matching by checkoutId
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
    // Idempotent: a repeat delivery finds the terminal status and no-ops.
    if (locked.status !== "pending") return;

    // Backfill yocoPaymentId so future webhook lookups hit the fast path.
    const paymentIdSet = { yocoPaymentId: event.paymentId };

    if (event.type === "payment.succeeded") {
      await tx
        .update(payments)
        .set({ status: "successful", webhookReceivedAt: new Date(), ...paymentIdSet })
        .where(eq(payments.id, locked.id));
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

  return NextResponse.json({ ok: true });
}
