// GET /api/reports/export — task G11 (CSV) extended by G21/AT-62 (kinds + PDF + audit)
// Streams a Sales, COGS, Inventory, or Monthly P&L report in CSV or HTML-PDF format.
// Auth: admin OR finance role; barista receives 403.
// Audit row written on every successful export.

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getSession } from "@/lib/auth/session";
import { canAccessAdmin } from "@/server/auth/rbac";
import { buildReportRows, rowsToCsv } from "@/server/reports/export-csv";
import { buildSalesCsv } from "@/server/reports/sales-csv";
import { buildInventoryCsv } from "@/server/reports/inventory-csv";
import { buildMonthlyPnlCsv } from "@/server/reports/monthly-pnl-csv";
import { renderPdfHtml, type PdfReportKind } from "@/server/reports/pdf-renderer";
import { writeAudit } from "@/server/audit";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const VALID_KINDS = ["sales", "cogs", "inventory", "monthly_pnl"] as const;
type ExportKind = typeof VALID_KINDS[number];

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session || !canAccessAdmin(session.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = req.nextUrl;
  const format = searchParams.get("format") ?? "csv";
  const kind = (searchParams.get("kind") ?? "cogs") as ExportKind;
  const from = searchParams.get("from") ?? "";
  const to = searchParams.get("to") ?? "";

  if (format !== "csv" && format !== "pdf") {
    return NextResponse.json({ error: "format must be csv or pdf." }, { status: 400 });
  }
  if (!VALID_KINDS.includes(kind)) {
    return NextResponse.json(
      { error: `kind must be one of: ${VALID_KINDS.join(", ")}.` },
      { status: 400 }
    );
  }
  if (!DATE_RE.test(from) || !DATE_RE.test(to) || to < from) {
    return NextResponse.json(
      { error: "Provide valid from= and to= dates in YYYY-MM-DD format (from ≤ to)." },
      { status: 400 }
    );
  }

  // ── CSV export ─────────────────────────────────────────────────────────────
  if (format === "csv") {
    let csv: string;
    switch (kind) {
      case "sales":
        csv = await buildSalesCsv(from, to);
        break;
      case "inventory":
        csv = await buildInventoryCsv();
        break;
      case "monthly_pnl":
        csv = await buildMonthlyPnlCsv(from, to);
        break;
      case "cogs":
      default: {
        const rows = await buildReportRows(from, to);
        csv = rowsToCsv(rows);
        break;
      }
    }

    await writeAudit({
      actorId: session.id,
      actorRole: session.role,
      action: "report.export",
      entityKind: "reports",
      entityId: kind,
      after: { kind, format, from, to },
    });

    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="favo-${kind}-${from}-to-${to}.csv"`,
      },
    });
  }

  // ── PDF export — HTML print-ready page ────────────────────────────────────
  // Returns a branded A4 HTML page. The browser's native print-to-PDF handles
  // the final step (Ctrl+P → Save as PDF). This is serverless-compatible;
  // Playwright headless PDF requires a runtime binary not available on Vercel.
  let rows: Record<string, string | number | null>[];
  switch (kind) {
    case "sales": {
      const csvText = await buildSalesCsv(from, to);
      rows = csvToRows(csvText);
      break;
    }
    case "monthly_pnl": {
      const csvText = await buildMonthlyPnlCsv(from, to);
      rows = csvToRows(csvText);
      break;
    }
    case "inventory": {
      const csvText = await buildInventoryCsv();
      rows = csvToRows(csvText);
      break;
    }
    case "cogs":
    default: {
      const reportRows = await buildReportRows(from, to);
      rows = reportRows.map((r) => ({
        Date: r.date,
        "Revenue (ZAR)": r.revenueZar,
        "COGS (ZAR)": r.cogsZar,
        "Gross Margin (ZAR)": r.grossMarginZar,
        "Gross Margin %": r.grossMarginPct,
      }));
      break;
    }
  }

  await writeAudit({
    actorId: session.id,
    actorRole: session.role,
    action: "report.export",
    entityKind: "reports",
    entityId: kind,
    after: { kind, format: "pdf", from, to },
  });

  const html = renderPdfHtml({
    kind: kind as PdfReportKind,
    from,
    to,
    rows,
    generatedBy: session.name,
  });

  return new NextResponse(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Disposition": `inline; filename="favo-${kind}-${from}-to-${to}.pdf"`,
    },
  });
}

// ─── Helper: parse BOM-prefixed CSV back to row objects for PDF renderer ──────

function csvToRows(csv: string): Record<string, string | null>[] {
  const text = csv.startsWith("﻿") ? csv.slice(1) : csv;
  const lines = text.split("\r\n").filter(Boolean);
  if (lines.length < 2) return [];
  const headers = lines[0]!.split(",").map((h) => h.replace(/^"|"$/g, "").replace(/""/g, '"'));
  return lines.slice(1).map((line) => {
    const cells = line.split(",").map((c) => c.replace(/^"|"$/g, "").replace(/""/g, '"'));
    const row: Record<string, string | null> = {};
    headers.forEach((h, i) => { row[h] = cells[i] ?? null; });
    return row;
  });
}
