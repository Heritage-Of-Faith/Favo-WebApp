// OpeningTimePrompt — AT-134 (wireframe 1b). Shows on mount, pre-fills when
// today is already set, snoozes via Remind-me-later, submits through
// submitOpeningTime, and warns when a changed value will re-notify.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";

const mockGetToday = vi.fn();
const mockSubmit = vi.fn();
vi.mock("@/server/actions/opening", () => ({
  getTodaySessions: () => mockGetToday(),
  submitOpeningTime: (...a: unknown[]) => mockSubmit(...a),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), message: vi.fn() } }));

import OpeningTimePrompt from "@/components/pos/OpeningTimePrompt";

const NO_SESSIONS = { ok: true, data: { date: "2026-07-09", sessions: [] } };
const SET_SESSIONS = {
  ok: true,
  data: {
    date: "2026-07-09",
    sessions: [{ id: "os_1", sessionDate: "2026-07-09", opensAt: "07:30", closesAt: null, viaPos: true, notified: true }],
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  mockSubmit.mockResolvedValue({ ok: true, data: { notified: true, session: {}, sessions: [] } });
});

describe("OpeningTimePrompt", () => {
  it("shows on mount and submits the entered time", async () => {
    mockGetToday.mockResolvedValue(NO_SESSIONS);
    render(<OpeningTimePrompt />);
    const input = await screen.findByLabelText("Opening time");
    expect(screen.getByText(/notifies every subscribed customer/i)).toBeDefined();

    fireEvent.change(input, { target: { value: "08:00" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /confirm/i })); });
    expect(mockSubmit).toHaveBeenCalledWith("08:00");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("pre-fills the latest session and shows the change-notifies note only on change", async () => {
    mockGetToday.mockResolvedValue(SET_SESSIONS);
    render(<OpeningTimePrompt />);
    const input = (await screen.findByLabelText("Opening time")) as HTMLInputElement;
    expect(input.value).toBe("07:30");
    expect(screen.getByText(/confirming won't notify customers again/i)).toBeDefined();
    expect(screen.queryByText(/changing this will notify/i)).toBeNull();

    fireEvent.change(input, { target: { value: "14:00" } });
    expect(screen.getByText(/changing this will notify/i)).toBeDefined();
  });

  it("Remind me later closes and snoozes for the session", async () => {
    mockGetToday.mockResolvedValue(NO_SESSIONS);
    const { unmount } = render(<OpeningTimePrompt />);
    await screen.findByLabelText("Opening time");
    fireEvent.click(screen.getByRole("button", { name: /remind me later/i }));
    expect(screen.queryByRole("dialog")).toBeNull();
    unmount();

    // Re-mount (same browser session, same date) — stays snoozed.
    render(<OpeningTimePrompt />);
    await act(async () => { await Promise.resolve(); });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("never renders when the sessions fetch fails (never blocks the POS)", async () => {
    mockGetToday.mockResolvedValue({ ok: false, code: "ERR", message: "nope" });
    render(<OpeningTimePrompt />);
    await act(async () => { await Promise.resolve(); });
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
