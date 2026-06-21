// Unit tests for AT-116 — PackRedeemSection

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const mockGetOrderItems = vi.fn();
const mockGetActivePacks = vi.fn();
const mockRedeemPack = vi.fn();

vi.mock("@/server/actions/orders", () => ({
  getOrderItems: (...a: unknown[]) => mockGetOrderItems(...a),
  // keep other exports intact
  createOrder: vi.fn(), transitionOrder: vi.fn(), cancelOrder: vi.fn(),
  applyStaffDiscount: vi.fn(), listActiveOrders: vi.fn(),
}));
vi.mock("@/server/actions/packs", () => ({
  getCustomerActivePacks: (...a: unknown[]) => mockGetActivePacks(...a),
  redeemPack: (...a: unknown[]) => mockRedeemPack(...a),
}));

const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock("sonner", () => ({ toast: { success: (...a: unknown[]) => toastSuccess(...a), error: (...a: unknown[]) => toastError(...a) } }));

import PackRedeemSection from "@/components/pos/PackRedeemSection";

const LINES = [
  { id: "line_1", menuItemId: "item_cap", menuItemName: "Cappuccino", unitPriceZar: 4500 },
  { id: "line_2", menuItemId: "item_cap", menuItemName: "Cappuccino", unitPriceZar: 4500 },
  { id: "line_3", menuItemId: "item_fud", menuItemName: "Muffin", unitPriceZar: 2500 },
];
const ACTIVE_PACKS = [
  { menuItemId: "item_cap", qtyRemaining: 8 },
];

function setup(over: Partial<React.ComponentProps<typeof PackRedeemSection>> = {}) {
  const onRedeemed = vi.fn();
  render(
    <PackRedeemSection
      customerId="c1"
      orderId="ord_1"
      onRedeemed={onRedeemed}
      {...over}
    />,
  );
  return { onRedeemed };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetOrderItems.mockResolvedValue({ ok: true, data: LINES });
  mockGetActivePacks.mockResolvedValue({ ok: true, data: ACTIVE_PACKS });
  mockRedeemPack.mockResolvedValue({ ok: true, data: { packId: "pack_1", qtyRemaining: 7 } });
});

describe("PackRedeemSection — display", () => {
  it("renders nothing while loading", () => {
    // Never resolves in this tick
    mockGetOrderItems.mockReturnValue(new Promise(() => {}));
    mockGetActivePacks.mockReturnValue(new Promise(() => {}));
    const { container } = render(
      <PackRedeemSection customerId="c1" orderId="ord_1" onRedeemed={vi.fn()} />,
    );
    expect(container.textContent).toContain("Checking packs");
  });

  it("shows Use pack buttons only for matching coffee lines", async () => {
    setup();
    // Two cappuccino lines with pack; one muffin line without pack
    expect(await screen.findAllByRole("button", { name: /use pack/i })).toHaveLength(2);
    expect(screen.queryByText(/Muffin/)).toBeNull();
  });

  it("renders nothing when no packs match any order lines", async () => {
    mockGetActivePacks.mockResolvedValue({ ok: true, data: [] });
    const { container } = render(
      <PackRedeemSection customerId="c1" orderId="ord_1" onRedeemed={vi.fn()} />,
    );
    await waitFor(() => expect(mockGetOrderItems).toHaveBeenCalled());
    // Section is empty — no buttons and no "Checking packs"
    expect(container.textContent).toBe("");
  });
});

describe("PackRedeemSection — redemption", () => {
  it("calls redeemPack with correct args and fires onRedeemed", async () => {
    const { onRedeemed } = setup();
    const buttons = await screen.findAllByRole("button", { name: /use pack/i });
    fireEvent.click(buttons[0]);
    await waitFor(() => expect(mockRedeemPack).toHaveBeenCalledWith("c1", "ord_1", "line_1"));
    await waitFor(() => expect(onRedeemed).toHaveBeenCalledWith("line_1", 4500));
    expect(toastSuccess).toHaveBeenCalledWith(expect.stringContaining("Cappuccino"));
  });

  it("removes the redeemed line's button and shows confirmation", async () => {
    setup();
    const buttons = await screen.findAllByRole("button", { name: /use pack/i });
    fireEvent.click(buttons[0]);
    await waitFor(() => expect(screen.getByText(/1 pack redemption applied/i)).toBeDefined());
    // Now only 1 remaining cappuccino button
    expect(screen.getAllByRole("button", { name: /use pack/i })).toHaveLength(1);
  });

  it("shows error toast and does not fire onRedeemed on server error", async () => {
    mockRedeemPack.mockResolvedValue({ ok: false, code: "CONFLICT", message: "Pack is empty." });
    const { onRedeemed } = setup();
    const buttons = await screen.findAllByRole("button", { name: /use pack/i });
    fireEvent.click(buttons[0]);
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("Pack is empty."));
    expect(onRedeemed).not.toHaveBeenCalled();
  });
});
