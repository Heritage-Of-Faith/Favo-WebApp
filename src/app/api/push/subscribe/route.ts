// Store a customer's Web Push subscription — task G7
// Auth: barista in P1 (counter-side opt-in), customer in P3.
// Docs: docs/API.md → POST /api/push/subscribe

import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { customers } from "@db/schema";
import { getSession } from "@/lib/auth/session";
import { getCustomerSession } from "@/server/auth/customer-session";
import { isValidPushSubscription } from "@/server/push/payload";
import { writeAudit } from "@/server/audit";

export async function POST(request: Request) {
  // Support both staff (P1 barista-side opt-in) and customer (P3 self opt-in).
  const staffSession = await getSession();
  const customerSessionId = await getCustomerSession();

  if (!staffSession && !customerSessionId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { customerId: bodyCustomerId, subscription } = (body ?? {}) as {
    customerId?: string;
    subscription?: unknown;
  };

  // When the caller is a customer, ignore the body's customerId and use the
  // session instead — prevents a customer from overwriting another's subscription.
  const customerId = customerSessionId ?? bodyCustomerId;

  if (!customerId || !isValidPushSubscription(subscription)) {
    return NextResponse.json(
      { error: "customerId and a valid push subscription are required" },
      { status: 400 }
    );
  }

  await db
    .update(customers)
    .set({ pushSubscription: subscription })
    .where(eq(customers.id, customerId));

  await writeAudit({
    entityKind: "customer",
    entityId: customerId,
    action: "push_subscribe",
    actorId: staffSession?.id ?? customerId,
    actorRole: staffSession?.role ?? "customer",
  });

  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request) {
  const staffSession = await getSession();
  const customerSessionId = await getCustomerSession();

  if (!staffSession && !customerSessionId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Customers can only unsubscribe themselves.
  let customerId = customerSessionId;
  if (!customerId && staffSession) {
    let body: unknown;
    try { body = await request.json(); } catch { /* no body is fine */ }
    customerId = (body as { customerId?: string })?.customerId ?? null;
  }

  if (!customerId) {
    return NextResponse.json({ error: "customerId required" }, { status: 400 });
  }

  await db.transaction(async (tx) => {
    const txDb = tx as unknown as import("@/lib/db").DB;
    await tx
      .update(customers)
      .set({ pushSubscription: null })
      .where(eq(customers.id, customerId));

    await writeAudit(
      {
        entityKind: "customer",
        entityId: customerId,
        action: "push_unsubscribe",
        actorId: staffSession?.id ?? customerId,
        actorRole: staffSession?.role ?? "customer",
      },
      txDb
    );
  });

  return NextResponse.json({ ok: true });
}
