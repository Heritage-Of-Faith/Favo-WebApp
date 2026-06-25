// Queue-card payment gate: an unpaid order shows "Take payment" and cannot start
// making; a paid order shows "Start Making". (Rule L01.)

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("next/image", () => ({ default: (p: Record<string, unknown>) => <span data-src={String(p.src ?? "")} /> }));
vi.mock("next/script", () => ({ default: () => null }));
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
vi.mock("@/server/actions/loyalty", () => ({ redeemLoyalty: vi.fn(), topUpWallet: vi.fn(), purchasePack: vi.fn() }));
vi.mock("@/lib/push/staff-subscribe", () => ({ enableStaffPush: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), message: vi.fn() } }));
vi.mock("@/hooks/useOfflineOutbox", () => ({
  useOfflineOutbox: () => ({ pendingOrders: [], pendingCount: 0, syncing: false, queueOrder: vi.fn(), sync: vi.fn(), syncOne: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("@/hooks/useOrderStream", () => ({
  useOrderStream: () => ({ activeOrders: [{ orderId: "ord_1", state: "ordered", lastUpdatedAt: "2026-06-17T08:00:00Z" }], status: "connected" }),
}));
vi.mock("@/store/draftOrder", () => ({
  lineKey: (x: { menuItemId: string }) => x.menuItemId,
  useDraftOrder: () => ({ customer: null, items: [], totalZar: 0, setCustomer: vi.fn(), addItem: vi.fn(), removeItem: vi.fn(), updateQuantity: vi.fn(), reset: vi.fn() }),
}));

import POSWorkspace from "@/components/pos/POSWorkspace";

function fullOrder(paymentStatus: string) {
  return {
    order: {
      id: "ord_1", customerId: null, customerName: null, staffId: "s1",
      state: "ordered", placedAt: "2026-06-17T08:00:00Z", completedAt: null,
      totalZar: 4500, isStaffDiscount: false, paymentStatus,
      items: [{ id: "oi1", menuItemId: "cap", menuItemName: "Cappuccino", quantity: 1, unitPriceZar: 4500, modifications: [] }],
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(navigator, "onLine", { value: true, configurable: true });
  // L01 gate is only active when Yoco is configured — simulate that here.
  process.env.NEXT_PUBLIC_YOCO_PUBLIC_KEY = "pk_test_key";
});

afterEach(() => {
  delete process.env.NEXT_PUBLIC_YOCO_PUBLIC_KEY;
});

async function expandCard() {
  render(<POSWorkspace staffName="Sam" staffId="s1" role="barista" />);
  const card = await screen.findByText("#ORD_1");
  await act(async () => { fireEvent.click(card); });
}

describe("queue payment gate (L01)", () => {
  it("without Yoco key, order can start without Take payment", async () => {
    delete process.env.NEXT_PUBLIC_YOCO_PUBLIC_KEY;
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => fullOrder("pending") }) as unknown as typeof fetch;
    await expandCard();
    expect(await screen.findByRole("button", { name: /start making/i })).toBeDefined();
    expect(screen.queryByRole("button", { name: /take payment/i })).toBeNull();
  });

  it("unpaid order shows Take payment and hides Start Making", async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => fullOrder("pending") }) as unknown as typeof fetch;
    await expandCard();
    expect(await screen.findByRole("button", { name: /take payment/i })).toBeDefined();
    expect(screen.queryByRole("button", { name: /start making/i })).toBeNull();
    expect(screen.getByText(/unpaid/i)).toBeDefined();
  });

  it("paid order shows Start Making and no Take payment", async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => fullOrder("successful") }) as unknown as typeof fetch;
    await expandCard();
    expect(await screen.findByRole("button", { name: /start making/i })).toBeDefined();
    expect(screen.queryByRole("button", { name: /take payment/i })).toBeNull();
    expect(screen.getByText(/paid/i)).toBeDefined();
  });
});
