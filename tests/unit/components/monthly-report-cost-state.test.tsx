// AT-191 · AT-192 — REQ-110, REQ-129. A monthly report's net is never green on
// estimated costs, and an UNAVAILABLE month shows the word, never R0,00.

import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { MonthlyReport } from "@/lib/types";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/server/actions/monthly-pnl", () => ({ approveMonthlyPnL: vi.fn() }));

import MonthlyReportRow from "@/components/admin/MonthlyReportRow";
import DualSignBlock from "@/components/admin/DualSignBlock";

function report(over: Partial<MonthlyReport> = {}): MonthlyReport {
  return {
    id: "rep1",
    month: "2026-08-01",
    revenueZar: 35000,
    cogsZar: 19636,
    expensesZar: 0,
    grossMarginZar: 15364,
    netZar: 15364,
    costState: "provisional",
    cogsAbsentItems: [],
    ordersWithoutCost: 0,
    status: "closed",
    adminSig: null,
    generatedAt: "2026-09-01T08:00:00+02:00",
    closedAt: null,
    ...over,
  };
}

describe("MonthlyReportRow — cost states", () => {
  it("provisional: net in --status-warn and labelled provisional, never --color-success", () => {
    render(<MonthlyReportRow report={report()} canSignAdmin={false} onChanged={() => {}} />);
    const net = screen.getByText(/R\s*153,64/);
    expect(net.style.color).toBe("var(--status-warn)");
    expect(net.textContent).toContain("provisional");
  });

  it("final: net in --color-success", () => {
    render(<MonthlyReportRow report={report({ costState: "final" })} canSignAdmin={false} onChanged={() => {}} />);
    expect(screen.getByText(/R\s*153,64/).style.color).toBe("var(--color-success)");
  });

  const refused = report({
    cogsZar: null,
    grossMarginZar: null,
    netZar: null,
    costState: "unavailable",
    cogsAbsentItems: ["Oat Milk"],
    ordersWithoutCost: 2,
  });
  const NAMED = "UNAVAILABLE — Oat Milk, 2 orders with no recorded cost";

  it("unavailable: COGS and net show the named refusal incl. orders without a cost row, never a bare UNAVAILABLE", () => {
    render(<MonthlyReportRow report={refused} canSignAdmin={false} onChanged={() => {}} />);
    expect(screen.getByText(new RegExp(`COGS ${NAMED}`))).toBeInTheDocument();
    const net = screen.getByText(NAMED);
    expect(net.style.color).toBe("var(--status-unavailable)");
    expect(screen.queryByText(/^UNAVAILABLE$/)).toBeNull();
    expect(screen.queryByText(/R\s*0,00/)).toBeNull();
  });

  it("only orders without a cost row: the refusal still names them", () => {
    render(
      <MonthlyReportRow report={{ ...refused, cogsAbsentItems: [], ordersWithoutCost: 1 }} canSignAdmin={false} onChanged={() => {}} />
    );
    expect(screen.getByText("UNAVAILABLE — 1 order with no recorded cost")).toBeInTheDocument();
  });

  it("DualSignBlock's confirm dialog shows the named refusal for COGS and net", () => {
    render(<DualSignBlock report={{ ...refused, status: "awaiting_signatures" }} canSignAdmin onSigned={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /sign & close report/i }));
    expect(screen.getAllByText(NAMED)).toHaveLength(2);
    expect(screen.queryByText(/^UNAVAILABLE$/)).toBeNull();
  });
});
