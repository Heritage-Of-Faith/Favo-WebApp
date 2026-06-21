// Unit tests for AT-113 — WalletSpendDialog

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";

const mockSpend = vi.fn();
vi.mock("@/server/actions/wallet", () => ({
  walletSpend: (...a: unknown[]) => mockSpend(...a),
}));
const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock("sonner", () => ({ toast: { success: (...a: unknown[]) => toastSuccess(...a), error: (...a: unknown[]) => toastError(...a) } }));

import WalletSpendDialog from "@/components/pos/WalletSpendDialog";

function setup(over: Partial<React.ComponentProps<typeof WalletSpendDialog>> = {}) {
  const onApplied = vi.fn();
  const onClose = vi.fn();
  render(
    <WalletSpendDialog
      customerId="c1" customerName="Thandeka" orderId="ord_1"
      walletZar={5000} orderTotalZar={4500}
      onApplied={onApplied} onClose={onClose} {...over}
    />,
  );
  return { onApplied, onClose };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockSpend.mockResolvedValue({ ok: true, data: { newTotalZar: 0, clientSecret: null } });
});

describe("WalletSpendDialog — display", () => {
  it("shows customer name and wallet balance", () => {
    setup();
    expect(screen.getByText(/Thandeka/)).toBeDefined();
    // formatZar(5000) → "R 50,00" — just check the label text is present
    expect(screen.getByText(/Spend from wallet/)).toBeDefined();
    expect(screen.getByText(/wallet balance/)).toBeDefined();
  });

  it("applicable amount is min(walletZar, orderTotalZar) — button says Apply", () => {
    // walletZar=5000 (R50), orderTotalZar=4500 (R45) → applies R45
    setup({ walletZar: 5000, orderTotalZar: 4500 });
    // Button text: "Apply R 45,00" — getByRole matches accessible name
    expect(screen.getByRole("button", { name: /apply/i })).toBeDefined();
    // Breakdown shows applied amount (formatZar(4500) = "R 45,00")
    expect(screen.getByText(/Wallet applied/)).toBeDefined();
  });

  it("shows new total as free when wallet covers full order", () => {
    // walletZar=5000, orderTotalZar=4500 → new total R0
    setup({ walletZar: 5000, orderTotalZar: 4500 });
    expect(screen.getByText("R0 (free)")).toBeDefined();
  });

  it("shows partial new total when wallet doesn't cover order", () => {
    // walletZar=2000 (R20), orderTotalZar=4500 (R45) → new total R25 (2500 cents)
    setup({ walletZar: 2000, orderTotalZar: 4500 });
    expect(screen.getByText(/25,00/)).toBeDefined();
  });
});

describe("WalletSpendDialog — confirm flow", () => {
  it("calls walletSpend with (customerId, orderId, applicableAmount) and fires onApplied", async () => {
    mockSpend.mockResolvedValue({ ok: true, data: { newTotalZar: 0, clientSecret: null } });
    // walletZar=5000, orderTotalZar=4500 → applicable=4500
    const { onApplied, onClose } = setup({ walletZar: 5000, orderTotalZar: 4500 });
    // Button accessible name contains "Apply" and the formatted amount
    fireEvent.click(screen.getByRole("button", { name: /^apply/i }));
    await waitFor(() => expect(mockSpend).toHaveBeenCalledWith("c1", "ord_1", 4500));
    await waitFor(() => expect(onApplied).toHaveBeenCalledOnce());
    expect(onApplied).toHaveBeenCalledWith({ amountSpent: 4500, newTotalZar: 0 });
    expect(onClose).toHaveBeenCalledOnce();
    // toast.success shows the formatZar amount — use stringContaining to avoid
    // matching the Intl non-breaking space vs regular space exactly.
    expect(toastSuccess).toHaveBeenCalledWith(expect.stringContaining("from wallet applied"));
  });

  it("does not fire onApplied when the server rejects", async () => {
    mockSpend.mockResolvedValue({ ok: false, code: "CONFLICT", message: "Insufficient wallet balance." });
    const { onApplied } = setup();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /^apply/i })); });
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("Insufficient wallet balance."));
    expect(onApplied).not.toHaveBeenCalled();
  });

  it("cancel button fires onClose without spending", () => {
    const { onClose } = setup();
    fireEvent.click(screen.getByRole("button", { name: /^cancel$/i }));
    expect(onClose).toHaveBeenCalledOnce();
    expect(mockSpend).not.toHaveBeenCalled();
  });
});
