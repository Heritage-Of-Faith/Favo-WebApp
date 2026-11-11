// Unit tests for TodayCard (M12)

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

const mockGetPosToday = vi.fn();
vi.mock("@/server/actions/pos-summary", () => ({
  getPosToday: (...a: unknown[]) => mockGetPosToday(...a),
}));

import TodayCard from "@/components/pos/TodayCard";

beforeEach(() => {
  vi.clearAllMocks();
  mockGetPosToday.mockResolvedValue({
    ok: true,
    data: { date: "2026-05-31", orderCount: 12, revenueZar: 48000, wasteCount: 3 },
  });
});

describe("TodayCard", () => {
  it("pulls the summary endpoint exactly once on mount", async () => {
    render(<TodayCard />);
    await waitFor(() => expect(mockGetPosToday).toHaveBeenCalledTimes(1));
  });

  it("renders order count, revenue, and waste count", async () => {
    render(<TodayCard />);
    expect(await screen.findByText("12")).toBeDefined();
    // 48000 cents → R480,00 (exact spacing is locale-dependent)
    expect(screen.getByText(/480,00/)).toBeDefined();
    expect(screen.getByText("3")).toBeDefined();
  });
});

// REQ-128 / REQ-129 (PRD §7.5): every line, the fee/net UNAVAILABLE state, and
// the zero state are three distinct renderings; the screen is a read.
describe("TodayCard — REQ-128 Day summary", () => {
  const FULL = {
    date: "2026-11-08", orderCount: 13, revenueZar: 26000, wasteCount: 0,
    drinks: 17, feeZar: null, netSettledZar: null, writtenOffZar: 2000, compsZar: 1500,
    entitlementCups: 4, walkInCups: 2,
  };

  it("shows orders, drinks, gross, fee, net, write-offs, comps, entitlement cups and walk-in cups", async () => {
    mockGetPosToday.mockResolvedValue({ ok: true, data: FULL });
    render(<TodayCard />);
    for (const label of ["Orders", "Drinks", "Gross", "Card fees", "Net settled", "Written off", "Comps", "Entitlement cups", "Walk-in cups"]) {
      expect(await screen.findByText(label)).toBeDefined();
    }
    expect(screen.getByText("17")).toBeDefined();
    expect(screen.getByText(/260,00/)).toBeDefined();
    expect(screen.getByText(/20,00/)).toBeDefined();
    expect(screen.getByText(/15,00/)).toBeDefined();
  });

  it("REQ-129: fee and net not imported yet read UNAVAILABLE with 'settles overnight' — never R0.00", async () => {
    mockGetPosToday.mockResolvedValue({ ok: true, data: FULL });
    render(<TodayCard />);
    expect((await screen.findAllByText("UNAVAILABLE")).length).toBe(2);
    expect(screen.getAllByText("settles overnight").length).toBe(2);
    expect(screen.queryByText(/^R\s?0,00$/)).toBeNull();
  });

  it("REQ-129: a day with no orders shows zeroes, not UNAVAILABLE", async () => {
    mockGetPosToday.mockResolvedValue({
      ok: true,
      data: {
        ...FULL, orderCount: 0, revenueZar: 0, drinks: 0, feeZar: 0, netSettledZar: 0, writtenOffZar: 0, compsZar: 0, entitlementCups: 0, walkInCups: 0,
        deferredOpenZar: 0, deferredSettledZar: 0, deferredWrittenOffZar: 0,
      },
    });
    render(<TodayCard />);
    await screen.findByText("Card fees");
    expect(screen.queryByText("UNAVAILABLE")).toBeNull();
    // Five money lines plus §7.5's "Deferred: open · settled · written off" (REQ-133).
    expect(screen.getAllByText(/0,00/).length).toBe(6);
    expect(screen.getByText("Deferred: open · settled · written off")).toBeTruthy();
  });

  it("is a read: the only buttons are Back and Refresh — nothing confirms or ends the day", async () => {
    mockGetPosToday.mockResolvedValue({ ok: true, data: FULL });
    render(<TodayCard />);
    await screen.findByText("Drinks");
    expect(screen.getAllByRole("button").map((b) => b.getAttribute("aria-label"))).toEqual(["Back to POS", "Refresh"]);
  });
});
