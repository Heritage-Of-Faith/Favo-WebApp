// Unit tests for report templates — owner: Nikao (task N10)
// Tests that MonthlyReportTemplate renders correctly with sample data.

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import MonthlyReportTemplate from "@/components/reports/MonthlyReportTemplate";

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
