// M4/AT-13 — payment view wiring through POSWorkspace:
//  - a paid order (total > 0, checkout id present) renders the Yoco card form
//  - a free order (staff-discount zeroes total) skips the form

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("next/image", () => ({ default: (p: Record<string, unknown>) => <span data-src={String(p.src ?? "")} /> }));
vi.mock("next/script", () => ({ default: () => null }));

const mockCreateOrder = vi.fn();
vi.mock("@/server/actions/orders", () => ({
  createOrder: (...a: unknown[]) => mockCreateOrder(...a),
  transitionOrder: vi.fn(), cancelOrder: vi.fn(),
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
vi.mock("@/lib/push/staff-subscribe", () => ({ enableStaffPush: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), message: vi.fn() } }));
vi.mock("@/hooks/useOrderStream", () => ({ useOrderStream: () => ({ activeOrders: [], status: "connected" }) }));
vi.mock("@/hooks/useOfflineOutbox", () => ({
  useOfflineOutbox: () => ({ pendingOrders: [], pendingCount: 0, syncing: false, queueOrder: vi.fn(), sync: vi.fn(), syncOne: vi.fn(), refresh: vi.fn() }),
}));

let TOTAL = 6000;
let CUSTOMER: { id: string; name: string } | null = null;
vi.mock("@/store/draftOrder", () => ({
  lineKey: (x: { menuItemId: string }) => x.menuItemId,
  useDraftOrder: () => ({
    get customer() { return CUSTOMER; },
    items: [{ menuItemId: "ame", menuItemName: "Americano", quantity: 2, unitPriceZar: 3000, modifications: [] }],
    get totalZar() { return TOTAL; },
    setCustomer: vi.fn(), addItem: vi.fn(), removeItem: vi.fn(), updateQuantity: vi.fn(), reset: vi.fn(),
  }),
}));

import POSWorkspace from "@/components/pos/POSWorkspace";

beforeEach(() => {
  vi.clearAllMocks();
  TOTAL = 6000;
  CUSTOMER = null;
  process.env.NEXT_PUBLIC_YOCO_PUBLIC_KEY = "pk_test_123";
  (globalThis as unknown as { YocoSDK?: unknown }).YocoSDK = function () { return { showPopup: vi.fn() }; } as unknown;
  Object.defineProperty(navigator, "onLine", { value: true, configurable: true });
});

async function placeOrder() {
  render(<POSWorkspace staffName="Sam" staffId="s1" role="barista" />);
  // L28 / REQ-046: no customer attached, so the barista taps "No notification".
  await act(async () => { fireEvent.click(await screen.findByRole("button", { name: "No notification" })); });
  // Phase 5 layout: the place-order button is the running-order "Charge Rxx.xx" CTA.
  await act(async () => { fireEvent.click(await screen.findByRole("button", { name: /^charge r/i })); });
}

describe("L28 notification target at ring-up (REQ-046)", () => {
  it("Charge stays disabled until a target is bound; 'No notification' sends target 'none'", async () => {
    mockCreateOrder.mockResolvedValue({ ok: true, data: { orderId: "ord_n", yocoClientSecret: "" } });
    render(<POSWorkspace staffName="Sam" staffId="s1" role="barista" />);
    const charge = await screen.findByRole("button", { name: /^charge r/i });
    expect((charge as HTMLButtonElement).disabled).toBe(true);
    await act(async () => { fireEvent.click(charge); });
    expect(mockCreateOrder).not.toHaveBeenCalled();

    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "No notification" })); });
    expect((charge as HTMLButtonElement).disabled).toBe(false);
    await act(async () => { fireEvent.click(charge); });
    expect(mockCreateOrder).toHaveBeenCalledTimes(1);
    expect(mockCreateOrder.mock.calls[0][0]).toMatchObject({ notificationTarget: "none", customerId: undefined });
  });

  it("'none' then attach a customer then detach: Charge needs a fresh tap, never falls back to 'none'", async () => {
    const view = render(<POSWorkspace staffName="Sam" staffId="s1" role="barista" />);
    await act(async () => { fireEvent.click(await screen.findByRole("button", { name: "No notification" })); });
    CUSTOMER = { id: "cust_naledi", name: "Naledi" };
    await act(async () => { view.rerender(<POSWorkspace staffName="Sam" staffId="s1" role="barista" />); });
    CUSTOMER = null;
    await act(async () => { view.rerender(<POSWorkspace staffName="Sam" staffId="s1" role="barista" />); });
    const charge = screen.getByRole("button", { name: /^charge r/i });
    expect((charge as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole("button", { name: "No notification" })).toBeDefined();
  });
});

describe("M4 payment view wiring", () => {
  it("renders the Yoco card form for a paid order with a checkout id", async () => {
    mockCreateOrder.mockResolvedValue({ ok: true, data: { orderId: "ord_1", yocoClientSecret: "chk_abc" } });
    await placeOrder();
    expect(await screen.findByRole("button", { name: /charge card/i })).toBeDefined();
  });

  it("falls back to manual confirm when there is no checkout id", async () => {
    // No Yoco key path returns empty secret → handlePlaceOrder shows manual toast,
    // never opens the payment view. Verify createOrder still succeeds without a form.
    mockCreateOrder.mockResolvedValue({ ok: true, data: { orderId: "ord_2", yocoClientSecret: "" } });
    await placeOrder();
    expect(screen.queryByRole("button", { name: /charge card/i })).toBeNull();
  });
});
