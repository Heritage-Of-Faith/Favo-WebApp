// AT-144 — barista Favo on the POS: one-tap "Reorder their Favo" replays the
// saved template into the draft order (resolving customisation ids, duplicates
// preserved), and "Manage Favo" opens the shared picker as a blocking modal.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("next/image", () => ({ default: (p: Record<string, unknown>) => <span data-src={String(p.src ?? "")} /> }));

vi.mock("@/server/actions/orders", () => ({
  createOrder: vi.fn(), transitionOrder: vi.fn(), cancelOrder: vi.fn(), applyStaffDiscount: vi.fn(),
}));
vi.mock("@/server/actions/auth", () => ({ signOut: vi.fn() }));
vi.mock("@/server/actions/customers", () => ({ searchCustomer: vi.fn() }));
vi.mock("@/server/actions/inventory", () => ({
  listInventory: vi.fn().mockResolvedValue({ ok: true, data: { items: [] } }),
  listLots: vi.fn().mockResolvedValue({ ok: true, data: { lots: [] } }),
  listInventoryStatus: vi.fn().mockResolvedValue({ ok: true, data: { statusMap: {} } }),
  getActiveBeanLot: vi.fn().mockResolvedValue({ ok: true, data: { lot: null } }),
}));
vi.mock("@/server/actions/recipes", () => ({ listRecipes: vi.fn().mockResolvedValue({ ok: true, data: { recipes: [] } }) }));
vi.mock("@/server/actions/waste", () => ({ logWaste: vi.fn() }));
vi.mock("@/server/actions/loyalty", () => ({ redeemLoyalty: vi.fn(), purchasePack: vi.fn() }));
vi.mock("@/lib/push/staff-subscribe", () => ({ enableStaffPush: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), message: vi.fn() } }));
vi.mock("@/hooks/useOrderStream", () => ({ useOrderStream: () => ({ activeOrders: [], status: "connected" }) }));
vi.mock("@/hooks/useOfflineOutbox", () => ({
  useOfflineOutbox: () => ({ pendingOrders: [], pendingCount: 0, syncing: false, queueOrder: vi.fn(), sync: vi.fn(), syncOne: vi.fn(), refresh: vi.fn() }),
}));

const MOCHA = vi.hoisted(() => ({
  id: "menu_mocha", name: "Mocha", category: "coffee", active: true, currentPriceZar: 2500, recipeId: null,
  customisations: [
    { id: "mod_mac", name: "Macadamia Milk", priceDeltaZar: 0, substitutesInventoryItemId: "inv_mac", addsInventoryItemId: null, addsQuantity: null },
    { id: "mod_shot", name: "Extra Shot", priceDeltaZar: 1000, substitutesInventoryItemId: null, addsInventoryItemId: "inv_beans", addsQuantity: 1 },
  ],
}));
vi.mock("@/server/actions/menu", () => ({
  getMenu: vi.fn().mockResolvedValue({ ok: true, data: [MOCHA] }),
}));

const FAVO = {
  items: [{ menuItemId: "menu_mocha", quantity: 1, modifications: ["mod_mac", "mod_shot", "mod_shot"] }],
  updatedAt: "2026-07-09T10:00:00.000Z",
  updatedByStaffId: null,
};
const mockGetFavo = vi.fn();
vi.mock("@/server/actions/favo", () => ({
  getFavo: (...a: unknown[]) => mockGetFavo(...a),
  setFavo: vi.fn(),
  clearFavo: vi.fn(),
}));

const mockAddItem = vi.fn();
vi.mock("@/store/draftOrder", () => ({
  lineKey: (x: { menuItemId: string }) => x.menuItemId,
  useDraftOrder: () => ({
    customer: { id: "c1", name: "Louis", phone: null, email: null, loyaltyPoints: 240 },
    items: [],
    totalZar: 0,
    setCustomer: vi.fn(), addItem: mockAddItem, removeItem: vi.fn(), updateQuantity: vi.fn(), reset: vi.fn(),
  }),
}));

import POSWorkspace from "@/components/pos/POSWorkspace";

beforeEach(() => {
  vi.clearAllMocks();
  mockGetFavo.mockResolvedValue({ ok: true, data: { favo: FAVO } });
  Object.defineProperty(navigator, "onLine", { value: true, configurable: true });
});

describe("AT-144 — Favo on the POS", () => {
  it("one-tap reorder replays the template with resolved customisations", async () => {
    render(<POSWorkspace staffName="Sam" staffId="s1" role="barista" />);
    const btn = await screen.findByRole("button", { name: /reorder their favo/i });
    await act(async () => { fireEvent.click(btn); });

    expect(mockGetFavo).toHaveBeenCalledWith("c1");
    expect(mockAddItem).toHaveBeenCalledTimes(1);
    const arg = mockAddItem.mock.calls[0][0];
    expect(arg.menuItemId).toBe("menu_mocha");
    expect(arg.unitPriceZar).toBe(2500);
    expect(arg.quantity).toBe(1);
    // ids resolved to live objects, duplicates preserved (Extra Shot ×2)
    expect(arg.modifications.map((m: { id: string }) => m.id)).toEqual(["mod_mac", "mod_shot", "mod_shot"]);
  });

  it("hides the reorder CTA when the customer has no Favo, but Manage Favo still opens the picker", async () => {
    mockGetFavo.mockResolvedValue({ ok: true, data: { favo: null } });
    render(<POSWorkspace staffName="Sam" staffId="s1" role="barista" />);

    const manage = await screen.findByRole("button", { name: /manage favo/i });
    expect(screen.queryByRole("button", { name: /reorder their favo/i })).toBeNull();

    await act(async () => { fireEvent.click(manage); });
    const dialog = await screen.findByRole("dialog", { name: /manage louis's favo/i });
    expect(dialog).toBeDefined();
    // The shared picker renders inside, titled for this customer.
    expect(screen.getByRole("heading", { name: /louis's favo/i })).toBeDefined();
  });
});
