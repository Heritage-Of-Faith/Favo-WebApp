// GET /api/admin/audit-coverage — admin only (PRD v7 access matrix; REQ-064).
// Spec of record (docs/FAVO_PRD_v7.md, "Three endpoints had no baseline
// specification"): `200 {mutations, audited, coverage_pct, gaps:[...]}`.
// PRD §05's "Audit coverage 100%" criterion reads this: 0 orphans means `gaps`
// is empty. Gated by the staff session: no session → 401, non-admin → 403.
// SCOPE (still not all of REQ-064): a "mutation" is a row created in the last
// 30 minutes in one of seven tables (orders, payments, waste_log, walk_ins,
// stock_takes, opening_sessions, event_windows); "audited" means an audit_log
// row of that table's entity_kind names it. Updates, transitions and rejected
// actions are NOT measured — the full list and why is in
// src/server/audit-coverage.ts. A gap reads `entity:id`, e.g. `order:ord_2`.
// coverage_pct is null when mutations is 0: nothing was measured, so no
// percentage is claimed; `gaps` is empty, so it still reads as 0 orphans.

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { authorize } from "@/server/auth/guard";
import { coverageQuery, summariseCoverage, type CoverageRow } from "@/server/audit-coverage";

export const dynamic = "force-dynamic";

export async function GET(_req: Request) {
  const auth = await authorize("admin");
  if (!auth.ok) {
    const status = auth.code === "UNAUTHORIZED" ? 401 : 403;
    return NextResponse.json({ error: auth.message }, { status });
  }

  // Only the table's own entity_kind counts — a 'walk_in' refusal row never
  // stands in for an order's missing creation audit (see walk-ins.ts).
  const rows = await db.execute<CoverageRow>(coverageQuery());

  return NextResponse.json(summariseCoverage(rows));
}
