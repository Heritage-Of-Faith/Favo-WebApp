// AT-183 / AT-184 — the free weekday cup on the POS (L03, REQ-024):
//  - no free-text staff-id box anywhere (the cup is automatic);
//  - "Free cup applied" with a one-tap Decline;
//  - the createOrder outcome is told to the barista once.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("next/image", () => ({ default: (p: Record<string, unknown>) => <span data-src={String(p.src ?? "")} /> }));
vi.mock("next/script", () => ({ default: () => null }));

const mockCreateOrder = vi.fn();
const mockDecline = vi.fn();
vi.mock("@/server/actions/orders", () => ({
  createOrder: (...a: unknown[]) => mockCreateOrder(...a),
  declineFreeCoffee: (...a: unknown[]) => mockDecline(...a),
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
const toast = { success: vi.fn(), error: vi.fn(), warning: vi.fn(), message: vi.fn() };
vi.mock("sonner", () => ({ toast: { success: (...a: unknown[]) => toast.success(...a), error: (...a: unknown[]) => toast.error(...a), warning: (...a: unknown[]) => toast.warning(...a), message: (...a: unknown[]) => toast.message(...a) } }));
vi.mock("@/hooks/useOrderStream", () => ({ useOrderStream: () => ({ activeOrders: [], status: "connected" }) }));
vi.mock("@/hooks/useOfflineOutbox", () => ({
  useOfflineOutbox: () => ({ pendingOrders: [], pendingCount: 0, syncing: false, queueOrder: vi.fn(), sync: vi.fn(), syncOne: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("@/store/draftOrder", () => ({
  lineKey: (x: { menuItemId: string }) => x.menuItemId,
  useDraftOrder: () => ({
    customer: { id: "cust_thabo", name: "Thabo" },
    items: [{ menuItemId: "menu_americano", menuItemName: "Americano", quantity: 1, unitPriceZar: 3000, modifications: [] }],
    totalZar: 3000,
    setCustomer: vi.fn(), addItem: vi.fn(), removeItem: vi.fn(), updateQuantity: vi.fn(), reset: vi.fn(),
  }),
}));

import POSWorkspace from "@/components/pos/POSWorkspace";
import ActiveOrder from "@/components/pos/ActiveOrder";
import type { Order } from "@/lib/types";

beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(navigator, "onLine", { value: true, configurable: true });
});

async function placeOrder() {
  render(<POSWorkspace staffName="Louis" staffId="staff_louis" role="barista" />);
  await act(async () => { fireEvent.click(await screen.findByRole("button", { name: /^charge r/i })); });
}

describe("POSWorkspace — free cup at ring-up", () => {
  it("applied: shows the net R0,00, 'Free cup applied' once, and a one-tap Decline", async () => {
    mockCreateOrder.mockResolvedValue({
      ok: true,
      data: {
        orderId: "ord_1", yocoClientSecret: "", totalZar: 0,
        freeCup: { applied: true, code: null, message: "Free cup applied", discountZar: 3000 },
      },
    });
    await placeOrder();

    expect(toast.success).toHaveBeenCalledTimes(1);
    expect(toast.success).toHaveBeenCalledWith("Free cup applied");
    expect(screen.getByText("Free cup applied")).toBeDefined();
    expect(screen.getByRole("button", { name: /confirm — send to queue/i })).toBeDefined(); // R0 → no card

    mockDecline.mockResolvedValue({ ok: true, data: { totalZar: 3000 } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Decline" })); });
    expect(mockDecline).toHaveBeenCalledWith("ord_1");
    expect(screen.queryByText("Free cup applied")).toBeNull();
  });

  it("ENTITLEMENT_USED: the barista is told once and the order goes on as paid", async () => {
    mockCreateOrder.mockResolvedValue({
      ok: true,
      data: {
        orderId: "ord_2", yocoClientSecret: "cs_1", totalZar: 3000,
        freeCup: { applied: false, code: "ENTITLEMENT_USED", message: "Free cup already claimed today", discountZar: 0 },
      },
    });
    await placeOrder();
    expect(toast.message).toHaveBeenCalledTimes(1);
    expect(toast.message).toHaveBeenCalledWith("Free cup already claimed today");
    expect(screen.queryByText("Free cup applied")).toBeNull();
  });

  it("Decline disappears once the card step begins (P4 — round-2 item 2)", async () => {
    process.env.NEXT_PUBLIC_YOCO_PUBLIC_KEY = "pk_test_123";
    (globalThis as unknown as { YocoSDK?: unknown }).YocoSDK = function () { return { showPopup: vi.fn() }; } as unknown;
    mockCreateOrder.mockResolvedValue({
      ok: true,
      data: {
        orderId: "ord_3", yocoClientSecret: "cs_3", totalZar: 3000,
        freeCup: { applied: true, code: null, message: "Free cup applied", discountZar: 3000 },
      },
    });
    await placeOrder();
    expect(screen.getByRole("button", { name: "Decline" })).toBeDefined();
    await act(async () => { fireEvent.click(await screen.findByRole("button", { name: /charge card/i })); });
    expect(screen.queryByRole("button", { name: "Decline" })).toBeNull();
  });

  it("declining a FREE order with no checkout says where to take payment — not 'retry when online' (round-2 item 3)", async () => {
    mockCreateOrder.mockResolvedValue({
      ok: true,
      data: {
        orderId: "ord_4", yocoClientSecret: "", totalZar: 0,
        freeCup: { applied: true, code: null, message: "Free cup applied", discountZar: 3000 },
      },
    });
    await placeOrder();
    mockDecline.mockResolvedValue({ ok: true, data: { totalZar: 3000, yocoClientSecret: "" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Decline" })); });
    expect(screen.getByText(/no online card checkout for this order/i)).toBeDefined();
    expect(screen.queryByText(/retry when online/i)).toBeNull();
    expect(screen.queryByRole("button", { name: /confirm — send to queue/i })).toBeNull(); // no longer free
  });

  it("no Decline at all once the server set up a card checkout (owner rule, round 3)", async () => {
    process.env.NEXT_PUBLIC_YOCO_PUBLIC_KEY = "pk_test_123";
    (globalThis as unknown as { YocoSDK?: unknown }).YocoSDK = function () { return { showPopup: vi.fn() }; } as unknown;
    mockCreateOrder.mockResolvedValue({
      ok: true,
      data: {
        orderId: "ord_5", yocoClientSecret: "cs_5", cardCheckout: true, totalZar: 3000,
        freeCup: { applied: true, code: null, message: "Free cup applied", discountZar: 3000 },
      },
    });
    await placeOrder();
    expect(toast.success).toHaveBeenCalledWith("Free cup applied");
    expect(screen.queryByRole("button", { name: "Decline" })).toBeNull();
  });

  it("there is no staff-id text box", async () => {
    render(<POSWorkspace staffName="Louis" staffId="staff_louis" role="barista" />);
    expect(screen.queryByPlaceholderText(/staff/i)).toBeNull();
    expect(screen.queryByText(/apply staff discount/i)).toBeNull();
  });
});

describe("ActiveOrder — free cup", () => {
  const ORDER: Order = {
    id: "ord_9", customerId: "cust_thabo", customerName: "Thabo", staffId: "staff_louis",
    state: "ordered", placedAt: "2026-10-08T07:00:00Z", completedAt: null,
    totalZar: 3000, isStaffDiscount: true, paymentStatus: "pending",
    items: [{
      id: "oi_9", menuItemId: "menu_americano", menuItemName: "Americano",
      quantity: 2, unitPriceZar: 3000, modifications: [], discountZar: 3000,
    }],
  };

  it("shows 'Free cup applied' and no staff-id box", () => {
    render(<ActiveOrder order={ORDER} />);
    expect(screen.getByText("Free cup applied")).toBeDefined();
    expect(screen.queryByPlaceholderText(/staff_barista_sam/)).toBeNull();
    expect(screen.queryByLabelText(/staff member id/i)).toBeNull();
  });

  it("no Decline when the order has a card checkout (server state)", () => {
    render(<ActiveOrder order={{ ...ORDER, cardCheckout: true }} />);
    expect(screen.queryByRole("button", { name: "Decline" })).toBeNull();
  });

  it("one tap on Decline reverts the total and removes the row", async () => {
    mockDecline.mockResolvedValue({ ok: true, data: { totalZar: 6000 } });
    render(<ActiveOrder order={ORDER} />);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Decline" })); });
    expect(mockDecline).toHaveBeenCalledWith("ord_9");
    expect(screen.queryByText("Free cup applied")).toBeNull();
    // Line (2 × R30,00) and total both read R60,00; the "Free cup −R30,00" note is gone.
    expect(screen.getAllByText(/60,00/)).toHaveLength(2);
    expect(screen.queryByText(/30,00/)).toBeNull();
  });
});
