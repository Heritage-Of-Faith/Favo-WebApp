// Unit tests for report templates — owner: Nikao (task N10)
// Tests that MonthlyReportTemplate and Receipt render correctly with sample data.

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import MonthlyReportTemplate from "@/components/reports/MonthlyReportTemplate";
import Receipt from "@/components/reports/Receipt";
import { formatRefundLine } from "@/lib/report/format";

// ── formatRefundLine ──────────────────────────────────────────────────────────

describe("formatRefundLine", () => {
  it("prefixes a single minus sign for a positive amount", () => {
    const out = formatRefundLine(4500);
    expect(out.startsWith("−")).toBe(true);
    expect(out.startsWith("−−")).toBe(false);
    expect(out).toContain("45,00");
  });

  it("does not double the sign when given a negative amount", () => {
    // Regression: caller passing signed cents must not render "−−R…".
    // A negative input is normalised to the same string as the positive input.
    expect(formatRefundLine(-4500)).toBe(formatRefundLine(4500));
    expect(formatRefundLine(-4500).startsWith("−−")).toBe(false);
  });
});

// ── MonthlyReportTemplate ─────────────────────────────────────────────────────

describe("MonthlyReportTemplate", () => {
  const SAMPLE_PROPS = {
    period: "May 2026",
    revenue_zar: 845000,  // R8,450.00
    cogs_zar: 320000,     // R3,200.00
    expenses_zar: 180000, // R1,800.00
    net_zar: 345000,      // R3,450.00
    approvers: [
      { name: "Mia van Zyl", role: "Finance Manager", at: "2026-06-01T09:00:00+02:00" },
      { name: "Gian du Plessis", role: "Operations Lead", at: "2026-06-01T10:15:00+02:00" },
    ],
  };

  it("renders the period heading", () => {
    render(<MonthlyReportTemplate {...SAMPLE_PROPS} />);
    expect(screen.getByText("May 2026")).toBeInTheDocument();
  });

  it("renders the FAVO Café brand name and address", () => {
    render(<MonthlyReportTemplate {...SAMPLE_PROPS} />);
    expect(screen.getByText("FAVO Café")).toBeInTheDocument();
    expect(screen.getAllByText(/Heritage of Faith Ministries/).length).toBeGreaterThan(0);
  });

  it("renders formatted revenue value", () => {
    render(<MonthlyReportTemplate {...SAMPLE_PROPS} />);
    // R8 450,00 or R8,450,00 depending on locale — match the number portion
    expect(screen.getAllByText(/8.450,00/).length).toBeGreaterThan(0);
  });

  it("renders formatted COGS value", () => {
    render(<MonthlyReportTemplate {...SAMPLE_PROPS} />);
    expect(screen.getAllByText(/3.200,00/).length).toBeGreaterThan(0);
  });

  it("renders formatted net profit value", () => {
    render(<MonthlyReportTemplate {...SAMPLE_PROPS} />);
    expect(screen.getAllByText(/3.450,00/).length).toBeGreaterThan(0);
  });

  it("renders all approver names", () => {
    render(<MonthlyReportTemplate {...SAMPLE_PROPS} />);
    expect(screen.getByText("Mia van Zyl")).toBeInTheDocument();
    expect(screen.getByText("Gian du Plessis")).toBeInTheDocument();
  });

  it("renders approver roles", () => {
    render(<MonthlyReportTemplate {...SAMPLE_PROPS} />);
    expect(screen.getByText("Finance Manager")).toBeInTheDocument();
    expect(screen.getByText("Operations Lead")).toBeInTheDocument();
  });

  it("renders Financial Summary and Approvals section headings", () => {
    render(<MonthlyReportTemplate {...SAMPLE_PROPS} />);
    expect(screen.getByText(/Financial Summary/i)).toBeInTheDocument();
    expect(screen.getByText(/Approvals/i)).toBeInTheDocument();
  });

  it("renders a negative net in a loss scenario", () => {
    render(
      <MonthlyReportTemplate
        {...SAMPLE_PROPS}
        revenue_zar={420000}
        cogs_zar={210000}
        expenses_zar={240000}
        net_zar={-30000}
      />
    );
    // Net loss of R300.00 — formatZar(-30000) → "−R3,00" or similar negative
    // We just check the row label is present and component doesn't crash
    expect(screen.getByText(/Net Profit/)).toBeInTheDocument();
  });

  it("renders the document as an article element", () => {
    const { container } = render(<MonthlyReportTemplate {...SAMPLE_PROPS} />);
    expect(container.querySelector("article")).toBeInTheDocument();
  });

  it("has an accessible aria-label on the article", () => {
    render(<MonthlyReportTemplate {...SAMPLE_PROPS} />);
    expect(screen.getByRole("document", { name: /Monthly P&L Report — May 2026/ })).toBeInTheDocument();
  });
});

// ── Receipt ───────────────────────────────────────────────────────────────────

describe("Receipt", () => {
  const SAMPLE_ITEMS = [
    { name: "Flat White", qty: 2, unit_price_zar: 4500 },
    { name: "Avo Toast", qty: 1, unit_price_zar: 9000 },
  ];

  const SAMPLE_PROPS = {
    orderId: "ORD-2026-0042",
    items: SAMPLE_ITEMS,
    total_zar: 18000,  // R180.00
    refund_zar: 4500,  // R45.00
    reason: "Item not received — Flat White out of stock",
    requested_by: "Thandeka Mokoena",
    approved_by: "Mia van Zyl",
    at: "2026-05-29T14:35:00+02:00",
  };

  it("renders the FAVO Café brand name", () => {
    render(<Receipt {...SAMPLE_PROPS} />);
    expect(screen.getByText("FAVO Café")).toBeInTheDocument();
  });

  it("renders Refund Receipt heading", () => {
    render(<Receipt {...SAMPLE_PROPS} />);
    expect(screen.getByText(/Refund Receipt/i)).toBeInTheDocument();
  });

  it("renders the order ID", () => {
    render(<Receipt {...SAMPLE_PROPS} />);
    expect(screen.getByText("ORD-2026-0042")).toBeInTheDocument();
  });

  it("renders all item names", () => {
    render(<Receipt {...SAMPLE_PROPS} />);
    expect(screen.getByText("Flat White")).toBeInTheDocument();
    expect(screen.getByText("Avo Toast")).toBeInTheDocument();
  });

  it("renders item with quantity > 1 showing qty prefix", () => {
    render(<Receipt {...SAMPLE_PROPS} />);
    expect(screen.getByText("2×")).toBeInTheDocument();
  });

  it("renders the order total formatted as ZAR", () => {
    render(<Receipt {...SAMPLE_PROPS} />);
    // R180,00
    expect(screen.getAllByText(/180,00/).length).toBeGreaterThan(0);
  });

  it("renders the refund amount with minus prefix", () => {
    render(<Receipt {...SAMPLE_PROPS} />);
    // formatRefundLine(4500) → "−R45,00"
    expect(screen.getByText(/−/)).toBeInTheDocument();
    expect(screen.getAllByText(/45,00/).length).toBeGreaterThan(0);
  });

  it("renders the refund reason", () => {
    render(<Receipt {...SAMPLE_PROPS} />);
    expect(screen.getByText("Item not received — Flat White out of stock")).toBeInTheDocument();
  });

  it("renders requested_by and approved_by names", () => {
    render(<Receipt {...SAMPLE_PROPS} />);
    expect(screen.getByText("Thandeka Mokoena")).toBeInTheDocument();
    expect(screen.getByText("Mia van Zyl")).toBeInTheDocument();
  });

  it("renders the document as an article element", () => {
    const { container } = render(<Receipt {...SAMPLE_PROPS} />);
    expect(container.querySelector("article")).toBeInTheDocument();
  });

  it("has an accessible aria-label on the article", () => {
    render(<Receipt {...SAMPLE_PROPS} />);
    expect(
      screen.getByRole("document", { name: /Refund Receipt — Order ORD-2026-0042/ })
    ).toBeInTheDocument();
  });
});
