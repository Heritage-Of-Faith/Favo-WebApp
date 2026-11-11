// AT-208 · REQ-139 · REQ-109 · REQ-110 · REQ-129 — the margin-by-shot table
// renders the three states distinctly: no orders → "No sales"; an absent input
// → UNAVAILABLE with the item named; an estimated input → provisional, warn
// colour, Recost link, never the success colour.

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/server/actions/cogs", () => ({
  getMarginByShot: vi.fn().mockResolvedValue({ ok: false, code: "FORBIDDEN", message: "Admin only" }),
}));

import MarginByShotPanel, { MarginByShotTable } from "@/components/admin/MarginByShotPanel";

describe("MarginByShotPanel", () => {
  it("a failed load shows the error message, not 'loading' forever", async () => {
    render(<MarginByShotPanel from="2026-08-16" to="2026-08-16" />);
    expect((await screen.findByRole("alert")).textContent).toBe("Admin only");
    expect(screen.queryByText("loading…")).toBeNull();
  });
});
import { marginByShot } from "@/lib/margin-by-shot";
import type { ShotMarginRow } from "@/server/cogs/period-cogs";

const named = (rows: ReturnType<typeof marginByShot>, names: Record<string, string> = {}): ShotMarginRow[] =>
  rows.map((r) => ({ ...r, absentItemNames: r.absentItemIds.map((id) => names[id] ?? id) }));

describe("MarginByShotTable", () => {
  it("no orders → 'No sales', no zero rows", () => {
    render(<MarginByShotTable rows={[]} />);
    expect(screen.getByText("No sales")).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("estimated costs → provisional, warn colour, Recost link, never success (REQ-110)", () => {
    const rows = named(
      marginByShot([
        { mode: "sunday", netChargedZar: 2000, coffeeShots: [1], cogs: { cogsZar: 1031, absentItemIds: [], estimated: true } },
        { mode: "sunday", netChargedZar: 2000, coffeeShots: [2], cogs: { cogsZar: 1352, absentItemIds: [], estimated: true } },
      ])
    );
    const { container } = render(<MarginByShotTable rows={rows} />);
    expect(screen.getByText("1 shot")).toBeTruthy();
    expect(screen.getByText("2 shots")).toBeTruthy();
    const cells = [...container.querySelectorAll("tbody tr td:last-child")] as HTMLElement[];
    for (const c of cells) {
      expect(c.textContent).toContain("provisional");
      expect(c.style.color).toBe("var(--status-warn)");
      expect(c.style.color).not.toBe("var(--color-success)");
    }
    expect(screen.getByRole("link", { name: "Recost" }).getAttribute("href")).toBe("/admin/yield");
  });

  it("renders one table per mode, Sunday and weekday apart (§7.1)", () => {
    const rows = named(
      marginByShot([
        { mode: "weekday", netChargedZar: 0, coffeeShots: [2], cogs: { cogsZar: 1352, absentItemIds: [], estimated: true } },
        { mode: "sunday", netChargedZar: 2000, coffeeShots: [2], cogs: { cogsZar: 1352, absentItemIds: [], estimated: true } },
      ])
    );
    const { container } = render(<MarginByShotTable rows={rows} />);
    expect([...container.querySelectorAll("table")].map((t) => t.getAttribute("data-mode"))).toEqual(["sunday", "weekday"]);
    expect(screen.getByText("Sunday")).toBeTruthy();
    expect(screen.getByText("Weekday")).toBeTruthy();
  });

  it("an absent input → UNAVAILABLE with the item named on every row (REQ-109)", () => {
    const rows = named(
      marginByShot([
        { mode: "sunday", netChargedZar: 2000, coffeeShots: [1], cogs: { cogsZar: 1031, absentItemIds: [], estimated: true } },
        { mode: "sunday", netChargedZar: 2000, coffeeShots: [2], cogs: { cogsZar: null, absentItemIds: ["inv_oat"], estimated: true } },
      ]),
      { inv_oat: "Oat Milk" }
    );
    const { container } = render(<MarginByShotTable rows={rows} />);
    const cells = [...container.querySelectorAll("tbody tr td:last-child")] as HTMLElement[];
    expect(cells).toHaveLength(2);
    for (const c of cells) {
      expect(c.textContent).toBe("UNAVAILABLE — Oat Milk");
      expect(c.style.color).toBe("var(--status-unavailable)");
    }
    expect(screen.queryByText(/provisional/)).toBeNull();
  });
});
