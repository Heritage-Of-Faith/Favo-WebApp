// Offline sync endpoint — task G20 (AT-61)
// Accepts outbox items from the POS when it comes back online after an offline period.
// Idempotent on clientUuid. A menu-item/amount mismatch is rejected outright
// (see src/server/sync/apply-outbox.ts).
// Auth: barista+ (staff session)
// Docs: docs/API.md · BUSINESS_RULES.md L01

import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { applyOutboxItem, outboxItemSchema } from "@/server/sync/apply-outbox";
import { readJsonBody } from "@/server/http/request-guards";

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ ok: false, code: "UNAUTHORIZED" }, { status: 401 });
  }

  const ALLOWED_ROLES = ["barista", "admin"] as const;
  if (!ALLOWED_ROLES.includes(session.role as typeof ALLOWED_ROLES[number])) {
    return NextResponse.json({ ok: false, code: "FORBIDDEN" }, { status: 403 });
  }

  // SEC-6: bounded read — 413 over ~100 KB, 400 on bad JSON.
  const read = await readJsonBody(request);
  if (!read.ok) {
    return read.status === 413
      ? NextResponse.json({ ok: false, code: "PAYLOAD_TOO_LARGE" }, { status: 413 })
      : NextResponse.json({ ok: false, code: "INVALID_JSON" }, { status: 400 });
  }
  const body = read.value;

  const parsed = outboxItemSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, code: "VALIDATION", errors: parsed.error.issues },
      { status: 422 }
    );
  }

  // Enforce that the staffId in the payload matches the authenticated session.
  // Prevents one staff member submitting offline work attributed to another.
  if (parsed.data.staffId !== session.id) {
    return NextResponse.json(
      { ok: false, code: "FORBIDDEN", message: "staffId must match the authenticated session." },
      { status: 403 }
    );
  }

  const result = await applyOutboxItem(parsed.data);

  switch (result.outcome) {
    case "applied":
      return NextResponse.json({ ok: true, outcome: "applied", orderId: result.orderId, serverTotalZar: result.serverTotalZar });

    case "duplicate":
      return NextResponse.json({ ok: true, outcome: "duplicate", orderId: result.orderId, appliedAt: result.appliedAt });

    case "rejected":
      return NextResponse.json(
        { ok: false, outcome: "rejected", reason: result.reason },
        { status: 409 }
      );
  }
}
