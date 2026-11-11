// §6.7 "Detection": "The first failed send is the primary signal —
// TERMINAL_UNREACHABLE offers deferred mode one tap away." §6.0.2 / §6.8.4:
// "Card machine not responding — check it's on and on the wifi, or switch to
// deferred", with setDeferredMode one tap away. Never a silent retry.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";

const mockBegin = vi.fn();
const mockSend = vi.fn();
const mockPoll = vi.fn();
const mockEnter = vi.fn();
vi.mock("@/server/actions/tender", () => ({
  beginTender: (...a: unknown[]) => mockBegin(...a),
  sendToTerminal: (...a: unknown[]) => mockSend(...a),
  pollTenderResult: (...a: unknown[]) => mockPoll(...a),
}));
vi.mock("@/server/actions/deferred", () => ({
  enterDeferredAfterUnreachable: (...a: unknown[]) => mockEnter(...a),
}));

import TenderPanel from "@/components/pos/TenderPanel";

const PRD_COPY = "Card machine not responding — check it's on and on the wifi, or switch to deferred";

beforeEach(() => vi.clearAllMocks());

async function flush() {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
}

describe("TERMINAL_UNREACHABLE from a linked machine", () => {
  it("shows the PRD copy and one 'Switch to deferred' tap — no retry, no typed reason; the tap enters deferred mode", async () => {
    mockSend.mockResolvedValue({ ok: false, code: "TERMINAL_UNREACHABLE", message: PRD_COPY, deferredOffered: true });
    mockEnter.mockResolvedValue({ ok: true, data: { deferred: true, changed: true } });
    const changed = vi.fn();
    window.addEventListener("favo:session-changed", changed);
    render(<TenderPanel orderId="ord-1" amountZar={3000} attempt={1} onPaid={vi.fn()} />);
    await flush();
    expect(screen.getByText(PRD_COPY)).toBeDefined();
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
    expect(screen.queryByRole("textbox")).toBeNull();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Switch to deferred" })); });
    await flush();
    expect(mockEnter).toHaveBeenCalledTimes(1);
    expect(mockEnter).toHaveBeenCalledWith();
    // The order in hand is NOT converted (no payment_mode rewrite): the barista is told to re-ring it.
    expect(screen.getByText(
      "Deferred mode is on. This order was not changed — cancel it and ring it again, and it will be taken unpaid."
    )).toBeDefined();
    expect(screen.queryByRole("button", { name: "Switch to deferred" })).toBeNull();
    expect(changed).toHaveBeenCalledTimes(1);
    expect(mockSend).toHaveBeenCalledTimes(1); // nothing re-sent
    window.removeEventListener("favo:session-changed", changed);
  });

  it("a refusal (e.g. a weekday session) shows the server's message and keeps the tap", async () => {
    mockSend.mockResolvedValue({ ok: false, code: "TERMINAL_UNREACHABLE", message: PRD_COPY, deferredOffered: true });
    mockEnter.mockResolvedValue({ ok: false, code: "MODE_FORBIDDEN", message: "Nobody pays in this session — deferred mode is not needed." });
    render(<TenderPanel orderId="ord-1" amountZar={3000} attempt={1} onPaid={vi.fn()} />);
    await flush();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Switch to deferred" })); });
    await flush();
    expect(screen.getByText("Nobody pays in this session — deferred mode is not needed.")).toBeDefined();
    expect(screen.getByRole("button", { name: "Switch to deferred" })).toBeDefined();
  });

  it("no terminal linked (no deferredOffered): no deferred tap", async () => {
    mockSend.mockResolvedValue({
      ok: false, code: "TERMINAL_UNREACHABLE",
      message: "No card terminal is linked to FAVO yet. Take this payment on the Yoco app, or cancel the order.",
    });
    render(<TenderPanel orderId="ord-1" amountZar={3000} attempt={1} onPaid={vi.fn()} />);
    await flush();
    expect(screen.queryByRole("button", { name: "Switch to deferred" })).toBeNull();
  });

  it("GATEWAY_UNAVAILABLE keeps its retry and gets no deferred tap", async () => {
    mockSend.mockResolvedValue({ ok: false, code: "GATEWAY_UNAVAILABLE", message: "Couldn't reach the card system — try again.", retryOffered: true });
    render(<TenderPanel orderId="ord-1" amountZar={3000} attempt={1} onPaid={vi.fn()} />);
    await flush();
    expect(screen.getByRole("button", { name: "Try again" })).toBeDefined();
    expect(screen.queryByRole("button", { name: "Switch to deferred" })).toBeNull();
  });
});
