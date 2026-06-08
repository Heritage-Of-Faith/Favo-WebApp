// GET /api/reports/export — task G11
// Streams a daily Sales + COGS CSV for the requested date range.
// Requires admin or finance role. Docs: docs/API.md · BUSINESS_RULES.md

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getSession } from "@/lib/auth/session";
import { canAccessAdmin } from "@/server/auth/rbac";
import { buildReportRows, rowsToCsv } from "@/server/reports/export-csv";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session || !canAccessAdmin(session.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = req.nextUrl;
  const format = searchParams.get("format") ?? "csv";
  const from = searchParams.get("from") ?? "";
  const to = searchParams.get("to") ?? "";

  if (format !== "csv") {
    return NextResponse.json({ error: "Only format=csv is supported." }, { status: 400 });
  }
  if (!DATE_RE.test(from) || !DATE_RE.test(to) || to < from) {
    return NextResponse.json(
      { error: "Provide valid from= and to= dates in YYYY-MM-DD format (from <= to)." },
      { status: 400 }
    );
  }

  const rows = await buildReportRows(from, to);
  const csv = rowsToCsv(rows);
  const filename = `favo-report-${from}-to-${to}.csv`;

  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
