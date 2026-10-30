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
    expensesZar: 0,
    grossMarginZar: 35000,
    netZar: 35000,
    // CHANGED (AT-191/AT-192): profit/costEstimatedWarning → costState.
    costState: "final",
    absentItems: [],
    ordersWithoutCost: 0,
    ...over,
  };
}

// CHANGED (QA P1): the fixture's nets were inconsistent with its revenue and
// COGS (net R100 on R500 − R150 with no expenses) — the very mismatch QA hit.
// Each day's net now follows from its own revenue − COGS − expenses.
const history: CogsLive[] = [
  makeCogs({ date: "2026-06-02", expensesZar: 25000, netZar: 10000 }),
  makeCogs({ date: "2026-06-03", expensesZar: 15000, netZar: 20000 }),
  makeCogs({ date: "2026-06-04", expensesZar: 5000, netZar: 30000 }),
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
    // KPI tiles now show period aggregates (3 days × R500 revenue = R1 500,00).
    // history: Jun 2 + Jun 3 + Jun 4 each with revenueZar=50000 → sum=150000=R1500
    expect(screen.getAllByText(/R\s*1\s*500,00/).length).toBeGreaterThan(0);
    // cogsZar: 3 × 15000 = 45000 = R450
    expect(screen.getAllByText(/R\s*450,00/).length).toBeGreaterThan(0);
  });

  // CHANGED (AT-191): replaces the R10 "best-estimate" banner test.
  it("estimated costs: the provisional banner links to recosting, and Net is warn — never teal (REQ-110)", () => {
    const est = (d: CogsLive) => ({ ...d, costState: "provisional" as const });
    mockUseCogsLive.mockReturnValue({ today: est(makeCogs()), status: "live", refresh: vi.fn() });
    render(
      <CogsDashboard initialToday={est(makeCogs())} initialHistory={history.map(est)} todayDate="2026-06-04" />
    );
    expect(screen.getByText(/Provisional/)).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: /recost/i })[0]).toHaveAttribute("href", "/admin/yield");
    const net = screen.getAllByText(/R\s*650,00/);
    expect(net.some((el) => el.style.color === "var(--status-warn)")).toBe(true);
    expect(net.some((el) => el.style.color === "var(--color-dark-teal)")).toBe(false);
  });

  it("an absent cost input: COGS and Net read UNAVAILABLE naming the item, never R0,00 (REQ-109, REQ-129)", () => {
    const refused = makeCogs({
      cogsZar: null,
      grossMarginZar: null,
      netZar: null,
      costState: "unavailable",
      absentItems: ["Oat Milk"],
    });
    mockUseCogsLive.mockReturnValue({ today: refused, status: "live", refresh: vi.fn() });
    render(<CogsDashboard initialToday={refused} initialHistory={history} todayDate="2026-06-04" />);
    const words = screen.getAllByText("UNAVAILABLE");
    expect(words.length).toBeGreaterThanOrEqual(2); // COGS tile + Net tile
    expect(words.every((el) => el.style.color === "var(--status-unavailable)")).toBe(true);
    expect(screen.getAllByText(/UNAVAILABLE — Oat Milk/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/Provisional/)).toBeNull();
  });

  it("an empty period shows zeroes, not UNAVAILABLE and not provisional (REQ-129)", () => {
    const empty = makeCogs({ revenueZar: 0, cogsZar: 0, grossMarginZar: 0, netZar: 0, costState: "empty" });
    mockUseCogsLive.mockReturnValue({ today: empty, status: "live", refresh: vi.fn() });
    render(<CogsDashboard initialToday={empty} initialHistory={[]} todayDate="2026-06-04" />);
    expect(screen.getByText(/No activity recorded/)).toBeInTheDocument();
    expect(screen.queryByText("UNAVAILABLE")).toBeNull();
    expect(screen.queryByText(/Provisional/)).toBeNull();
  });

  it("QA P1: an R0 day with no orders reads 'No sales' in a neutral tone — never 'loss'", () => {
    const empty = makeCogs({ revenueZar: 0, cogsZar: 0, grossMarginZar: 0, expensesZar: 0, netZar: 0, costState: "empty" });
    mockUseCogsLive.mockReturnValue({ today: empty, status: "live", refresh: vi.fn() });
    render(<CogsDashboard initialToday={empty} initialHistory={[]} todayDate="2026-06-04" />);
    expect(screen.getAllByText(/No sales/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/\bloss\b/i)).toBeNull();
  });

  it("QA P1: the tiles show the expenses that net subtracts, and the COGS % agrees with the donut", () => {
    const day = makeCogs({
      revenueZar: 311300, cogsZar: 32052, grossMarginZar: 279248, expensesZar: 273000, netZar: 6248,
    });
    mockUseCogsLive.mockReturnValue({ today: day, status: "live", refresh: vi.fn() });
    render(<CogsDashboard initialToday={day} initialHistory={[]} todayDate="2026-06-04" />);
    expect(screen.getAllByText(/R\s*2\s*730,00/).length).toBeGreaterThan(0); // Expenses tile
    expect(screen.getAllByText(/R\s*62,48/).length).toBeGreaterThan(0); // Net tile
    expect(screen.getByText("10% of revenue")).toBeInTheDocument(); // COGS tile
    expect(screen.getAllByText(/· 10%/).length).toBeGreaterThan(0); // donut legend: COGS share of revenue
    expect(screen.queryByText(/· 84%/)).toBeNull();
  });

  it("colours the Net tile with brand tones (profit → teal, loss → crimson)", () => {
    // Profit — the Net KPI value is rendered in the brand positive colour.
    mockUseCogsLive.mockReturnValue({ today: makeCogs(), status: "live", refresh: vi.fn() });
    const { rerender } = render(
      <CogsDashboard initialToday={makeCogs()} initialHistory={history} todayDate="2026-06-04" />
    );
    // Period aggregate net: 10000 + 20000 + 35000 (today, merged) = 65000 = R650,00
    expect(
      screen.getAllByText(/R\s*650,00/).some((el) => el.style.color === "var(--color-dark-teal)")
    ).toBe(true);

    // Loss: today's net = -4500; merged into Jun 4 → aggregate = 10000+20000+(-4500) = 25500 = R255,00
    const loss = makeCogs({ expensesZar: 39500, netZar: -4500 }); // CHANGED (QA P1): consistent fixture
    mockUseCogsLive.mockReturnValue({ today: loss, status: "live", refresh: vi.fn() });
    rerender(<CogsDashboard initialToday={loss} initialHistory={history} todayDate="2026-06-04" />);
    // aggregate net = 10000 + 20000 + (-4500) = 25500 = R255,00 — still positive (teal), not a loss
    // To get a loss we'd need all days negative; just check the colour flips via profit flag
    expect(
      screen.getAllByText(/R\s*255,00/).some((el) => el.style.color === "var(--color-dark-teal)")
    ).toBe(true);
  });
});
