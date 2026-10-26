// AT-204 Wave 2 — the voucher slip count at closeSession (§6.9.2, §6.11.1,
// L43, REQ-156, REQ-157). Empty is not zero: "Not counted" sends no count
// (voucher_slips_counted stays NULL), and the close is never blocked.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";

const mockGetStep = vi.fn();
const mockClose = vi.fn();
vi.mock("@/server/actions/opening", () => ({
  getOpeningStep: () => mockGetStep(),
  openSession: vi.fn(),
  closeSession: (...a: unknown[]) => mockClose(...a),
  openEventWindow: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), message: vi.fn() } }));

import OpeningTimePrompt from "@/components/pos/OpeningTimePrompt";

function openStep(voucherKindsActive: string[]) {
  return {
    ok: true,
    data: {
      date: "2026-07-12",
      current: { id: "os_eve", opensAt: "17:30", mode: "sunday", eventWindow: null, voucherKindsActive },
      sessions: [], windows: [], profiles: [],
    },
  };
}
const AFTER_CLOSE = { ok: true, data: { date: "2026-07-12", current: null, sessions: [], windows: [], profiles: [] } };

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  mockClose.mockResolvedValue({ ok: true, data: { sessions: [] } });
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-07-12T17:00:00Z"));
});
afterEach(() => vi.useRealTimers());

describe("closeSession — voucher slip count", () => {
  it("no voucher kinds in force: no count field, and the close sends no count", async () => {
    mockGetStep.mockResolvedValueOnce(openStep([])).mockResolvedValueOnce(AFTER_CLOSE);
    render(<OpeningTimePrompt />);
    await screen.findByRole("button", { name: "Close session" });
    expect(screen.queryByLabelText(/voucher slips/i)).toBeNull();
    expect(screen.queryByRole("button", { name: "Not counted" })).toBeNull();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Close session" })); });
    expect(mockClose).toHaveBeenCalledTimes(1);
    expect(mockClose.mock.calls[0][1]).toBeUndefined();
  });

  it("voucher kinds in force: typing 12 sends 12", async () => {
    mockGetStep.mockResolvedValueOnce(openStep(["untracked_hot_drink"])).mockResolvedValueOnce(AFTER_CLOSE);
    render(<OpeningTimePrompt />);
    const input = await screen.findByLabelText(/voucher slips/i);
    fireEvent.change(input, { target: { value: "12" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Close session" })); });
    expect(mockClose).toHaveBeenCalledWith("os_eve", 12);
  });

  it("'Not counted' closes with no count — never 0 (REQ-157)", async () => {
    mockGetStep.mockResolvedValueOnce(openStep(["untracked_hot_drink"])).mockResolvedValueOnce(AFTER_CLOSE);
    render(<OpeningTimePrompt />);
    await screen.findByLabelText(/voucher slips/i);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Not counted" })); });
    expect(mockClose).toHaveBeenCalledTimes(1);
    expect(mockClose.mock.calls[0][0]).toBe("os_eve");
    expect(mockClose.mock.calls[0][1]).toBeUndefined();
    expect(mockClose.mock.calls[0][1]).not.toBe(0);
    expect(await screen.findByText("Open the session first")).toBeDefined();
  });

  it("the count field starts empty, not 0, and an empty field cannot be sent as a count", async () => {
    mockGetStep.mockResolvedValueOnce(openStep(["untracked_hot_drink"]));
    render(<OpeningTimePrompt />);
    const input = (await screen.findByLabelText(/voucher slips/i)) as HTMLInputElement;
    expect(input.value).toBe("");
    const close = screen.getByRole("button", { name: "Close session" }) as HTMLButtonElement;
    expect(close.disabled).toBe(true);
    // ...while "Not counted" is always there, so the close is never blocked (REQ-156).
    expect((screen.getByRole("button", { name: "Not counted" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("typing 0 is a real count of zero, distinct from Not counted", async () => {
    mockGetStep.mockResolvedValueOnce(openStep(["untracked_hot_drink"])).mockResolvedValueOnce(AFTER_CLOSE);
    render(<OpeningTimePrompt />);
    fireEvent.change(await screen.findByLabelText(/voucher slips/i), { target: { value: "0" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Close session" })); });
    expect(mockClose).toHaveBeenCalledWith("os_eve", 0);
  });
});
