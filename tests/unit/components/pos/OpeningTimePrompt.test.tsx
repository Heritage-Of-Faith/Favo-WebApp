// OpeningTimePrompt — AT-134 (wireframe 1b), now the POS opening step
// (AT-204 prerequisite: PRD §6.0 flow row 1, L18, §6.6, REQ-057, §6.11.1).
//
// CHANGED (AT-204): the prompt reads getOpeningStep and opens through
// openSession. With no session open (NO_SESSION) the step is blocking — there
// is no "Remind me later" — so the snooze test now starts from an open
// session. Assertions are on the rendered tree.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";

const mockGetStep = vi.fn();
const mockOpen = vi.fn();
const mockClose = vi.fn();
const mockStartEvent = vi.fn();
vi.mock("@/server/actions/opening", () => ({
  getOpeningStep: () => mockGetStep(),
  openSession: (...a: unknown[]) => mockOpen(...a),
  closeSession: (...a: unknown[]) => mockClose(...a),
  openEventWindow: (...a: unknown[]) => mockStartEvent(...a),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), message: vi.fn() } }));

import OpeningTimePrompt from "@/components/pos/OpeningTimePrompt";

const STANDARD = {
  menuScope: "full", paymentPosture: "standard", consumesCupLid: true,
  audience: "both", extraShotSurcharge: true,
} as const;
const UNTRACKED_PROFILE = {
  id: "evp_untracked_church", name: "Untracked Church", recurrence: "FREQ=WEEKLY;BYDAY=SU",
  defaultStart: null, defaultEnd: null, ...STANDARD, voucherKinds: ["untracked_hot_drink"],
};
const FREE_PROFILE = {
  ...UNTRACKED_PROFILE, id: "evp_discipleship_101", name: "Discipleship 101",
  recurrence: "FREQ=WEEKLY;BYDAY=WE", paymentPosture: "free", voucherKinds: [],
};

function step(over: Record<string, unknown> = {}) {
  return { ok: true, data: { date: "2026-07-09", current: null, sessions: [], windows: [], profiles: [], ...over } };
}

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  mockOpen.mockResolvedValue({ ok: true, data: { notified: true, session: {}, sessions: [] } });
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-07-09T05:00:00Z"));
});
afterEach(() => vi.useRealTimers());

describe("OpeningTimePrompt — NO_SESSION", () => {
  it("blocks with 'Open the session first', shows the mode, and confirms in the same step", async () => {
    mockGetStep.mockResolvedValue(step());
    render(<OpeningTimePrompt />);
    expect(await screen.findByText("Open the session first")).toBeDefined();
    expect(screen.getByText("Weekday")).toBeDefined();
    expect(screen.queryByRole("button", { name: /remind me later/i })).toBeNull();
    expect(screen.getByText(/notifies every subscribed customer/i)).toBeDefined();

    fireEvent.change(screen.getByLabelText("Opening time"), { target: { value: "08:00" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /^confirm$/i })); });
    expect(mockOpen).toHaveBeenCalledWith({ opensAt: "08:00", confirm: { mode: "weekday" }, sundayOverrideConfirmed: false });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("shows the server's refusal and stays open", async () => {
    mockGetStep.mockResolvedValue(step());
    mockOpen.mockResolvedValue({ ok: false, code: "STALE_STATE", message: "A session is already open (since 07:30). Close it before opening another." });
    render(<OpeningTimePrompt />);
    await screen.findByText("Open the session first");
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /^confirm$/i })); });
    expect(screen.getByRole("alert").textContent).toBe("A session is already open (since 07:30). Close it before opening another.");
    expect(screen.getByRole("dialog")).toBeDefined();
  });

  it("never renders when the step fetch fails (never blocks on an error)", async () => {
    mockGetStep.mockResolvedValue({ ok: false, code: "ERR", message: "nope" });
    render(<OpeningTimePrompt />);
    await act(async () => { await Promise.resolve(); });
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("OpeningTimePrompt — Saturday (REQ-057)", () => {
  beforeEach(() => vi.setSystemTime(new Date("2026-10-10T08:00:00Z"))); // 10:00 SAST

  it("offers Start an event, not a mode picker, and no Confirm", async () => {
    mockGetStep.mockResolvedValue(step({ date: "2026-10-10", profiles: [UNTRACKED_PROFILE] }));
    render(<OpeningTimePrompt />);
    await screen.findByText("Open the session first");
    expect(screen.getByRole("button", { name: "Start an event" })).toBeDefined();
    expect(screen.getByText("The café is closed on Saturdays unless an event is set up.")).toBeDefined();
    expect(screen.queryByRole("button", { name: /^confirm$/i })).toBeNull();
    expect(screen.queryByRole("radio")).toBeNull();
    expect(screen.queryByText("Weekday")).toBeNull();
    expect(screen.queryByText("Sunday")).toBeNull();
  });

  it("starts an event from a profile with a required end time, then confirms it in one tap", async () => {
    const window = {
      id: "evw_new", name: "Untracked Church", eventProfileId: "evp_untracked_church",
      startsAt: "2026-10-10T08:00:00.000Z", endsAt: "2026-10-10T12:00:00.000Z",
      ...STANDARD, voucherKinds: ["untracked_hot_drink"],
    };
    mockGetStep
      .mockResolvedValueOnce(step({ date: "2026-10-10", profiles: [UNTRACKED_PROFILE, FREE_PROFILE] }))
      .mockResolvedValueOnce(step({ date: "2026-10-10", profiles: [UNTRACKED_PROFILE, FREE_PROFILE], windows: [window] }));
    mockStartEvent.mockResolvedValue({ ok: true, data: { window } });
    render(<OpeningTimePrompt />);
    await screen.findByText("Open the session first");
    fireEvent.click(screen.getByRole("button", { name: "Start an event" }));

    // A free profile is not offered while the till cannot honour it.
    const picker = screen.getByLabelText("Event profile") as HTMLSelectElement;
    expect([...picker.options].map((o) => o.textContent)).toEqual(["Choose an event", "Untracked Church"]);
    const start = screen.getByRole("button", { name: "Start event" }) as HTMLButtonElement;
    fireEvent.change(picker, { target: { value: "evp_untracked_church" } });
    expect(start.disabled).toBe(true); // an end time is mandatory
    fireEvent.change(screen.getByLabelText("Event end time"), { target: { value: "14:00" } });
    await act(async () => { fireEvent.click(start); });
    expect(mockStartEvent).toHaveBeenCalledWith("evp_untracked_church", { endsAt: "2026-10-10T12:00:00.000Z" });

    expect(await screen.findByText(
      "Untracked Church · Event · normal prices · disposables · Office Staff + Church Member · until 14:00"
    )).toBeDefined();
    expect((screen.getByLabelText("Opening time") as HTMLInputElement).value).toBe("10:00");
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /^confirm$/i })); });
    expect(mockOpen).toHaveBeenCalledWith({
      opensAt: "10:00", confirm: { mode: "event", eventWindowId: "evw_new" }, sundayOverrideConfirmed: false,
    });
  });
});

describe("OpeningTimePrompt — an event on a Sunday (§6.6 precedence 2)", () => {
  it("names the event and requires the Sunday-override confirm before Confirm works", async () => {
    vi.setSystemTime(new Date("2026-10-11T15:45:00Z")); // 17:45 SAST
    const evening = {
      id: "evw_untracked", name: "Untracked Church", eventProfileId: "evp_untracked_church",
      startsAt: "2026-10-11T15:45:00.000Z", endsAt: "2026-10-11T18:30:00.000Z",
      ...STANDARD, voucherKinds: ["untracked_hot_drink"],
    };
    mockGetStep.mockResolvedValue(step({ date: "2026-10-11", windows: [evening], sessions: [{ id: "os_m", opensAt: "07:30" }] }));
    render(<OpeningTimePrompt />);
    await screen.findByText("Open the session first");
    fireEvent.change(screen.getByLabelText("Opening time"), { target: { value: "17:45" } });

    expect(screen.getByText(
      "Untracked Church · Event · normal prices · disposables · Office Staff + Church Member · until 20:30"
    )).toBeDefined();
    expect(screen.getByText("Voucher kinds")).toBeDefined();
    const confirm = screen.getByRole("button", { name: /^confirm$/i }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.click(screen.getByLabelText("Run this session as the event, not as Sunday"));
    expect(confirm.disabled).toBe(false);
    await act(async () => { fireEvent.click(confirm); });
    expect(mockOpen).toHaveBeenCalledWith({
      opensAt: "17:45", confirm: { mode: "event", eventWindowId: "evw_untracked" }, sundayOverrideConfirmed: true,
    });
  });

  it("the same Sunday's morning stays Sunday with no override step (COL-8)", async () => {
    vi.setSystemTime(new Date("2026-10-11T05:00:00Z"));
    const evening = {
      id: "evw_untracked", name: "Untracked Church", eventProfileId: null,
      startsAt: "2026-10-11T16:00:00.000Z", endsAt: "2026-10-11T18:30:00.000Z", ...STANDARD, voucherKinds: [],
    };
    mockGetStep.mockResolvedValue(step({ date: "2026-10-11", windows: [evening] }));
    render(<OpeningTimePrompt />);
    await screen.findByText("Open the session first");
    expect(screen.getByText("Sunday")).toBeDefined();
    expect(screen.queryByLabelText("Run this session as the event, not as Sunday")).toBeNull();
  });
});

describe("OpeningTimePrompt — a session is open", () => {
  const OPEN = step({
    current: { id: "os_1", opensAt: "07:30", mode: "weekday", eventWindow: null },
    sessions: [{ id: "os_1", sessionDate: "2026-07-09", opensAt: "07:30", closesAt: null, viaPos: true, notified: true }],
  });

  it("shows the open session and closes it, returning to the opening step", async () => {
    mockGetStep.mockResolvedValueOnce(OPEN).mockResolvedValueOnce(step({ sessions: OPEN.data.sessions }));
    mockClose.mockResolvedValue({ ok: true, data: { sessions: [] } });
    render(<OpeningTimePrompt />);
    expect(await screen.findByText("Session open since 07:30 · Weekday")).toBeDefined();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Close session" })); });
    expect(mockClose).toHaveBeenCalledWith("os_1");
    expect(await screen.findByText("Open the session first")).toBeDefined();
  });

  it("Remind me later closes and snoozes for the session", async () => {
    mockGetStep.mockResolvedValue(OPEN);
    const { unmount } = render(<OpeningTimePrompt />);
    await screen.findByText("Session open since 07:30 · Weekday");
    fireEvent.click(screen.getByRole("button", { name: /remind me later/i }));
    expect(screen.queryByRole("dialog")).toBeNull();
    unmount();

    // Re-mount (same browser session, same date) — stays snoozed.
    render(<OpeningTimePrompt />);
    await act(async () => { await Promise.resolve(); });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("a snooze never hides the step while no session is open", async () => {
    sessionStorage.setItem("favo-opening-snoozed:2026-07-09", "1");
    mockGetStep.mockResolvedValue(step());
    render(<OpeningTimePrompt />);
    expect(await screen.findByText("Open the session first")).toBeDefined();
  });
});
