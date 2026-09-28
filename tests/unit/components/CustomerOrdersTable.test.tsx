// Unit tests for CustomerOrdersTable (AT-79, A17)
// Verifies empty state, data rendering, and no mutation surfaces.
// Rehomed from CustomerBalanceTabs.test.tsx: the Loyalty and Packs tabs were
// deleted along with those features, leaving a single Orders table (no tabs).

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import CustomerOrdersTable from "@/components/admin/CustomerOrdersTable";
import type { CustomerOrdersTableProps } from "@/components/admin/CustomerOrdersTable";

const EMPTY: CustomerOrdersTableProps = {
  recentOrders: [],
};

const ORDER = {
  id: "aabbccdd-1234-5678-abcd-ef0123456789",
  state: "completed",
  totalZar: 4500,
  placedAt: "2026-06-01T08:00:00+02:00",
};

describe("CustomerOrdersTable — empty state", () => {
  it("shows empty state for orders when list is empty", () => {
    render(<CustomerOrdersTable {...EMPTY} />);
    expect(screen.getByText(/no orders yet/i)).toBeInTheDocument();
  });
});

describe("CustomerOrdersTable — data rendering", () => {
  it("renders an order row with truncated ID and formatted total", () => {
    render(<CustomerOrdersTable recentOrders={[ORDER]} />);
    // Truncated id: first 8 chars
    expect(screen.getByText(/aabbccdd…/)).toBeInTheDocument();
    // State label
    expect(screen.getByText("Completed")).toBeInTheDocument();
    // Total: 4500 cents = R 45.00
    expect(screen.getByText(/R 45/)).toBeInTheDocument();
  });
});

describe("CustomerOrdersTable — no mutation surfaces", () => {
  it("renders no form elements or buttons", () => {
    const { container } = render(<CustomerOrdersTable recentOrders={[ORDER]} />);
    expect(container.querySelectorAll("form")).toHaveLength(0);
    expect(container.querySelectorAll("input")).toHaveLength(0);
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });
});
