// GET /api/cogs/live — task G13
// Returns daily COGS summary for a given SAST date.
// Admin / owner only (enforced via getSession + RBAC).
// Cache-Control: no-store — numbers must be fresh on every request.
// Docs: FAVO_PRD_v3.md §07 · BUSINESS_RULES.md L07

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getSession } from "@/lib/auth/session";
import { getCogsLive as computeCogsLive, todaySast } from "@/server/cogs/compute";
import { isCalendarDate } from "@/server/http/request-guards";

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

  // SEC-5: a supplied date must be a real calendar day (1999-13-45 used to
  // pass the shape check and blow up as a bare 500). Absent → today.
  if (dateParam && !isCalendarDate(dateParam)) {
    return NextResponse.json(
      { error: "date must be a real calendar date in YYYY-MM-DD format." },
      { status: 400 }
    );
  }
  const date = dateParam ?? todaySast();

  // ── Compute ─────────────────────────────────────────────────────────────────
  const data = await computeCogsLive(date);

  return NextResponse.json(data, {
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "application/json",
    },
  });
}
