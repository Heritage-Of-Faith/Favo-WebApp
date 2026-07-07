// Unit tests for the N13 customer dashboard cards (AT-65).
// Pure presentational components — rendered with sample data, no DB/session.

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import LoyaltyCard from "@/components/customer/LoyaltyCard";
import LoyaltyValueCard from "@/components/customer/LoyaltyValueCard";
import PackList from "@/components/customer/PackList";
import OrderHistoryList from "@/components/customer/OrderHistoryList";
import type { CustomerOrder } from "@/lib/customer/contract";

describe("LoyaltyCard", () => {
  it("shows the points integer prominently", () => {
    render(<LoyaltyCard points={45} />);
    expect(screen.getByText("45")).toBeInTheDocument();
    expect(screen.getByText(/55 points to your next R20 reward/i)).toBeInTheDocument();
  });

  it("shows reward-ready message once at/over 100", () => {
    render(<LoyaltyCard points={120} />);
    expect(screen.getByText("120")).toBeInTheDocument();
    expect(screen.getByText(/1 reward ready — R20 off/i)).toBeInTheDocument();
  });
});

describe("LoyaltyValueCard", () => {
  it("shows R20 for 100 pts (one whole redemption unit) and redeem prompt", () => {
    render(<LoyaltyValueCard loyaltyPoints={100} />);
    expect(screen.getByText(/20,00/)).toBeInTheDocument();
    expect(screen.getByText(/redeem at the counter/i)).toBeInTheDocument();
  });

  it("floors to whole redemption units: 250 pts shows R40 (2 units), not R50", () => {
    render(<LoyaltyValueCard loyaltyPoints={250} />);
    expect(screen.getByText(/40,00/)).toBeInTheDocument();
    expect(screen.getByText(/redeem at the counter/i)).toBeInTheDocument();
  });

  it("shows R0 and not-enough message when under 100 pts", () => {
    render(<LoyaltyValueCard loyaltyPoints={45} />);
    expect(screen.getByText(/0,00/)).toBeInTheDocument();
    expect(screen.getByText(/not enough points to redeem yet/i)).toBeInTheDocument();
  });
});

describe("PackList", () => {
  it("shows the active pack count", () => {
    render(<PackList activePackCount={2} />);
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText(/2 active packs ready to use/i)).toBeInTheDocument();
  });

  it("shows a friendly empty state at zero", () => {
    render(<PackList activePackCount={0} />);
    expect(screen.getByText(/no active packs/i)).toBeInTheDocument();
  });
});

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
