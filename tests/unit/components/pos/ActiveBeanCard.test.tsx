// Unit tests for ActiveBeanCard (M11)

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

const mockGetActiveBeanLot = vi.fn();
vi.mock("@/server/actions/inventory", () => ({
  getActiveBeanLot: (...a: unknown[]) => mockGetActiveBeanLot(...a),
}));

import ActiveBeanCard from "@/components/pos/ActiveBeanCard";

function lot(roastDaysAgo: number) {
  const d = new Date();
  d.setDate(d.getDate() - roastDaysAgo);
  return {
    id: "lot_beans_1",
    inventoryItemId: "inv_item_espresso_beans",
    inventoryItemName: "Espresso Beans",
    sourceName: "Konga",
    batchNumber: "YRG-014",
    roastDate: d.toISOString(),
    receivedAt: new Date().toISOString(),
    state: "active" as const,
    origin: "Yirgacheffe · Konga",
    unitCostZar: "45000",
    quantityReceived: "1000",
    quantityRemaining: 800,
  };
}

beforeEach(() => vi.clearAllMocks());

describe("ActiveBeanCard", () => {
  it("renders origin and batch for the active lot", async () => {
    mockGetActiveBeanLot.mockResolvedValue({ ok: true, data: { lot: lot(3) } });
    render(<ActiveBeanCard />);
    expect(await screen.findByText("Yirgacheffe · Konga")).toBeDefined();
    expect(screen.getByText(/YRG-014/)).toBeDefined();
  });

  it("shows a freshness warning for a lot 15 days post-roast (T02 stale)", async () => {
    mockGetActiveBeanLot.mockResolvedValue({ ok: true, data: { lot: lot(15) } });
    render(<ActiveBeanCard />);
    expect(await screen.findByText(/past peak/i)).toBeDefined();
  });

  it("shows no freshness badge for a fresh lot (3 days)", async () => {
    mockGetActiveBeanLot.mockResolvedValue({ ok: true, data: { lot: lot(3) } });
    render(<ActiveBeanCard />);
    await screen.findByText("Yirgacheffe · Konga");
    expect(screen.queryByText(/past peak/i)).toBeNull();
    expect(screen.queryByText(/ageing/i)).toBeNull();
  });

  it("renders nothing when there is no active lot", async () => {
    mockGetActiveBeanLot.mockResolvedValue({ ok: true, data: { lot: null } });
    const { container } = render(<ActiveBeanCard />);
    await waitFor(() => expect(mockGetActiveBeanLot).toHaveBeenCalled());
    expect(container.firstChild).toBeNull();
  });
});
