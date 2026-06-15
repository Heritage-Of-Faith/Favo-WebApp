// Unit tests for M17 — coffee pack purchase

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";

const mockPurchase = vi.fn();
vi.mock("@/server/actions/loyalty", () => ({
  purchasePack: (...a: unknown[]) => mockPurchase(...a),
}));
vi.mock("@/components/pos/YocoPayment", () => ({
  default: ({ onSuccess }: { onSuccess: (id: string) => void }) => (
    <button onClick={() => onSuccess("yoco_test")}>mock-pay</button>
  ),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import PackPurchaseDialog from "@/components/pos/PackPurchaseDialog";
import type { MenuItem } from "@/lib/types";

const COFFEE: MenuItem[] = [
  { id: "ame", name: "Americano", category: "coffee", currentPriceZar: 3000, active: true, customisations: [] },
  { id: "cap", name: "Cappuccino", category: "coffee", currentPriceZar: 3800, active: true, customisations: [] },
];

beforeEach(() => {
  vi.clearAllMocks();
  mockPurchase.mockResolvedValue({ ok: true, data: { yocoClientSecret: "cs_1" } });
});

describe("PackPurchaseDialog", () => {
  it("defaults to qty 10 and computes total = qty × price", () => {
    render(<PackPurchaseDialog customerId="c1" customerName="Louis" coffeeItems={COFFEE} onClose={vi.fn()} />);
    // Americano R30 × 10 = R300,00 — shown in the Total row and on the Charge CTA.
    expect(screen.getAllByText(/300,00/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByRole("button", { name: /charge .*300,00/i })).toBeDefined();
  });

  it("calls purchasePack with item id and qty, then shows payment", async () => {
    render(<PackPurchaseDialog customerId="c1" customerName="Louis" coffeeItems={COFFEE} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /charge/i }));
    await waitFor(() => expect(mockPurchase).toHaveBeenCalledWith("c1", "ame", 10));
    expect(await screen.findByText("mock-pay")).toBeDefined();
  });

  it("decrements quantity and recomputes the total", () => {
    render(<PackPurchaseDialog customerId="c1" customerName="Louis" coffeeItems={COFFEE} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /decrease quantity/i }));
    // 9 × R30 = R270,00
    expect(screen.getByRole("button", { name: /charge .*270,00/i })).toBeDefined();
  });

  it("confirms after a successful charge", async () => {
    render(<PackPurchaseDialog customerId="c1" customerName="Louis" coffeeItems={COFFEE} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /charge/i }));
    const pay = await screen.findByText("mock-pay");
    await act(async () => { fireEvent.click(pay); });
    expect(await screen.findByRole("button", { name: /^done$/i })).toBeDefined();
  });
});
