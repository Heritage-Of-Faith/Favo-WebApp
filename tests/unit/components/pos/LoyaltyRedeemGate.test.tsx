// M18 acceptance — the "Redeem 100 pts" button gate, driven through POSWorkspace.
// Acceptance: a <100-pt customer cannot redeem; a ≥100-pt customer can.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("next/image", () => ({
  default: (props: Record<string, unknown>) =>
    <span data-testid="next-image" data-src={String(props.src ?? "")} />,
}));

const mockCreateOrder = vi.fn();
vi.mock("@/server/actions/orders", () => ({
  createOrder: (...a: unknown[]) => mockCreateOrder(...a),
  transitionOrder: vi.fn(), cancelOrder: vi.fn(), applyStaffDiscount: vi.fn(),
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

// Draft store with a customer + a R30 line so total ≥ R20. Points vary per test.
let CUSTOMER_POINTS = 100;
vi.mock("@/store/draftOrder", () => ({
  lineKey: (x: { menuItemId: string }) => x.menuItemId,
  useDraftOrder: () => ({
    customer: { id: "c1", name: "Thandeka", phone: null, email: null, loyaltyPoints: CUSTOMER_POINTS },
    items: [{ menuItemId: "ame", menuItemName: "Americano", quantity: 1, unitPriceZar: 3000, modifications: [] }],
    totalZar: 3000,
    setCustomer: vi.fn(), addItem: vi.fn(), removeItem: vi.fn(),
    updateQuantity: vi.fn(), reset: vi.fn(),
  }),
}));

import POSWorkspace from "@/components/pos/POSWorkspace";

beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(navigator, "onLine", { value: true, configurable: true });
  mockCreateOrder.mockResolvedValue({ ok: true, data: { orderId: "ord_1", yocoClientSecret: "cs_1" } });
});

async function placeOrderAndReachPayment() {
  render(<POSWorkspace staffName="Sam" staffId="s1" role="barista" />);
  // Phase 5 layout: the place-order button is the running-order "Charge Rxx.xx" CTA.
  const place = await screen.findByRole("button", { name: /^charge r/i });
  await act(async () => { fireEvent.click(place); });
}

describe("M18 — loyalty redeem gate", () => {
  it("enables redemption at 100 pts (total ≥ R20)", async () => {
    CUSTOMER_POINTS = 100;
    await placeOrderAndReachPayment();
    expect(await screen.findByRole("button", { name: /redeem loyalty points/i })).toBeDefined();
  });

  it("hides redemption at 99 pts", async () => {
    CUSTOMER_POINTS = 99;
    await placeOrderAndReachPayment();
    // Payment panel is shown (amount due), but no redeem button.
    expect(await screen.findByText(/amount due/i)).toBeDefined();
    expect(screen.queryByRole("button", { name: /redeem loyalty points/i })).toBeNull();
  });
});
