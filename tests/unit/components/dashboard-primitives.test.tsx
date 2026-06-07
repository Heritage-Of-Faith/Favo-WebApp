// Component tests for N7/N8/N9 primitives.
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import KpiTile from "@/components/shared/dashboard/KpiTile";
import StatusBadge from "@/components/shared/StatusBadge";
import Sparkline from "@/components/shared/charts/Sparkline";
import DonutChart from "@/components/shared/charts/DonutChart";

describe("KpiTile", () => {
  it("formats valueZar via formatZar", () => {
    render(<KpiTile label="Revenue" valueZar={12345} />);
    expect(screen.getByText(/R\s*123,45/)).toBeInTheDocument();
  });

  it("flips value colour between brand tones (profit → teal, loss → crimson)", () => {
    const { rerender } = render(<KpiTile label="Net" valueZar={500} tone="positive" />);
    expect(screen.getByText(/R\s*5,00/)).toHaveStyle({ color: "var(--color-dark-teal)" });

    rerender(<KpiTile label="Net" valueZar={-500} tone="negative" />);
    expect(screen.getByText(/-R\s*5,00/)).toHaveStyle({ color: "var(--color-crimson-carrot)" });
  });

  it("renders valueText for non-money KPIs", () => {
    render(<KpiTile label="Orders" valueText="42" />);
    expect(screen.getByText("42")).toBeInTheDocument();
  });
});

describe("StatusBadge", () => {
  it("renders a default label per variant", () => {
    render(<StatusBadge variant="low" />);
    expect(screen.getByText("Low")).toBeInTheDocument();
  });

  it("uses the warning tone for an investigate variance band", () => {
    render(<StatusBadge variant="variance-investigate" />);
    const el = screen.getByText("Investigate");
    expect(el).toHaveStyle({ color: "var(--color-warning)" });
  });

  it("accepts custom children over the default label", () => {
    render(<StatusBadge variant="ok">All good</StatusBadge>);
    expect(screen.getByText("All good")).toBeInTheDocument();
  });
});

describe("Sparkline", () => {
  it("renders an empty-state baseline for <2 points without crashing", () => {
    const { container } = render(<Sparkline data={[]} ariaLabel="empty" />);
    expect(container.querySelector("svg")).toBeInTheDocument();
    expect(screen.getByLabelText("empty")).toBeInTheDocument();
  });

  it("renders a path for a real series", () => {
    const { container } = render(<Sparkline data={[1, 4, 2, 6]} />);
    expect(container.querySelector("path")).toBeInTheDocument();
  });
});

describe("DonutChart", () => {
  it("renders a dashed empty ring when all values are zero", () => {
    const { container } = render(
      <DonutChart data={[{ label: "A", value: 0 }, { label: "B", value: 0 }]} />
    );
    const circle = container.querySelector("circle");
    expect(circle).toHaveAttribute("stroke-dasharray");
  });

  it("renders arc slices and legend percentages for real data", () => {
    render(
      <DonutChart
        data={[
          { label: "COGS", value: 30 },
          { label: "Net", value: 70 },
        ]}
      />
    );
    expect(screen.getByText(/COGS/)).toBeInTheDocument();
    expect(screen.getByText(/70%/)).toBeInTheDocument();
  });
});
