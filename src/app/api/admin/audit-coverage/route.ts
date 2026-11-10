// GET /api/admin/audit-coverage — admin only (PRD v7 access matrix; REQ-064).
// Spec of record (docs/FAVO_PRD_v7.md, "Three endpoints had no baseline
// specification"): `200 {mutations, audited, coverage_pct, gaps:[...]}`.
// PRD §05's "Audit coverage 100%" criterion reads this: 0 orphans means `gaps`
// is empty. Gated by the staff session: no session → 401, non-admin → 403.
// SCOPE (not all of REQ-064): a "mutation" here is an order placed in the last
// 30 minutes, "audited" means it has an audit_log row with entity_kind='order'.
// Transitions, refusals, discounts, waste and stock takes are not measured, so
// 100 means "every recent order has an audit note", not "every action is audited".
// coverage_pct is 100 when mutations is 0; read `mutations` to see nothing was measured.

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { sql } from "drizzle-orm";
import { authorize } from "@/server/auth/guard";

export const dynamic = "force-dynamic";

export async function GET(_req: Request) {
  const auth = await authorize("admin");
  if (!auth.ok) {
    const status = auth.code === "UNAUTHORIZED" ? 401 : 403;
    return NextResponse.json({ error: auth.message }, { status });
  }

  // Orders placed in the last 30 minutes, each flagged by whether an
  // audit_log row exists for it. An unaudited order is a gap: writeAudit()
  // was not called on a mutation. The creation timestamp is `placed_at`.
  // Only entity_kind='order' counts — a 'walk_in' refusal row never stands in
  // for an order's missing creation audit (see walk-ins.ts).
  const rows = await db.execute<{ id: string; audited: boolean }>(sql`
    SELECT o.id,
           EXISTS (
             SELECT 1 FROM audit_log a
             WHERE a.entity_kind = 'order'
               AND a.entity_id = o.id
           ) AS audited
    FROM orders o
    WHERE o.placed_at > NOW() - INTERVAL '30 minutes'
    ORDER BY o.placed_at
  `);

  const mutations = rows.length;
  const gaps = rows.filter((r) => !r.audited).map((r) => r.id);
  const audited = mutations - gaps.length;
  // No mutations in the window means nothing is unaudited: 0 orphans, 100%.
  const coverage_pct = mutations === 0 ? 100 : (audited / mutations) * 100;

  return NextResponse.json({ mutations, audited, coverage_pct, gaps });
}
