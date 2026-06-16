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
