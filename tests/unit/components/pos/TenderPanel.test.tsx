// AT-201 part 2b: TenderPanel's recovery paths.
//  - TENDER_NOT_BEGUN from createOrder (beginTender threw; nothing written or
//    sent) shows a retry, which begins afresh.
//  - A send that never reached the server, or a poll that says "not sent",
//    shows "Send again", which resumes the SAME attempt through beginTender
//    (it names the open attempt) — never a second attempt, never a re-send of
//    a claimed one (REQ-029).

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";

const mockBegin = vi.fn();
const mockSend = vi.fn();
const mockPoll = vi.fn();
vi.mock("@/server/actions/tender", () => ({
  beginTender: (...a: unknown[]) => mockBegin(...a),
  sendToTerminal: (...a: unknown[]) => mockSend(...a),
  pollTenderResult: (...a: unknown[]) => mockPoll(...a),
}));

import TenderPanel from "@/components/pos/TenderPanel";

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  vi.setSystemTime(new Date("2026-10-25T07:00:00Z"));
});
afterEach(() => vi.useRealTimers());

async function flush() {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
}

describe("TenderPanel recovery", () => {
  it("TENDER_NOT_BEGUN from createOrder → its message and a retry that begins a tender", async () => {
    mockBegin.mockReturnValue(new Promise(() => {}));
    render(<TenderPanel orderId="ord-1" amountZar={3000} onPaid={vi.fn()}
      initialFailure={{ code: "TENDER_NOT_BEGUN", message: "Couldn't start the card payment — nothing was sent. Try again.", retryOffered: true }} />);
    expect(screen.getByText("Couldn't start the card payment — nothing was sent. Try again.")).toBeDefined();
    expect(mockBegin).not.toHaveBeenCalled();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Try again" })); });
    expect(mockBegin).toHaveBeenCalledWith("ord-1");
  });

  it("the beginTender action itself not answering → TENDER_NOT_BEGUN copy with a retry", async () => {
    mockBegin.mockRejectedValue(new Error("network"));
    render(<TenderPanel orderId="ord-1" amountZar={3000} onPaid={vi.fn()} />);
    await flush();
    expect(screen.getByText("Couldn't start the card payment — nothing was sent. Try again.")).toBeDefined();
    expect(screen.getByRole("button", { name: "Try again" })).toBeDefined();
  });

  it("a send that never answered → 'Send again', which resumes attempt 1 via beginTender (no attempt 2)", async () => {
    mockSend.mockRejectedValueOnce(new Error("network"));
    render(<TenderPanel orderId="ord-1" amountZar={3000} attempt={1} onPaid={vi.fn()} />);
    await flush();
    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(mockPoll).not.toHaveBeenCalled();
    expect(screen.getByText("The card machine may not have received this payment.")).toBeDefined();

    mockBegin.mockResolvedValue({
      ok: false, code: "TENDER_IN_PROGRESS", message: "This order is at the card machine — finish or cancel the payment first",
      openAttempt: { attempt: 1, status: "pending", sent: false },
    });
    mockSend.mockReturnValue(new Promise(() => {}));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Send again" })); });
    await flush();
    expect(mockBegin).toHaveBeenCalledWith("ord-1");
    expect(mockSend).toHaveBeenLastCalledWith("ord-1", 1);
  });

  it("'Send again' on an attempt the server DID claim polls it instead of sending", async () => {
    mockSend.mockRejectedValueOnce(new Error("network"));
    render(<TenderPanel orderId="ord-1" amountZar={3000} attempt={1} onPaid={vi.fn()} />);
    await flush();
    mockBegin.mockResolvedValue({
      ok: false, code: "TENDER_IN_PROGRESS", message: "…",
      openAttempt: { attempt: 1, status: "pending", sent: true },
    });
    mockPoll.mockReturnValue(new Promise(() => {}));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Send again" })); });
    await flush();
    await act(async () => { vi.advanceTimersByTime(2_000); });
    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(mockPoll).toHaveBeenCalledWith("ord-1", 1);
  });

  it("a poll answering VALIDATION ('not sent') → 'Send again'", async () => {
    mockSend.mockResolvedValue({ ok: true, data: { sentAt: "2026-10-25T07:00:00.000Z" } });
    mockPoll.mockResolvedValue({ ok: false, code: "VALIDATION", message: "This attempt has not been sent." });
    render(<TenderPanel orderId="ord-1" amountZar={3000} attempt={1} onPaid={vi.fn()} />);
    await flush();
    await act(async () => { vi.advanceTimersByTime(2_000); });
    await flush();
    expect(screen.getByRole("button", { name: "Send again" })).toBeDefined();
  });
});
