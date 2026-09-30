// Unit tests for the N13 customer dashboard cards (AT-65).
// Pure presentational components — rendered with sample data, no DB/session.
// LoyaltyCard and PackList were deleted along with the loyalty/packs features.

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import OrderHistoryList from "@/components/customer/OrderHistoryList";
import type { CustomerOrder } from "@/lib/customer/contract";

describe("OrderHistoryList", () => {
  const sampleOrders: CustomerOrder[] = [
    {
      id: "ord_1",
      state: "ready",
      placedAt: "2026-06-15T10:30:00+02:00",
      completedAt: null,
      totalZar: 4500,
      items: [
        { id: "oi_1", menuItemId: "m1", menuItemName: "Cappuccino", quantity: 1, unitPriceZar: 4500, modifications: [] },
      ],
    },
  ];

  it("shows the empty-state invite when there are no orders", () => {
    render(<OrderHistoryList orders={[]} />);
    expect(screen.getByText(/your first order is on us/i)).toBeInTheDocument();
  });

  it("renders order total, item summary and a friendly state label", () => {
    render(<OrderHistoryList orders={sampleOrders} />);
    expect(screen.getByText(/45,00/)).toBeInTheDocument();
    expect(screen.getByText(/1× Cappuccino/)).toBeInTheDocument();
    expect(screen.getByText(/ready for collection/i)).toBeInTheDocument();
  });
});
