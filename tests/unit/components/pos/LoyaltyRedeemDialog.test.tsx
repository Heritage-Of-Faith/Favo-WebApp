// Unit tests for AT-110 — LoyaltyRedeemDialog (multi-unit stepper)

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
      loyaltyPoints={200} orderTotalZar={4500}
      onRedeemed={onRedeemed} onClose={onClose} {...over}
    />,
  );
  return { onRedeemed, onClose };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRedeem.mockResolvedValue({
    ok: true,
    data: { discountZar: 2000, pointsUsed: 100, newTotalZar: 2500, clientSecret: "ck_test" },
  });
});

describe("LoyaltyRedeemDialog — display", () => {
  it("shows the customer name and available points", () => {
    setup();
    expect(screen.getByText(/Thandeka/)).toBeDefined();
    expect(screen.getByText(/200 pts/)).toBeDefined();
  });

  it("shows the points-after figure in the breakdown (200 pts, 1 unit used = 100 pts after)", () => {
    setup();
    // "Points after" label and "100 pts" value are in separate spans in the breakdown.
    expect(screen.getByText("Points after")).toBeDefined();
    expect(screen.getAllByText("100 pts").length).toBeGreaterThanOrEqual(1);
  });

  it("shows max units when maxUnits > 1", () => {
    // 400 pts, R90 → maxUnits = min(4, 4) = 4
    setup({ loyaltyPoints: 400, orderTotalZar: 9000 });
    expect(screen.getByText(/max 4/i)).toBeDefined();
  });

  it("renders the 'insufficient' fallback when maxUnits = 0", () => {
    setup({ loyaltyPoints: 50, orderTotalZar: 4500 });
    expect(screen.getByText(/cannot redeem/i)).toBeDefined();
    expect(screen.queryByRole("button", { name: /redeem/i })).toBeNull();
  });
});

describe("LoyaltyRedeemDialog — stepper", () => {
  it("renders − and + buttons", () => {
    setup({ loyaltyPoints: 400, orderTotalZar: 9000 });
    expect(screen.getByRole("button", { name: /decrease units/i })).toBeDefined();
    expect(screen.getByRole("button", { name: /increase units/i })).toBeDefined();
  });

  it("− button is disabled at units = 1 (minimum)", () => {
    setup();
    const dec = screen.getByRole("button", { name: /decrease units/i });
    expect(dec.hasAttribute("disabled")).toBe(true);
  });

  it("+ button is disabled when units = maxUnits", () => {
    // 100 pts, R45 → maxUnits = 1
    setup({ loyaltyPoints: 100, orderTotalZar: 4500 });
    const inc = screen.getByRole("button", { name: /increase units/i });
    expect(inc.hasAttribute("disabled")).toBe(true);
  });

  it("incrementing updates the CTA button to reflect the new discount", () => {
    // 400 pts, R90 → maxUnits=4; start at 1 (R20 off) → click + → units=2 (R40 off)
    setup({ loyaltyPoints: 400, orderTotalZar: 9000 });
    expect(screen.getByRole("button", { name: /redeem r20 off/i })).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: /increase units/i }));
    expect(screen.getByRole("button", { name: /redeem r40 off/i })).toBeDefined();
  });
});

describe("LoyaltyRedeemDialog — confirm flow", () => {
  it("calls redeemLoyalty with (customerId, orderId, units) and fires onRedeemed with result", async () => {
    const { onRedeemed, onClose } = setup();
    fireEvent.click(screen.getByRole("button", { name: /redeem r20 off/i }));
    await waitFor(() => expect(mockRedeem).toHaveBeenCalledWith("c1", "ord_1", 1));
    await waitFor(() => expect(onRedeemed).toHaveBeenCalledOnce());
    expect(onRedeemed).toHaveBeenCalledWith({
      pointsUsed: 100, discountZar: 2000, newTotalZar: 2500,
    });
    expect(onClose).toHaveBeenCalledOnce();
    expect(toastSuccess).toHaveBeenCalledWith("100 pts redeemed — R20 off");
  });

  it("calls redeemLoyalty with correct units after stepping", async () => {
    mockRedeem.mockResolvedValue({
      ok: true,
      data: { discountZar: 4000, pointsUsed: 200, newTotalZar: 5000, clientSecret: "ck_test" },
    });
    // 400 pts, R90 → maxUnits=4; step to 2
    setup({ loyaltyPoints: 400, orderTotalZar: 9000 });
    fireEvent.click(screen.getByRole("button", { name: /increase units/i }));
    fireEvent.click(screen.getByRole("button", { name: /redeem r40 off/i }));
    await waitFor(() => expect(mockRedeem).toHaveBeenCalledWith("c1", "ord_1", 2));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("200 pts redeemed — R40 off"));
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
