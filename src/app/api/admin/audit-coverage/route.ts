// Test-only endpoint — returns 403 when TEST_AUDIT_SECRET is not set.
// Used by E2E full-suite.spec.ts to assert that no recent mutations lack an audit row.

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { sql } from "drizzle-orm";

export async function GET(req: NextRequest) {
  const secret = process.env.TEST_AUDIT_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "Not available" }, { status: 403 });
  }

  const { searchParams } = req.nextUrl;
  if (searchParams.get("secret") !== secret) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Count orders from the last 30 minutes that have no corresponding audit_log row.
  // A gap here means writeAudit() was not called on a mutation (business rule violation).
  const result = await db.execute<{ gap_count: string }>(sql`
    SELECT COUNT(*) AS gap_count
    FROM orders o
    WHERE o.created_at > NOW() - INTERVAL '30 minutes'
      AND NOT EXISTS (
        SELECT 1 FROM audit_log a
        WHERE a.entity_kind = 'orders'
          AND a.entity_id = o.id
      )
  `);
  const gapCount = parseInt(result[0]?.gap_count ?? "0", 10);
  return NextResponse.json({ ok: gapCount === 0, gapCount });
}
