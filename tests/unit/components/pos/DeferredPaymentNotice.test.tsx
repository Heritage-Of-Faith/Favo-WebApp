// M19 — DeferredPaymentNotice

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import DeferredPaymentNotice from "@/components/pos/DeferredPaymentNotice";

describe("DeferredPaymentNotice", () => {
  it("shows the amount due and the in-person payment guidance", () => {
    render(<DeferredPaymentNotice totalZar={4500} queueing={false} onConfirm={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByText(/45,00/)).toBeDefined();
    expect(screen.getByText(/take payment in person/i)).toBeDefined();
  });

  it("confirm fires onConfirm", () => {
    const onConfirm = vi.fn();
    render(<DeferredPaymentNotice totalZar={4500} queueing={false} onConfirm={onConfirm} onCancel={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /take payment & queue order/i }));
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it("disables actions while queueing", () => {
    render(<DeferredPaymentNotice totalZar={4500} queueing={true} onConfirm={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByRole("button", { name: /queueing/i }).hasAttribute("disabled")).toBe(true);
  });
});
