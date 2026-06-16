// Unit tests for M16 — wallet top-up (AmountKeypad cents logic + dialog flow)

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";

const mockTopUp = vi.fn();
vi.mock("@/server/actions/loyalty", () => ({
  topUpWallet: (...a: unknown[]) => mockTopUp(...a),
}));
// YocoPayment pulls the SDK — stub it and expose an onSuccess trigger
vi.mock("@/components/pos/YocoPayment", () => ({
  default: ({ onSuccess }: { onSuccess: (id: string) => void }) => (
    <button onClick={() => onSuccess("yoco_test")}>mock-pay</button>
  ),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import WalletTopUpDialog from "@/components/pos/WalletTopUpDialog";
import AmountKeypad from "@/components/pos/AmountKeypad";

beforeEach(() => {
  vi.clearAllMocks();
  mockTopUp.mockResolvedValue({ ok: true, data: { yocoClientSecret: "cs_1" } });
});

describe("AmountKeypad", () => {
  it("builds a cents value from digit presses (1,5,0,0 → R15,00)", () => {
    let cents = 0;
    const onChange = vi.fn((c: number) => { cents = c; });
    const { rerender } = render(<AmountKeypad valueCents={cents} onChange={onChange} />);
    for (const d of ["1", "5", "0", "0"]) {
      fireEvent.click(screen.getByRole("button", { name: `Digit ${d}` }));
      cents = onChange.mock.calls.at(-1)![0];
      rerender(<AmountKeypad valueCents={cents} onChange={onChange} />);
    }
    expect(cents).toBe(1500); // R15,00
  });

  it("preset chip sets the exact rand amount in cents", () => {
    const onChange = vi.fn();
    render(<AmountKeypad valueCents={0} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "R200" }));
    expect(onChange).toHaveBeenCalledWith(20000);
  });
});

describe("WalletTopUpDialog", () => {
  it("calls topUpWallet with the customer id and cents, then shows payment", async () => {
    render(<WalletTopUpDialog customerId="cust_louis" customerName="Louis" onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "R100" }));
    fireEvent.click(screen.getByRole("button", { name: /charge/i }));
    await waitFor(() => expect(mockTopUp).toHaveBeenCalledWith("cust_louis", 10000));
    expect(await screen.findByText("mock-pay")).toBeDefined();
  });

  it("shows confirmation after successful Yoco charge", async () => {
    render(<WalletTopUpDialog customerId="cust_louis" customerName="Louis" onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "R50" }));
    fireEvent.click(screen.getByRole("button", { name: /charge/i }));
    const payBtn = await screen.findByText("mock-pay");
    await act(async () => { fireEvent.click(payBtn); });
    expect(await screen.findByText(/topped up/i)).toBeDefined();
  });
});
