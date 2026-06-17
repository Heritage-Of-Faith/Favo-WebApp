// Offline deferred-payment notice (R2). Self-detects connectivity, so tests set
// navigator.onLine before mounting.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import DeferredPaymentNotice from "@/components/pos/DeferredPaymentNotice";

function setOnline(v: boolean) {
  Object.defineProperty(navigator, "onLine", { value: v, configurable: true });
}

beforeEach(() => { vi.clearAllMocks(); setOnline(false); });

describe("DeferredPaymentNotice", () => {
  it("shows the no-connection guidance and amount when offline", () => {
    render(<DeferredPaymentNotice totalZar={4500} onConfirmDeferred={vi.fn()} onBack={vi.fn()} />);
    expect(screen.getByText(/no connection/i)).toBeDefined();
    expect(screen.getByText(/take payment on the yoco card machine/i)).toBeDefined();
    expect(screen.getByText(/45,00/)).toBeDefined();
  });

  it("renders nothing while online", () => {
    setOnline(true);
    const { container } = render(<DeferredPaymentNotice totalZar={4500} onConfirmDeferred={vi.fn()} onBack={vi.fn()} />);
    expect(container.firstChild).toBeNull();
  });

  it("confirm fires onConfirmDeferred", () => {
    const onConfirmDeferred = vi.fn();
    render(<DeferredPaymentNotice totalZar={4500} onConfirmDeferred={onConfirmDeferred} onBack={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /confirm — paid in person/i }));
    expect(onConfirmDeferred).toHaveBeenCalledOnce();
  });

  it("back link fires onBack", () => {
    const onBack = vi.fn();
    render(<DeferredPaymentNotice totalZar={4500} onConfirmDeferred={vi.fn()} onBack={onBack} />);
    fireEvent.click(screen.getByRole("button", { name: /back to order/i }));
    expect(onBack).toHaveBeenCalledOnce();
  });
});
