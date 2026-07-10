// LoyaltyRedeemInline — AT-140. Same stepper/logic as AT-110, now embedded
// inline in the cart region instead of a floating modal: collapsed trigger →
// expand in place → stepper → confirm via redeemLoyalty, no dialog chrome.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";

const mockRedeem = vi.fn();
vi.mock("@/server/actions/loyalty", () => ({ redeemLoyalty: (...a: unknown[]) => mockRedeem(...a) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import LoyaltyRedeemInline from "@/components/pos/LoyaltyRedeemInline";

const BASE_PROPS = {
  customerId: "c1",
  customerName: "Thandeka",
  orderId: "ord_1",
  loyaltyPoints: 250,
  orderTotalZar: 6000,
  onRedeemed: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
  mockRedeem.mockResolvedValue({ ok: true, data: { pointsUsed: 100, discountZar: 2000, newTotalZar: 4000 } });
});

describe("LoyaltyRedeemInline", () => {
  it("renders nothing when the customer can't redeem (below the unit or order too small)", () => {
    const { container } = render(<LoyaltyRedeemInline {...BASE_PROPS} loyaltyPoints={50} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("starts collapsed as a single trigger — no stepper chrome, no backdrop", () => {
    render(<LoyaltyRedeemInline {...BASE_PROPS} />);
    expect(screen.getByRole("button", { name: /redeem loyalty points/i })).toBeDefined();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByLabelText(/increase units/i)).toBeNull();
  });

  it("expands inline in place on tap, defaults to 1 unit, caps at max", () => {
    render(<LoyaltyRedeemInline {...BASE_PROPS} />); // 250 pts, R60 order → max 2 units
    fireEvent.click(screen.getByRole("button", { name: /redeem loyalty points/i }));
    expect(screen.getByText("1")).toBeDefined();
    expect(screen.getByText(/max 2/i)).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: /increase units/i }));
    fireEvent.click(screen.getByRole("button", { name: /increase units/i })); // should clamp at 2
    expect(screen.getByText("2")).toBeDefined();
  });

  it("Cancel collapses back to the trigger without calling the server", () => {
    render(<LoyaltyRedeemInline {...BASE_PROPS} />);
    fireEvent.click(screen.getByRole("button", { name: /redeem loyalty points/i }));
    fireEvent.click(screen.getByRole("button", { name: /^cancel$/i }));
    expect(screen.getByRole("button", { name: /redeem loyalty points/i })).toBeDefined();
    expect(mockRedeem).not.toHaveBeenCalled();
  });

  it("confirms through redeemLoyalty and forwards the result", async () => {
    const onRedeemed = vi.fn();
    render(<LoyaltyRedeemInline {...BASE_PROPS} onRedeemed={onRedeemed} />);
    fireEvent.click(screen.getByRole("button", { name: /redeem loyalty points/i }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /redeem r20 off/i }));
    });
    expect(mockRedeem).toHaveBeenCalledWith("c1", "ord_1", 1);
    expect(onRedeemed).toHaveBeenCalledWith({ pointsUsed: 100, discountZar: 2000, newTotalZar: 4000 });
  });
});
