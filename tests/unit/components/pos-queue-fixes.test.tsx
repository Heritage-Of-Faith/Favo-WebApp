import { describe, it, expect } from "vitest";
import { render, screen, renderHook, act } from "@testing-library/react";
import PaymentBadge, { paymentBadgeKind } from "@/components/pos/PaymentBadge";
import DraftLineButton from "@/components/pos/DraftLineButton";
import { useDraftNotice } from "@/components/pos/useDraftNotice";

describe("payment badge", () => {
  it("R38 order with pending payment is Pending, not Paid", () => {
    expect(paymentBadgeKind(3800, "pending")).toBe("pending");
    expect(paymentBadgeKind(3800, null)).toBe("pending");
    expect(paymentBadgeKind(3800, "failed")).toBe("pending");
    render(<PaymentBadge kind="pending" />);
    expect(screen.getByTestId("payment-badge").textContent).toBe("Pending");
    expect(screen.getByTestId("payment-badge").getAttribute("style")).not.toContain("--color-success");
  });
  it("Paid only when successful; Free at R0", () => {
    expect(paymentBadgeKind(3800, "successful")).toBe("paid");
    expect(paymentBadgeKind(3800, "pending", true)).toBe("paid");
    expect(paymentBadgeKind(0, null)).toBe("free");
    render(<PaymentBadge kind="free" />);
    expect(screen.getByTestId("payment-badge").textContent).toBe("Free");
  });
});

describe("draft notice", () => {
  it("is cleared when a new draft starts", () => {
    const { result } = renderHook(() => useDraftNotice());
    act(() => result.current.setNotice("Order paid — sent to the queue."));
    expect(result.current.notice).toBe("Order paid — sent to the queue.");
    const calls: string[] = [];
    act(() => { result.current.clearOnDraft((x: string) => calls.push(x))("item"); });
    expect(result.current.notice).toBeNull();
    expect(calls).toEqual(["item"]);
  });
});

describe("draft line button", () => {
  it("has 44x44 minimum and cannot shrink", () => {
    render(<DraftLineButton aria-label="Remove" />);
    const c = screen.getByLabelText("Remove").className;
    expect(c).toContain("min-h-[44px]");
    expect(c).toContain("min-w-[44px]");
    expect(c).toContain("shrink-0");
  });
});
