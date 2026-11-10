// The POS under an event in force — PRD v7.0 §6.6, §6.0.8 (T7), L25, REQ-045.
// REQ-045: "no card prompt appears" under payment_posture='free'. §6.6 menu
// scope: the till shows the event's menu (the server refuses the rest).

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("next/image", () => ({ default: (p: Record<string, unknown>) => <span data-src={String(p.src ?? "")} /> }));
vi.mock("next/script", () => ({ default: () => null }));

vi.mock("@/server/actions/orders", () => ({
  createOrder: vi.fn(), declineFreeCoffee: vi.fn(), transitionOrder: vi.fn(), cancelOrder: vi.fn(),
}));
vi.mock("@/server/actions/tender", () => ({
  beginTender: vi.fn(() => new Promise(() => {})),
  sendToTerminal: vi.fn(() => new Promise(() => {})),
  pollTenderResult: vi.fn(() => new Promise(() => {})),
}));
vi.mock("@/server/actions/auth", () => ({ signOut: vi.fn() }));
vi.mock("@/server/actions/favo", () => ({ getFavo: vi.fn().mockResolvedValue({ ok: true, data: { favo: null } }), setFavo: vi.fn(), clearFavo: vi.fn() }));
vi.mock("@/server/actions/customers", () => ({ searchCustomer: vi.fn() }));
// §7.0.1: Cappuccino R20; a tea item outside the coffee category.
vi.mock("@/server/actions/menu", () => ({
  getMenu: vi.fn().mockResolvedValue({
    ok: true,
    data: [
      { id: "menu_cappuccino", name: "Cappuccino", category: "coffee", currentPriceZar: 2000, active: true, customisations: [] },
      { id: "menu_rooibos", name: "Rooibos Tea", category: "tea", currentPriceZar: 2000, active: true, customisations: [] },
    ],
  }),
}));
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
vi.mock("@/store/draftOrder", () => ({
  lineKey: (x: { menuItemId: string }) => x.menuItemId,
  useDraftOrder: () => ({
    customer: null,
    items: [{ menuItemId: "menu_cappuccino", menuItemName: "Cappuccino", quantity: 1, unitPriceZar: 2000, modifications: [] }],
    totalZar: 2000,
    setCustomer: vi.fn(), addItem: vi.fn(), removeItem: vi.fn(), updateQuantity: vi.fn(), reset: vi.fn(),
  }),
}));

import POSWorkspace from "@/components/pos/POSWorkspace";

const EVENT_POLICY = { mode: "event" as const, maxShots: 4, surchargeInForce: false, extraShotZar: 1000 };

beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(navigator, "onLine", { value: true, configurable: true });
});

describe("POSWorkspace — an event in force", () => {
  it("REQ-045: Discipleship 101 (free, coffee-only): 'Send to queue', no 'Charge', and only the coffee items", async () => {
    render(<POSWorkspace staffName="Louis" staffId="staff_louis" role="barista"
      shotPolicy={{ ...EVENT_POLICY, event: { name: "Discipleship 101", paymentPosture: "free", menuScope: "coffee_only" } }} />);
    expect(await screen.findByRole("button", { name: /^send to queue$/i })).toBeDefined();
    expect(screen.queryByRole("button", { name: /^charge/i })).toBeNull();
    // The Cappuccino tile renders (the draft line is a second "Cappuccino" control).
    expect((await screen.findAllByRole("button", { name: /Cappuccino/ })).length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: /Rooibos Tea/ })).toBeNull();
  });

  it("a standard-posture, full-menu event still charges and shows every item", async () => {
    render(<POSWorkspace staffName="Louis" staffId="staff_louis" role="barista"
      shotPolicy={{ ...EVENT_POLICY, surchargeInForce: true, event: { name: "Youth Social", paymentPosture: "standard", menuScope: "full" } }} />);
    expect(await screen.findByRole("button", { name: /^charge r/i })).toBeDefined();
    expect(await screen.findByRole("button", { name: /Rooibos Tea/ })).toBeDefined();
  });
});
