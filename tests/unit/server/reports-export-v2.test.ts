// Reports export v2 unit tests — G21 (AT-62)
// Tests PDF renderer (pure function) and kind/format validation.
// New CSV renderers are DB-dependent — covered by integration tests on staging.

import { describe, it, expect } from "vitest";
import { renderPdfHtml } from "@/server/reports/pdf-renderer";

// ─── renderPdfHtml ────────────────────────────────────────────────────────────

describe("renderPdfHtml", () => {
  const base = {
    from: "2026-06-01",
    to: "2026-06-30",
    generatedBy: "Admin",
  };

  it("returns a valid HTML document", () => {
    const html = renderPdfHtml({ ...base, kind: "sales", rows: [] });
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("</html>");
  });

  it("includes the correct report title for each kind", () => {
    const kinds = ["sales", "cogs", "inventory", "monthly_pnl"] as const;
    const expectedTitles = ["Sales Report", "COGS Report", "Inventory Report", "Monthly P&amp;L Report"];
    for (const [i, kind] of kinds.entries()) {
      const html = renderPdfHtml({ ...base, kind, rows: [] });
      expect(html).toContain(expectedTitles[i]);
    }
  });

  it("includes the date range in the output", () => {
    const html = renderPdfHtml({ ...base, kind: "cogs", rows: [] });
    expect(html).toContain("2026-06-01");
    expect(html).toContain("2026-06-30");
  });

  it("includes the generatedBy name", () => {
    const html = renderPdfHtml({ ...base, kind: "cogs", rows: [], generatedBy: "Mia Manager" });
    expect(html).toContain("Mia Manager");
  });

  it("renders data rows into a table", () => {
    const rows = [{ Date: "2026-06-01", "Revenue (ZAR)": 50000 }];
    const html = renderPdfHtml({ ...base, kind: "cogs", rows });
    expect(html).toContain("<td>2026-06-01</td>");
    expect(html).toContain("<th>Date</th>");
    expect(html).toContain("<th>Revenue (ZAR)</th>");
  });

  it("escapes HTML entities in cell values", () => {
    const rows = [{ Item: "<script>alert('xss')</script>" }];
    const html = renderPdfHtml({ ...base, kind: "inventory", rows });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("shows row count in the footer", () => {
    const rows = [{ Date: "2026-06-01" }, { Date: "2026-06-02" }, { Date: "2026-06-03" }];
    const html = renderPdfHtml({ ...base, kind: "cogs", rows });
    expect(html).toContain("3 rows");
  });

  it("shows singular 'row' for exactly one row", () => {
    const rows = [{ Date: "2026-06-01" }];
    const html = renderPdfHtml({ ...base, kind: "cogs", rows });
    expect(html).toContain("1 row");
    expect(html).not.toContain("1 rows");
  });

  it("includes @media print CSS for print optimization", () => {
    const html = renderPdfHtml({ ...base, kind: "cogs", rows: [] });
    expect(html).toContain("@media print");
  });

  it("includes A4 page size in print CSS", () => {
    const html = renderPdfHtml({ ...base, kind: "cogs", rows: [] });
    expect(html).toContain("A4");
  });

  it("produces output larger than 1KB for an empty table", () => {
    const html = renderPdfHtml({ ...base, kind: "cogs", rows: [] });
    expect(new TextEncoder().encode(html).length).toBeGreaterThan(1024);
  });
});
