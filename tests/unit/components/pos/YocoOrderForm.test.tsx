// M4/AT-13 — YocoOrderForm: SDK charge + backend poll as source of truth.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";

// next/script renders nothing useful in jsdom; the SDK is injected via globalThis below.
vi.mock("next/script", () => ({ default: () => null }));

import YocoOrderForm from "@/components/pos/YocoOrderForm";

type PopupCfg = {
  amountInCents: number; currency: string; metadata?: Record<string, string>;
  callback: (r: { id?: string; error?: { message: string } }) => void;
};
let lastPopup: PopupCfg | null = null;
const showPopup = vi.fn((cfg: PopupCfg) => { lastPopup = cfg; });

function installSdk() {
  (globalThis as unknown as { YocoSDK?: unknown }).YocoSDK = function () { return { showPopup }; } as unknown;
}
function removeSdk() {
  delete (globalThis as unknown as { YocoSDK?: unknown }).YocoSDK;
}

function orderResponse(paymentStatus: string | null) {
  return { ok: true, json: async () => ({ order: { paymentStatus } }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  lastPopup = null;
  process.env.NEXT_PUBLIC_YOCO_PUBLIC_KEY = "pk_test_123";
  installSdk();
});
afterEach(() => removeSdk());

describe("YocoOrderForm", () => {
  it("shows the charge button once the SDK is ready", async () => {
    render(<YocoOrderForm orderId="ord_1" amountZar={6000} onPaid={vi.fn()} />);
    expect(await screen.findByRole("button", { name: /charge card/i })).toBeDefined();
    expect(screen.getByText(/60,00/)).toBeDefined();
  });

  it("opens the Yoco popup with the order id as metadata", async () => {
    render(<YocoOrderForm orderId="ord_42" amountZar={4500} onPaid={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: /charge card/i }));
    expect(showPopup).toHaveBeenCalledOnce();
    expect(lastPopup?.amountInCents).toBe(4500);
    expect(lastPopup?.metadata).toEqual({ orderId: "ord_42" });
  });

  it("polls the order endpoint and calls onPaid when status is successful", async () => {
    const onPaid = vi.fn();
    global.fetch = vi.fn().mockResolvedValue(orderResponse("successful")) as unknown as typeof fetch;
    render(<YocoOrderForm orderId="ord_1" amountZar={6000} onPaid={onPaid} />);
    fireEvent.click(await screen.findByRole("button", { name: /charge card/i }));
    // Simulate the customer completing the card capture.
    await act(async () => { lastPopup!.callback({ id: "ch_1" }); });
    await waitFor(() => expect(onPaid).toHaveBeenCalledOnce());
    expect((global.fetch as unknown as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(
      "/api/pos/order/ord_1", expect.objectContaining({ cache: "no-store" }),
    );
  });

  it("does NOT call onPaid when the backend reports a failed payment", async () => {
    const onPaid = vi.fn();
    global.fetch = vi.fn().mockResolvedValue(orderResponse("failed")) as unknown as typeof fetch;
    render(<YocoOrderForm orderId="ord_1" amountZar={6000} onPaid={onPaid} />);
    fireEvent.click(await screen.findByRole("button", { name: /charge card/i }));
    await act(async () => { lastPopup!.callback({ id: "ch_1" }); });
    await waitFor(() => expect(screen.getByText(/declined/i)).toBeDefined());
    expect(onPaid).not.toHaveBeenCalled();
  });

  it("surfaces a declined-card error from the SDK callback without polling", async () => {
    const onPaid = vi.fn();
    global.fetch = vi.fn() as unknown as typeof fetch;
    render(<YocoOrderForm orderId="ord_1" amountZar={6000} onPaid={onPaid} />);
    fireEvent.click(await screen.findByRole("button", { name: /charge card/i }));
    await act(async () => { lastPopup!.callback({ error: { message: "Card declined" } }); });
    expect(await screen.findByText(/card declined/i)).toBeDefined();
    expect(global.fetch).not.toHaveBeenCalled();
    expect(onPaid).not.toHaveBeenCalled();
  });
});
