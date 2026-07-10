// AT-139 — the POS shows the attached customer's loyalty balance money-first:
// "Loyalty balance: R20,00 (100 pts)" — never a bare points count, never "wallet".

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { formatZar } from "@/lib/format";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("next/image", () => ({ default: (p: Record<string, unknown>) => <span data-src={String(p.src ?? "")} /> }));

vi.mock("@/server/actions/orders", () => ({
  createOrder: vi.fn(), transitionOrder: vi.fn(), cancelOrder: vi.fn(), applyStaffDiscount: vi.fn(),
}));
vi.mock("@/server/actions/auth", () => ({ signOut: vi.fn() }));
vi.mock("@/server/actions/favo", () => ({ getFavo: vi.fn().mockResolvedValue({ ok: true, data: { favo: null } }), setFavo: vi.fn(), clearFavo: vi.fn() }));
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
vi.mock("@/server/actions/loyalty", () => ({ redeemLoyalty: vi.fn(), purchasePack: vi.fn() }));
vi.mock("@/lib/push/staff-subscribe", () => ({ enableStaffPush: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), message: vi.fn() } }));
vi.mock("@/hooks/useOrderStream", () => ({ useOrderStream: () => ({ activeOrders: [], status: "connected" }) }));
vi.mock("@/hooks/useOfflineOutbox", () => ({
  useOfflineOutbox: () => ({ pendingOrders: [], pendingCount: 0, syncing: false, queueOrder: vi.fn(), sync: vi.fn(), syncOne: vi.fn(), refresh: vi.fn() }),
}));

vi.mock("@/store/draftOrder", () => ({
  lineKey: (x: { menuItemId: string }) => x.menuItemId,
  useDraftOrder: () => ({
    customer: { id: "c1", name: "Thandeka", phone: null, email: null, loyaltyPoints: 250 },
    items: [],
    totalZar: 0,
    setCustomer: vi.fn(), addItem: vi.fn(), removeItem: vi.fn(), updateQuantity: vi.fn(), reset: vi.fn(),
  }),
}));

import POSWorkspace from "@/components/pos/POSWorkspace";

beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(navigator, "onLine", { value: true, configurable: true });
});

describe("AT-139 — POS loyalty balance display", () => {
  it("shows the attached customer's balance money-first with points parenthetical", async () => {
    render(<POSWorkspace staffName="Sam" staffId="s1" role="barista" />);
    // 250 pts → two whole 100-pt units → R40,00 redeemable.
    const expected = `Loyalty balance: ${formatZar(4000)} (250 pts)`;
    const line = await screen.findByText(
      (_, el) => el?.tagName === "P" && el.textContent === expected
    );
    expect(line).toBeDefined();
  });

  it("never renders the word wallet", async () => {
    const { container } = render(<POSWorkspace staffName="Sam" staffId="s1" role="barista" />);
    await screen.findByText(/loyalty balance:/i);
    expect(container.textContent?.toLowerCase()).not.toContain("wallet");
  });
});
