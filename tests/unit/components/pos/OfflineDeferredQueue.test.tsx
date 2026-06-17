// M19 acceptance — placing an order offline routes through the deferred-payment
// notice and queues to the outbox with paymentMode='yoco_deferred'.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("next/image", () => ({ default: (p: Record<string, unknown>) => <span data-src={String(p.src ?? "")} /> }));
vi.mock("@/server/actions/orders", () => ({ createOrder: vi.fn(), transitionOrder: vi.fn(), cancelOrder: vi.fn(), applyStaffDiscount: vi.fn() }));
vi.mock("@/server/actions/auth", () => ({ signOut: vi.fn() }));
vi.mock("@/server/actions/customers", () => ({ searchCustomer: vi.fn() }));
vi.mock("@/server/actions/menu", () => ({ getMenu: vi.fn().mockResolvedValue({ ok: true, data: [] }) }));
vi.mock("@/server/actions/inventory", () => ({
  listInventory: vi.fn().mockResolvedValue({ ok: true, data: { items: [] } }),
  listLots: vi.fn().mockResolvedValue({ ok: true, data: { lots: [] } }),
  listInventoryStatus: vi.fn().mockResolvedValue({ ok: true, data: { statusMap: {} } }),
  getActiveBeanLot: vi.fn().mockResolvedValue({ ok: true, data: { lot: null } }),
}));
vi.mock("@/server/actions/recipes", () => ({ listRecipes: vi.fn().mockResolvedValue({ ok: true, data: { recipes: [] } }) }));
vi.mock("@/server/actions/waste", () => ({ logWaste: vi.fn() }));
vi.mock("@/lib/push/staff-subscribe", () => ({ enableStaffPush: vi.fn() }));
// POSWorkspace now pulls in the loyalty dialogs (M16/M17/M18) → loyalty actions.
vi.mock("@/server/actions/loyalty", () => ({ topUpWallet: vi.fn(), purchasePack: vi.fn(), redeemLoyalty: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), message: vi.fn() } }));
vi.mock("@/hooks/useOrderStream", () => ({ useOrderStream: () => ({ activeOrders: [], status: "connected" }) }));

const mockQueueOrder = vi.fn().mockResolvedValue(undefined);
vi.mock("@/hooks/useOfflineOutbox", () => ({
  useOfflineOutbox: () => ({
    pendingOrders: [], pendingCount: 0, syncing: false,
    queueOrder: mockQueueOrder, sync: vi.fn(), syncOne: vi.fn(), refresh: vi.fn(),
  }),
}));

const mockReset = vi.fn();
vi.mock("@/store/draftOrder", () => ({
  lineKey: (x: { menuItemId: string }) => x.menuItemId,
  useDraftOrder: () => ({
    customer: { id: "c1", name: "Sipho", phone: null, email: null, loyaltyPoints: 0 },
    items: [{ menuItemId: "ame", menuItemName: "Americano", quantity: 2, unitPriceZar: 3000, modifications: [] }],
    totalZar: 6000,
    setCustomer: vi.fn(), addItem: vi.fn(), removeItem: vi.fn(), updateQuantity: vi.fn(), reset: mockReset,
  }),
}));

import POSWorkspace from "@/components/pos/POSWorkspace";

beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(navigator, "onLine", { value: false, configurable: true });
});

describe("M19 — offline deferred queue", () => {
  it("Place Order offline → deferred notice → confirm queues yoco_deferred", async () => {
    render(<POSWorkspace staffName="Sam" staffId="s1" />);

    const place = await screen.findByRole("button", { name: /place order/i });
    await act(async () => { fireEvent.click(place); });

    // Deferred-payment notice is shown instead of Yoco.
    expect(await screen.findByText(/no connection/i)).toBeDefined();

    const confirm = screen.getByRole("button", { name: /confirm — paid in person/i });
    await act(async () => { fireEvent.click(confirm); });

    await waitFor(() => expect(mockQueueOrder).toHaveBeenCalledTimes(1));
    const arg = mockQueueOrder.mock.calls[0][0];
    expect(arg.paymentMode).toBe("yoco_deferred");
    expect(arg.staffId).toBe("s1");
    expect(arg.clientTotalZar).toBe(6000);
    expect(arg.items).toHaveLength(1);
    expect(mockReset).toHaveBeenCalled();
  });
});
