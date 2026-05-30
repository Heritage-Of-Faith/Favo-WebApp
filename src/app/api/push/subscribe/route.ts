// Store a customer's Web Push subscription — task G7
// Auth: barista in P1 (counter-side opt-in), customer in P3.
// Docs: docs/API.md → POST /api/push/subscribe

import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { customers } from "@db/schema";
import { getSession } from "@/lib/auth/session";
import { isValidPushSubscription } from "@/server/push/payload";
import { writeAudit } from "@/server/audit";

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { customerId, subscription } = (body ?? {}) as {
    customerId?: string;
    subscription?: unknown;
  };

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
    actorId: session.id,
    actorRole: session.role,
  });

  return NextResponse.json({ ok: true });
}
