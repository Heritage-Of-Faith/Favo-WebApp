// PDF renderer — task G21 (AT-62)
// Returns a print-ready HTML page (A4, FAVO branding) with @media print CSS.
// Approach: serverless-compatible (no Playwright at runtime — returns HTML that the
// browser prints to PDF natively, which matches Next.js on Vercel).

import { formatZar } from "@/lib/format";

export type PdfReportKind = "sales" | "cogs" | "inventory" | "monthly_pnl";

export type PdfReportOptions = {
  kind: PdfReportKind;
  from: string;
  to: string;
  rows: Record<string, string | number | null>[];
  generatedBy: string;
};

function escapeHtml(s: string | number | null | undefined): string {
  const str = s == null ? "" : String(s);
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const KIND_LABELS: Record<PdfReportKind, string> = {
  sales: "Sales Report",
  cogs: "COGS Report",
  inventory: "Inventory Report",
  monthly_pnl: "Monthly P&L Report",
};

export function renderPdfHtml(opts: PdfReportOptions): string {
  const { kind, from, to, rows, generatedBy } = opts;
  const title = KIND_LABELS[kind];
  const headers = rows.length > 0 ? Object.keys(rows[0]!) : [];
  const now = new Date().toLocaleString("en-ZA", { timeZone: "Africa/Johannesburg" });

  const headerRow = headers.map((h) => `<th>${escapeHtml(h)}</th>`).join("");
  const bodyRows = rows
    .map(
      (r) =>
        `<tr>${headers
          .map((h) => {
            const v = r[h];
            const cell =
              typeof v === "number" && (h.toLowerCase().includes("zar") || h.toLowerCase().includes("total"))
                ? formatZar(v)
                : v;
            return `<td>${escapeHtml(cell)}</td>`;
          })
          .join("")}</tr>`
    )
    .join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>FAVO — ${escapeHtml(title)}</title>
  <style>
    @page { size: A4; margin: 20mm; }
    * { box-sizing: border-box; }
    body { font-family: 'Helvetica Neue', Arial, sans-serif; font-size: 11px; color: #111; margin: 0; }
    header { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 2px solid #1a1a1a; padding-bottom: 8px; margin-bottom: 16px; }
    header h1 { margin: 0; font-size: 18px; font-weight: 700; letter-spacing: -0.3px; }
    header .meta { text-align: right; color: #555; font-size: 10px; line-height: 1.5; }
    table { width: 100%; border-collapse: collapse; margin-top: 12px; }
    th { background: #1a1a1a; color: #fff; text-align: left; padding: 6px 8px; font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; }
    td { padding: 5px 8px; border-bottom: 1px solid #e5e5e5; font-size: 10px; }
    tr:nth-child(even) td { background: #f9f9f9; }
    footer { margin-top: 24px; border-top: 1px solid #e5e5e5; padding-top: 8px; font-size: 9px; color: #888; display: flex; justify-content: space-between; }
    @media print {
      body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      @page { size: A4 portrait; margin: 15mm; }
    }
  </style>
</head>
<body>
  <header>
    <div>
      <div style="font-size:13px;font-weight:700;letter-spacing:1px">FAVO CAFÉ</div>
      <h1>${escapeHtml(title)}</h1>
    </div>
    <div class="meta">
      Period: ${escapeHtml(from)} — ${escapeHtml(to)}<br>
      Generated: ${escapeHtml(now)}<br>
      By: ${escapeHtml(generatedBy)}
    </div>
  </header>

  <table>
    <thead><tr>${headerRow}</tr></thead>
    <tbody>${bodyRows}</tbody>
  </table>

  <footer>
    <span>FAVO Café — Confidential</span>
    <span>${escapeHtml(rows.length)} row${rows.length === 1 ? "" : "s"}</span>
  </footer>
</body>
</html>`;
}
