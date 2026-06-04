// Component test for the A7 COGS dashboard.
// Mocks the live hook + server actions so we assert rendering + the profit/loss
// colour flip per the A7 acceptance criteria.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import type { CogsLive } from "@/lib/types";

const mockUseCogsLive = vi.fn();

vi.mock("@/hooks/useCogsLive", () => ({
  useCogsLive: (initial: CogsLive) => mockUseCogsLive(initial),
}));

vi.mock("@/server/actions/cogs", () => ({
  getCogsHistory: vi.fn().mockResolvedValue({ ok: true, data: { history: [] } }),
  getCogsLive: vi.fn().mockResolvedValue({ ok: false, code: "X", message: "x" }),
}));

import CogsDashboard from "@/components/admin/CogsDashboard";

function makeCogs(over: Partial<CogsLive> = {}): CogsLive {
  return {
    date: "2026-06-04",
    revenueZar: 50000,
    cogsZar: 15000,
    expensesZar: 5000,
    grossMarginZar: 35000,
    netZar: 30000,
    profit: true,
    costEstimatedWarning: false,
    ...over,
  };
}

const history: CogsLive[] = [
  makeCogs({ date: "2026-06-02", netZar: 10000 }),
  makeCogs({ date: "2026-06-03", netZar: 20000 }),
  makeCogs({ date: "2026-06-04", netZar: 30000 }),
];

describe("CogsDashboard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders KPI tiles with formatted money", () => {
    mockUseCogsLive.mockReturnValue({ today: makeCogs(), status: "live", refresh: vi.fn() });
    render(<CogsDashboard initialToday={makeCogs()} initialHistory={history} todayDate="2026-06-04" />);

    // KPI labels (also appear in chart legends, so use getAllByText)
    expect(screen.getAllByText("COGS").length).toBeGreaterThan(0);
    // Money values (revenue appears in KPI + donut centre)
    expect(screen.getAllByText(/R\s*500,00/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/R\s*150,00/).length).toBeGreaterThan(0);
  });

  it("shows the cost-estimate warning banner when flagged (R10)", () => {
    mockUseCogsLive.mockReturnValue({
      today: makeCogs({ costEstimatedWarning: true }),
      status: "live",
      refresh: vi.fn(),
    });
    render(
      <CogsDashboard
        initialToday={makeCogs({ costEstimatedWarning: true })}
        initialHistory={history}
        todayDate="2026-06-04"
      />
    );
    expect(screen.getByText(/best-estimate/i)).toBeInTheDocument();
  });

  it("colours the Net tile green on profit and red on loss", () => {
    // Profit — the Net KPI value is rendered in the success colour.
    mockUseCogsLive.mockReturnValue({ today: makeCogs(), status: "live", refresh: vi.fn() });
    const { rerender } = render(
      <CogsDashboard initialToday={makeCogs()} initialHistory={history} todayDate="2026-06-04" />
    );
    expect(
      screen.getAllByText(/R\s*300,00/).some((el) => el.style.color === "var(--color-success)")
    ).toBe(true);

    // Loss (net < 0) — Net KPI value flips to the error colour.
    const loss = makeCogs({ netZar: -4500, profit: false });
    mockUseCogsLive.mockReturnValue({ today: loss, status: "live", refresh: vi.fn() });
    rerender(<CogsDashboard initialToday={loss} initialHistory={history} todayDate="2026-06-04" />);
    expect(
      screen.getAllByText(/-R\s*45,00/).some((el) => el.style.color === "var(--color-error)")
    ).toBe(true);
  });
});
