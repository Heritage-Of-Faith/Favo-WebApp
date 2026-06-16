// GET /api/cogs/live — task G13
// Returns daily COGS summary for a given SAST date.
// Admin / owner only (enforced via getSession + RBAC).
// Cache-Control: no-store — numbers must be fresh on every request.
// Docs: FAVO_PRD_v3.md §07 · BUSINESS_RULES.md L07

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getSession } from "@/lib/auth/session";
import { getCogsLive as computeCogsLive, todaySast } from "@/server/cogs/compute";

const ALLOWED_ROLES = new Set(["admin"]);

export async function GET(req: NextRequest) {
  // ── Auth ────────────────────────────────────────────────────────────────────
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!ALLOWED_ROLES.has(session.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // ── Date param ─────────────────────────────────────────────────────────────
  const { searchParams } = new URL(req.url);
  const dateParam = searchParams.get("date");

  // Basic YYYY-MM-DD validation
  const dateRe = /^\d{4}-\d{2}-\d{2}$/;
  const date = dateParam && dateRe.test(dateParam) ? dateParam : todaySast();

  // ── Compute ─────────────────────────────────────────────────────────────────
  const data = await computeCogsLive(date);

  return NextResponse.json(data, {
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "application/json",
    },
  });
}
