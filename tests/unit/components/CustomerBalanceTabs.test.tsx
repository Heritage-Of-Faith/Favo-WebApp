// Unit tests for CustomerBalanceTabs (AT-79, A17)
// Verifies tab switching, empty states, data rendering, and no mutation surfaces.

import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import CustomerBalanceTabs from "@/components/admin/CustomerBalanceTabs";
import type { CustomerBalanceTabsProps } from "@/components/admin/CustomerBalanceTabs";

const EMPTY: CustomerBalanceTabsProps = {
  loyaltyTxns: [],
  activePacks: [],
  expiredPacks: [],
  recentOrders: [],
};

const ORDER = {
  id: "aabbccdd-1234-5678-abcd-ef0123456789",
  state: "completed",
  totalZar: 4500,
  placedAt: "2026-06-01T08:00:00+02:00",
};

const LOYALTY_TXN = {
  id: "lt1",
  delta: 10,
  kind: "earn",
  orderId: ORDER.id,
  at: "2026-06-01T08:00:00+02:00",
};

const ACTIVE_PACK = {
  id: "pk1",
  menuItemName: "Flat White",
  qtyOriginal: 10,
  qtyRemaining: 7,
  expiresAt: "2026-09-01T00:00:00+02:00",
};

const EXPIRED_PACK = {
  id: "pk2",
  menuItemName: "Espresso",
  qtyOriginal: 5,
  qtyRemaining: 0,
  expiresAt: "2025-01-01T00:00:00+02:00",
};

describe("CustomerBalanceTabs — tab navigation", () => {
  it("renders all 3 tab buttons", () => {
    render(<CustomerBalanceTabs {...EMPTY} />);
    expect(screen.getByRole("tab", { name: /orders/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /loyalty/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /packs/i })).toBeInTheDocument();
  });

  it("Orders tab is selected by default", () => {
    render(<CustomerBalanceTabs {...EMPTY} />);
    expect(screen.getByRole("tab", { name: /orders/i })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: /loyalty/i })).toHaveAttribute("aria-selected", "false");
  });

  it("switching to Loyalty tab makes it selected", () => {
    render(<CustomerBalanceTabs {...EMPTY} />);
    fireEvent.click(screen.getByRole("tab", { name: /loyalty/i }));
    expect(screen.getByRole("tab", { name: /loyalty/i })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: /orders/i })).toHaveAttribute("aria-selected", "false");
  });

  it("switching to Packs tab makes it selected", () => {
    render(<CustomerBalanceTabs {...EMPTY} />);
    fireEvent.click(screen.getByRole("tab", { name: /packs/i }));
    expect(screen.getByRole("tab", { name: /packs/i })).toHaveAttribute("aria-selected", "true");
  });
});

describe("CustomerBalanceTabs — empty states", () => {
  it("shows empty state for orders when list is empty", () => {
    render(<CustomerBalanceTabs {...EMPTY} />);
    expect(screen.getByText(/no orders yet/i)).toBeInTheDocument();
  });

  it("shows empty state for loyalty when list is empty", () => {
    render(<CustomerBalanceTabs {...EMPTY} />);
    fireEvent.click(screen.getByRole("tab", { name: /loyalty/i }));
    expect(screen.getByText(/no loyalty transactions/i)).toBeInTheDocument();
  });

  it("shows empty state for packs when both lists are empty", () => {
    render(<CustomerBalanceTabs {...EMPTY} />);
    fireEvent.click(screen.getByRole("tab", { name: /packs/i }));
    expect(screen.getByText(/no coffee packs/i)).toBeInTheDocument();
  });
});

describe("CustomerBalanceTabs — data rendering", () => {
  it("renders an order row with truncated ID and formatted total", () => {
    render(<CustomerBalanceTabs {...EMPTY} recentOrders={[ORDER]} />);
    // Truncated id: first 8 chars
    expect(screen.getByText(/aabbccdd…/)).toBeInTheDocument();
    // State label
    expect(screen.getByText("Completed")).toBeInTheDocument();
    // Total: 4500 cents = R 45.00
    expect(screen.getByText(/R 45/)).toBeInTheDocument();
  });

  it("renders a loyalty transaction with +delta for earn", () => {
    render(<CustomerBalanceTabs {...EMPTY} loyaltyTxns={[LOYALTY_TXN]} />);
    fireEvent.click(screen.getByRole("tab", { name: /loyalty/i }));
    expect(screen.getByText("Earned")).toBeInTheDocument();
    expect(screen.getByText("+10")).toBeInTheDocument();
  });

  it("renders active and expired packs under the Packs tab", () => {
    render(
      <CustomerBalanceTabs
        {...EMPTY}
        activePacks={[ACTIVE_PACK]}
        expiredPacks={[EXPIRED_PACK]}
      />
    );
    fireEvent.click(screen.getByRole("tab", { name: /packs/i }));
    expect(screen.getByText("Flat White")).toBeInTheDocument();
    expect(screen.getByText(/7\/10/)).toBeInTheDocument();
    expect(screen.getByText("Espresso")).toBeInTheDocument();
    expect(screen.getByText(/0\/5/)).toBeInTheDocument();
  });

  it("shows Active and Expired headings when both lists have items", () => {
    render(
      <CustomerBalanceTabs
        {...EMPTY}
        activePacks={[ACTIVE_PACK]}
        expiredPacks={[EXPIRED_PACK]}
      />
    );
    fireEvent.click(screen.getByRole("tab", { name: /packs/i }));
    expect(screen.getByText("Active")).toBeInTheDocument();
    expect(screen.getByText("Expired")).toBeInTheDocument();
  });
});

describe("CustomerBalanceTabs — no mutation surfaces", () => {
  it("renders no form elements", () => {
    const { container } = render(
      <CustomerBalanceTabs
        recentOrders={[ORDER]}
        loyaltyTxns={[LOYALTY_TXN]}
        activePacks={[ACTIVE_PACK]}
        expiredPacks={[EXPIRED_PACK]}
      />
    );
    expect(container.querySelectorAll("form")).toHaveLength(0);
    expect(container.querySelectorAll("input")).toHaveLength(0);
  });

  it("renders no action buttons (only tab buttons)", () => {
    render(
      <CustomerBalanceTabs
        recentOrders={[ORDER]}
        loyaltyTxns={[LOYALTY_TXN]}
        activePacks={[ACTIVE_PACK]}
        expiredPacks={[EXPIRED_PACK]}
      />
    );
    // Only the 3 tab buttons should be present — no action buttons (tabs use role="tab")
    const tabs = screen.getAllByRole("tab");
    expect(tabs).toHaveLength(3);
    // No submit/action buttons exist
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });
});
