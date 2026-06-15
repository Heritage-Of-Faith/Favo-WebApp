// Unit tests for the cancel → waste shortcut (M13), driven through POSWorkspace.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";

// ─── Mocks ───────────────────────────────────────────────────────────────────
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("next/image", () => ({
  default: (props: Record<string, unknown>) =>
    <span data-testid="next-image" data-src={String(props.src ?? "")} />,
}));

const mockCancelOrder = vi.fn();
vi.mock("@/server/actions/orders", () => ({
  createOrder: vi.fn(),
  transitionOrder: vi.fn(),
  cancelOrder: (...a: unknown[]) => mockCancelOrder(...a),
  applyStaffDiscount: vi.fn(),
}));
vi.mock("@/server/actions/auth", () => ({ signOut: vi.fn() }));
vi.mock("@/server/actions/customers", () => ({ searchCustomer: vi.fn() }));
vi.mock("@/server/actions/menu", () => ({ getMenu: vi.fn().mockResolvedValue({ ok: true, data: [] }) }));
vi.mock("@/server/actions/inventory", () => ({
  listInventory: vi.fn().mockResolvedValue({ ok: true, data: { items: [] } }),
  listLots: vi.fn().mockResolvedValue({ ok: true, data: { lots: [] } }),
  listInventoryStatus: vi.fn().mockResolvedValue({ ok: true, data: { statusMap: {} } }),
  getActiveBeanLot: vi.fn().mockResolvedValue({ ok: true, data: { lot: null } }),
}));
vi.mock("@/server/actions/recipes", () => ({
  listRecipes: vi.fn().mockResolvedValue({ ok: true, data: { recipes: [] } }),
}));
vi.mock("@/server/actions/waste", () => ({ logWaste: vi.fn() }));
// M10 staff-push chain — cut here so the component graph never pulls next-auth.
vi.mock("@/lib/push/staff-subscribe", () => ({ enableStaffPush: vi.fn() }));
// M16/M17 counter flows (wallet/packs) imported by POSWorkspace — keep next-auth out.
vi.mock("@/server/actions/loyalty", () => ({
  topUpWallet: vi.fn(),
  purchasePack: vi.fn(),
  redeemLoyalty: vi.fn(),
}));

const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock("sonner", () => ({
  toast: {
    success: (...a: unknown[]) => toastSuccess(...a),
    error: (...a: unknown[]) => toastError(...a),
    warning: vi.fn(),
    message: vi.fn(),
  },
}));

// One waiting order in the live queue
vi.mock("@/hooks/useOrderStream", () => ({
  useOrderStream: () => ({
    activeOrders: [{ orderId: "ord_1", state: "ordered", lastUpdatedAt: "2026-05-31T10:00:00Z" }],
    status: "connected",
  }),
}));

// Draft store — empty cart
vi.mock("@/store/draftOrder", () => ({
  lineKey: (x: { menuItemId: string }) => x.menuItemId,
  useDraftOrder: () => ({
    customer: null, items: [], totalZar: 0,
    setCustomer: vi.fn(), addItem: vi.fn(), removeItem: vi.fn(),
    updateQuantity: vi.fn(), reset: vi.fn(),
  }),
}));

import POSWorkspace from "@/components/pos/POSWorkspace";

const FULL_ORDER = {
  order: {
    id: "ord_1", customerId: null, customerName: null, staffId: "s1",
    state: "ordered", placedAt: "2026-05-31T10:00:00Z", completedAt: null,
    totalZar: 3800, isStaffDiscount: false,
    items: [{ id: "oi1", menuItemId: "cap", menuItemName: "Cappuccino", quantity: 1, unitPriceZar: 3800, modifications: [] }],
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  // fetchFullOrder uses global fetch
  global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => FULL_ORDER }) as unknown as typeof fetch;
});

async function expandAndCancel() {
  render(<POSWorkspace staffName="Sam" staffId="s1" />);
  // Expand the order card
  const card = await screen.findByText("#ORD_1");
  await act(async () => { fireEvent.click(card); });
  // Click "Cancel order"
  const cancel = await screen.findByText(/cancel order/i);
  await act(async () => { fireEvent.click(cancel); });
  // Confirm "Yes"
  const yes = await screen.findByText(/^yes$/i);
  await act(async () => { fireEvent.click(yes); });
}

describe("M13 — cancel → waste shortcut", () => {
  it("calls cancelOrder and offers a 'Report waste' toast action on success", async () => {
    mockCancelOrder.mockResolvedValue({ ok: true, data: undefined });
    await expandAndCancel();

    await waitFor(() => expect(mockCancelOrder).toHaveBeenCalledWith("ord_1", expect.any(String)));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalled());
    const opts = toastSuccess.mock.calls[0][1];
    expect(opts.action.label).toMatch(/report waste/i);
    expect(typeof opts.action.onClick).toBe("function");
  });

  it("does not offer the waste shortcut when cancel fails", async () => {
    mockCancelOrder.mockResolvedValue({ ok: false, code: "CONFLICT", message: "Already paid." });
    await expandAndCancel();

    await waitFor(() => expect(mockCancelOrder).toHaveBeenCalled());
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalled();
  });
});
