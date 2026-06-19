// Unit tests for M18 — LoyaltyRedeemDialog

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";

const mockRedeem = vi.fn();
vi.mock("@/server/actions/loyalty", () => ({
  redeemLoyalty: (...a: unknown[]) => mockRedeem(...a),
}));
const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock("sonner", () => ({ toast: { success: (...a: unknown[]) => toastSuccess(...a), error: (...a: unknown[]) => toastError(...a) } }));

import LoyaltyRedeemDialog from "@/components/pos/LoyaltyRedeemDialog";

function setup(over: Partial<React.ComponentProps<typeof LoyaltyRedeemDialog>> = {}) {
  const onRedeemed = vi.fn();
  const onClose = vi.fn();
  render(
    <LoyaltyRedeemDialog
      customerId="c1" customerName="Thandeka" orderId="ord_1"
      loyaltyPoints={145} onRedeemed={onRedeemed} onClose={onClose} {...over}
    />,
  );
  return { onRedeemed, onClose };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRedeem.mockResolvedValue({ ok: true, data: { discountZar: 2000, newTotalZar: 0, clientSecret: null } });
});

describe("LoyaltyRedeemDialog", () => {
  it("shows the points-after figure", () => {
    setup();
    expect(screen.getByText(/45 pts after/)).toBeDefined();
  });

  it("calls redeemLoyalty(customerId, orderId), toasts and fires onRedeemed", async () => {
    const { onRedeemed, onClose } = setup();
    fireEvent.click(screen.getByRole("button", { name: /redeem r20 off/i }));
    await waitFor(() => expect(mockRedeem).toHaveBeenCalledWith("c1", "ord_1"));
    await waitFor(() => expect(onRedeemed).toHaveBeenCalledOnce());
    expect(toastSuccess).toHaveBeenCalledWith("100 pts redeemed — R20 off");
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("does not fire onRedeemed when the server rejects", async () => {
    mockRedeem.mockResolvedValue({ ok: false, code: "CONFLICT", message: "Not enough points." });
    const { onRedeemed } = setup();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /redeem r20 off/i })); });
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("Not enough points."));
    expect(onRedeemed).not.toHaveBeenCalled();
  });

  it("cancel button fires onClose without redeeming", () => {
    const { onClose } = setup();
    fireEvent.click(screen.getByRole("button", { name: /^cancel$/i }));
    expect(onClose).toHaveBeenCalledOnce();
    expect(mockRedeem).not.toHaveBeenCalled();
  });
});
