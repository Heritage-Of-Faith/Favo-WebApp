// REQ-122 · REQ-110 · REQ-109 · REQ-114 · REQ-158 — the /admin/ministry view.
// One view: income, the cost terms and the net, plus a per-day table. The
// three render states stay distinct: provisional is --status-warn and never
// green; UNAVAILABLE is named, never R0,00; cogs_zar prints whole with
// outreach beneath it. Figures: FIXTURE-A's Sunday (§7.0.3) — R350.00 gross,
// R196.36 cogs, R9.27 fees, R144.37 contribution.

import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import MinistryRollupView from "@/components/admin/MinistryRollupView";
import { ministryRollup, type MinistryDay } from "@/lib/ministry-rollup";

const FIXTURE_A_SUNDAY: MinistryDay = {
  date: "2026-08-16",
  sessions: [{ mode: "sunday", paymentPosture: null }],
  orderCount: 13,
  cardGrossZar: 35000,
  fundGrossZar: 0,
  writtenOffZar: 0,
  cogs: { state: "provisional", cogsZar: 19636, absentItemIds: [], ordersWithoutCost: 0, orderCount: 13, absentItemNames: [] },
  outreachCogsZar: 0,
  outreachUnrecordedOrders: 0,
  outreachAbsentCostOrders: 0,
  cardOrdersWithoutFavoPayment: 0,
  processingFeeZar: 927,
};

function view(days: MinistryDay[], o: { writer?: boolean; expensesZar?: number } = {}) {
  const r = ministryRollup({ days, expensesZar: o.expensesZar ?? 0, expenseWriterExists: o.writer ?? true, sweepsZar: 0 });
  return render(<MinistryRollupView {...r} from="2026-08-01" to="2026-08-31" periodKind="month" date="2026-08-16" />);
}

const netCell = () => within(screen.getByRole("rowheader", { name: "Ministry net" }).closest("tr")!).getByRole("cell");
const norm = (s: string | null) => (s ?? "").replace(/\s/g, " ");

describe("MinistryRollupView", () => {
  it("FIXTURE-A Sunday: R144,37 net, provisional in --status-warn, never green, with a recost link", () => {
    view([FIXTURE_A_SUNDAY]);
    const cell = netCell();
    expect(norm(cell.textContent)).toContain("R 144,37");
    expect(cell.getAttribute("data-tone")).toBe("warn");
    expect(cell.getAttribute("style")).toContain("var(--status-warn)");
    expect(cell.getAttribute("style")).not.toContain("var(--color-success)");
    expect(screen.getByText(/Provisional — these figures rest on estimated lot costs/)).toBeTruthy();
    expect(screen.getAllByRole("link", { name: "Recost" })[0].getAttribute("href")).toBe("/admin/yield");
  });

  it("REQ-114: no expense recorded → ministry cost and net read UNAVAILABLE, named, never R0,00", () => {
    view([FIXTURE_A_SUNDAY], { writer: false });
    const costCell = within(screen.getByRole("rowheader", { name: "Ministry cost" }).closest("tr")!).getByRole("cell");
    expect(costCell.textContent).toBe("UNAVAILABLE");
    expect(netCell().textContent).toContain("UNAVAILABLE");
    expect(screen.getByText(/no expense has been recorded yet/)).toBeTruthy();
    expect(screen.queryByText(/Provisional — these figures/)).toBeNull();
  });

  it("REQ-109: an absent cost input is named in the UNAVAILABLE line", () => {
    view([{ ...FIXTURE_A_SUNDAY, cogs: { ...FIXTURE_A_SUNDAY.cogs, state: "unavailable", cogsZar: null, absentItemIds: ["inv_oat"], absentItemNames: ["Oat milk"] } }]);
    expect(screen.getByText(/2026-08-16: UNAVAILABLE — Oat milk/)).toBeTruthy();
  });

  it("REQ-158: the day prints cogs_zar whole with outreach beneath it", () => {
    view([{ ...FIXTURE_A_SUNDAY, outreachCogsZar: 2000 }]);
    const dayRow = screen.getByText("2026-08-16").closest("tr")!;
    const text = norm(dayRow.textContent);
    expect(text).toContain("R 196,36");
    expect(text).toContain("of which outreach R 20,00");
  });

  it("an empty period prints zeroes and says there were no orders", () => {
    view([]);
    expect(screen.getByText("No orders this period")).toBeTruthy();
    expect(norm(netCell().textContent)).toContain("R 0,00");
  });
});

// REQ-133 · §7.5 "Deferred: open · settled · written off".
describe("MinistryRollupView — REQ-133 deferred split", () => {
  const deferredCell = () =>
    within(screen.getByRole("rowheader", { name: "Deferred: open · settled · written off" }).closest("tr")!).getByRole("cell");

  it("prints the period's deferred open · settled · written off, zeroes as R0,00", () => {
    view([FIXTURE_A_SUNDAY]);
    expect(norm(deferredCell().textContent)).toBe("R 0,00 · R 0,00 · R 0,00");
  });

  it("prints the split for the period and beneath a day's gross", () => {
    view([{ ...FIXTURE_A_SUNDAY, writtenOffZar: 2500, deferred: { openZar: 3000, settledZar: 2000, writtenOffZar: 2500 } }]);
    expect(norm(deferredCell().textContent)).toBe("R 30,00 · R 20,00 · R 25,00");
    const dayRow = norm(screen.getByText("2026-08-16").closest("tr")!.textContent);
    expect(dayRow).toContain("deferred: R 30,00 open · R 20,00 settled · R 25,00 written off");
  });
});
