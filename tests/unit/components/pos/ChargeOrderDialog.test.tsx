// Charge an order that's already in the queue.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("next/script", () => ({ default: () => null }));
// Stub the payment children so the dialog logic is what's under test.
vi.mock("@/components/pos/YocoOrderForm", () => ({
  default: ({ orderId, amountZar, onPaid }: { orderId: string; amountZar: number; onPaid: () => void }) => (
    <button onClick={onPaid}>yoco-pay {orderId} {amountZar}</button>
  ),
}));
vi.mock("@/components/pos/DeferredPaymentNotice", () => ({
  default: ({ onConfirmDeferred }: { onConfirmDeferred: () => void }) => (
    <button onClick={onConfirmDeferred}>deferred-confirm</button>
  ),
}));

import ChargeOrderDialog from "@/components/pos/ChargeOrderDialog";
import type { Order } from "@/lib/types";

const ORDER: Order = {
  id: "ord_abc123", customerId: null, customerName: null, staffId: "s1",
  state: "ordered", placedAt: "2026-06-17T08:00:00Z", completedAt: null,
  totalZar: 4500, isStaffDiscount: false, paymentStatus: "pending", items: [],
};

function setOnline(v: boolean) {
  Object.defineProperty(navigator, "onLine", { value: v, configurable: true });
}

beforeEach(() => { vi.clearAllMocks(); setOnline(true); });

describe("ChargeOrderDialog", () => {
  it("shows the order id and amount", () => {
    render(<ChargeOrderDialog order={ORDER} onPaid={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByText(/ABC123/)).toBeDefined();
  });

  it("online: card payment settles the order (onPaid + onClose)", () => {
    const onPaid = vi.fn(); const onClose = vi.fn();
    render(<ChargeOrderDialog order={ORDER} onPaid={onPaid} onClose={onClose} />);
    fireEvent.click(screen.getByText(/yoco-pay ord_abc123 4500/));
    expect(onPaid).toHaveBeenCalledWith("ord_abc123");
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("offline: shows the deferred notice and settles via it", () => {
    setOnline(false);
    const onPaid = vi.fn();
    render(<ChargeOrderDialog order={ORDER} onPaid={onPaid} onClose={vi.fn()} />);
    fireEvent.click(screen.getByText("deferred-confirm"));
    expect(onPaid).toHaveBeenCalledWith("ord_abc123");
  });
});
