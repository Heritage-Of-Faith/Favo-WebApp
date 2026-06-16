// M15 — SyncDrawer list + actions

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import SyncDrawer from "@/components/pos/SyncDrawer";
import type { OfflineOrder } from "@/hooks/useOfflineOutbox";

const ORDERS: OfflineOrder[] = [
  { clientUuid: "a", staffId: "s1", items: [{ menuItemId: "m1", quantity: 2, modifications: [] }], paymentMode: "yoco_deferred", clientTotalZar: 6000, clientTimestamp: "2026-06-15T08:00:00Z" },
  { clientUuid: "b", staffId: "s1", items: [{ menuItemId: "m2", quantity: 1, modifications: [] }], paymentMode: "wallet", clientTotalZar: 3000, clientTimestamp: "2026-06-15T09:00:00Z" },
];

function base() {
  return { open: true, orders: ORDERS, syncing: false, onSyncAll: vi.fn(), onRetry: vi.fn(), onClose: vi.fn() };
}

describe("SyncDrawer", () => {
  it("renders nothing when closed", () => {
    const { container } = render(<SyncDrawer {...base()} open={false} />);
    expect(container.firstChild).toBeNull();
  });

  it("lists queued orders with totals", () => {
    render(<SyncDrawer {...base()} />);
    expect(screen.getByText(/60,00/)).toBeDefined();
    expect(screen.getByText(/30,00/)).toBeDefined();
    expect(screen.getByText(/2 items/)).toBeDefined();
  });

  it("shows an empty state when the queue is clear", () => {
    render(<SyncDrawer {...base()} orders={[]} />);
    expect(screen.getByText(/everything is synced/i)).toBeDefined();
  });

  it("per-item retry calls onRetry with the clientUuid", () => {
    const props = base();
    render(<SyncDrawer {...props} />);
    const retryButtons = screen.getAllByRole("button", { name: /retry this order/i });
    fireEvent.click(retryButtons[0]);
    expect(props.onRetry).toHaveBeenCalledWith("a");
  });

  it("Sync now calls onSyncAll", () => {
    const props = base();
    render(<SyncDrawer {...props} />);
    fireEvent.click(screen.getByRole("button", { name: /sync now/i }));
    expect(props.onSyncAll).toHaveBeenCalledOnce();
  });
});
