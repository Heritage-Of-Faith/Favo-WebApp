// Charge an order that's already in the queue (T2 step 3: "one tap from the
// queue if the customer stepped away"). AT-201 part 2b: the card tender runs
// server-side; there is no in-browser card form (REQ-071) and no "Mark as
// paid" (§10.2.1 — a barista's tap never records a card payment).

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";

vi.mock("next/script", () => ({ default: () => null }));
const mockBegin = vi.fn();
const mockSend = vi.fn();
const mockPoll = vi.fn();
vi.mock("@/server/actions/tender", () => ({
  beginTender: (...a: unknown[]) => mockBegin(...a),
  sendToTerminal: (...a: unknown[]) => mockSend(...a),
  pollTenderResult: (...a: unknown[]) => mockPoll(...a),
}));
// Stub the offline child so the dialog logic is what's under test.
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
  totalZar: 4500, isStaffDiscount: false, paymentStatus: "declined", items: [],
};

function setOnline(v: boolean) {
  Object.defineProperty(navigator, "onLine", { value: v, configurable: true });
}

beforeEach(() => {
  vi.clearAllMocks();
  setOnline(true);
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  vi.setSystemTime(new Date("2026-10-25T07:00:00Z"));
});
afterEach(() => vi.useRealTimers());

async function flush() {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
}

describe("ChargeOrderDialog", () => {
  it("shows the order id", () => {
    mockBegin.mockReturnValue(new Promise(() => {}));
    render(<ChargeOrderDialog order={ORDER} onPaid={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByText(/ABC123/)).toBeDefined();
  });

  it("online: begins a new attempt, sends it, polls on S2's schedule; successful settles the order", async () => {
    mockBegin.mockResolvedValue({ ok: true, data: { attempt: 2, clientReference: "cu:2", amountZar: 4500 } });
    mockSend.mockResolvedValue({ ok: true, data: { sentAt: "2026-10-25T07:00:00.000Z" } });
    mockPoll
      .mockResolvedValueOnce({ ok: true, data: { status: "pending", fetchError: false } })
      .mockResolvedValueOnce({ ok: true, data: { status: "successful", fetchError: false } });
    const onPaid = vi.fn(); const onClose = vi.fn();
    render(<ChargeOrderDialog order={ORDER} onPaid={onPaid} onClose={onClose} />);
    await flush();
    expect(mockBegin).toHaveBeenCalledWith("ord_abc123");
    expect(mockSend).toHaveBeenCalledWith("ord_abc123", 2);
    expect(screen.queryByRole("button", { name: /mark as paid/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /charge card/i })).toBeNull();

    await act(async () => { vi.advanceTimersByTime(2_000); });
    await flush();
    expect(mockPoll).toHaveBeenCalledTimes(1);
    await act(async () => { vi.advanceTimersByTime(2_000); });
    await flush();
    expect(mockPoll).toHaveBeenCalledTimes(2);
    expect(mockPoll).toHaveBeenCalledWith("ord_abc123", 2);
    expect(onPaid).toHaveBeenCalledWith("ord_abc123");
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("declined: the PRD copy and Try again (a NEW attempt); nothing settles", async () => {
    mockBegin.mockResolvedValue({ ok: true, data: { attempt: 1, clientReference: "cu:1", amountZar: 4500 } });
    mockSend.mockResolvedValue({ ok: true, data: { sentAt: "2026-10-25T07:00:00.000Z" } });
    mockPoll.mockResolvedValue({ ok: false, code: "PAYMENT_DECLINED", message: "Card declined — try again or use another card." });
    const onPaid = vi.fn();
    render(<ChargeOrderDialog order={ORDER} onPaid={onPaid} onClose={vi.fn()} />);
    await flush();
    await act(async () => { vi.advanceTimersByTime(2_000); });
    await flush();
    expect(screen.getByText("Card declined — try again or use another card.")).toBeDefined();
    expect(onPaid).not.toHaveBeenCalled();
    mockBegin.mockReturnValue(new Promise(() => {}));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /try again/i })); });
    expect(mockBegin).toHaveBeenCalledTimes(2);
  });

  it("REQ-010: a timed-out send is PAYMENT_UNKNOWN — no retry button, never re-sent", async () => {
    mockBegin.mockResolvedValue({ ok: true, data: { attempt: 1, clientReference: "cu:1", amountZar: 4500 } });
    mockSend.mockResolvedValue({ ok: false, code: "PAYMENT_UNKNOWN", message: "We'll confirm this one shortly" });
    render(<ChargeOrderDialog order={ORDER} onPaid={vi.fn()} onClose={vi.fn()} />);
    await flush();
    expect(screen.getByText(/We'll confirm this one shortly/)).toBeDefined();
    expect(screen.getByText("unresolved")).toBeDefined();
    expect(screen.queryByRole("button", { name: /try again/i })).toBeNull();
    await act(async () => { vi.advanceTimersByTime(10_000); });
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it("REQ-010: GATEWAY_UNAVAILABLE offers a retry", async () => {
    mockBegin.mockResolvedValue({ ok: true, data: { attempt: 1, clientReference: "cu:1", amountZar: 4500 } });
    mockSend.mockResolvedValue({ ok: false, code: "GATEWAY_UNAVAILABLE", message: "Couldn't reach the card system — try again.", retryOffered: true });
    render(<ChargeOrderDialog order={ORDER} onPaid={vi.fn()} onClose={vi.fn()} />);
    await flush();
    expect(screen.getByText("Couldn't reach the card system — try again.")).toBeDefined();
    expect(screen.getByRole("button", { name: /try again/i })).toBeDefined();
  });

  it("an attempt already open but never sent (a reload) is resumed by sending it — not by beginning another", async () => {
    mockBegin.mockResolvedValue({
      ok: false, code: "TENDER_IN_PROGRESS", message: "This order is at the card machine — finish or cancel the payment first",
      openAttempt: { attempt: 3, status: "pending", sent: false },
    });
    mockSend.mockReturnValue(new Promise(() => {}));
    render(<ChargeOrderDialog order={ORDER} onPaid={vi.fn()} onClose={vi.fn()} />);
    await flush();
    expect(mockSend).toHaveBeenCalledWith("ord_abc123", 3);
  });

  it("offline: shows the deferred notice and settles via it", () => {
    setOnline(false);
    mockBegin.mockReturnValue(new Promise(() => {}));
    const onPaid = vi.fn();
    render(<ChargeOrderDialog order={ORDER} onPaid={onPaid} onClose={vi.fn()} />);
    fireEvent.click(screen.getByText("deferred-confirm"));
    expect(onPaid).toHaveBeenCalledWith("ord_abc123");
  });
});
