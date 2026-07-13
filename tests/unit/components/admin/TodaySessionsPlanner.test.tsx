// TodaySessionsPlanner — AT-134 admin planner (wireframe 1c).

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";

const mockAdd = vi.fn();
const mockUpdate = vi.fn();
const mockDelete = vi.fn();
vi.mock("@/server/actions/opening", () => ({
  addTodaySession: (...a: unknown[]) => mockAdd(...a),
  updateTodaySession: (...a: unknown[]) => mockUpdate(...a),
  deleteTodaySession: (...a: unknown[]) => mockDelete(...a),
}));

import TodaySessionsPlanner from "@/components/admin/TodaySessionsPlanner";

const SESSIONS = [
  { id: "os_1", sessionDate: "2026-07-09", opensAt: "07:00", closesAt: "12:00", viaPos: true, notified: true },
  { id: "os_2", sessionDate: "2026-07-09", opensAt: "14:00", closesAt: null, viaPos: false, notified: false },
];

beforeEach(() => vi.clearAllMocks());

describe("TodaySessionsPlanner", () => {
  it("renders ordinal rows, via-POS tag, and open-ended sessions", () => {
    render(<TodaySessionsPlanner initialSessions={SESSIONS} todayLabel="Thu 9 Jul" fallbackLabel="your usual Thursday hours (07:00–17:00)" />);
    expect(screen.getByText("First opening")).toBeDefined();
    expect(screen.getByText("Second opening")).toBeDefined();
    expect(screen.getByText(/via pos/i)).toBeDefined();
    expect(screen.getByText(/07:00 – 12:00/)).toBeDefined();
    expect(screen.getByText(/14:00 → open-ended/)).toBeDefined();
    expect(screen.getByText(/falls back to your usual thursday hours/i)).toBeDefined();
  });

  it("adds a session through addTodaySession", async () => {
    mockAdd.mockResolvedValue({ ok: true, data: { sessions: SESSIONS } });
    render(<TodaySessionsPlanner initialSessions={[]} todayLabel="Thu 9 Jul" fallbackLabel="your usual Thursday schedule" />);
    fireEvent.click(screen.getByRole("button", { name: /add session/i }));
    fireEvent.change(screen.getByLabelText("Opens at"), { target: { value: "14:00" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /^save$/i })); });
    expect(mockAdd).toHaveBeenCalledWith({ opensAt: "14:00", closesAt: null, notify: false });
    expect(screen.getByText("First opening")).toBeDefined();
  });

  it("ticking Notify customers passes notify:true (AT-134)", async () => {
    mockAdd.mockResolvedValue({ ok: true, data: { sessions: SESSIONS } });
    render(<TodaySessionsPlanner initialSessions={[]} todayLabel="Thu 9 Jul" fallbackLabel="your usual Thursday schedule" />);
    fireEvent.click(screen.getByRole("button", { name: /add session/i }));
    fireEvent.change(screen.getByLabelText("Opens at"), { target: { value: "14:00" } });
    fireEvent.click(screen.getByLabelText("Notify customers"));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /^save$/i })); });
    expect(mockAdd).toHaveBeenCalledWith({ opensAt: "14:00", closesAt: null, notify: true });
  });

  it("deletes a session through deleteTodaySession", async () => {
    mockDelete.mockResolvedValue({ ok: true, data: { sessions: [] } });
    render(<TodaySessionsPlanner initialSessions={[SESSIONS[0]]} todayLabel="Thu 9 Jul" fallbackLabel="your usual Thursday schedule" />);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /delete/i })); });
    expect(mockDelete).toHaveBeenCalledWith("os_1");
    expect(screen.getByText(/no sessions set for today/i)).toBeDefined();
  });

  it("edits a session through updateTodaySession", async () => {
    mockUpdate.mockResolvedValue({ ok: true, data: { sessions: [{ ...SESSIONS[0], opensAt: "08:00" }] } });
    render(<TodaySessionsPlanner initialSessions={[SESSIONS[0]]} todayLabel="Thu 9 Jul" fallbackLabel="your usual Thursday schedule" />);
    fireEvent.click(screen.getByRole("button", { name: /edit/i }));
    fireEvent.change(screen.getByLabelText("Opens at"), { target: { value: "08:00" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /^save$/i })); });
    expect(mockUpdate).toHaveBeenCalledWith("os_1", { opensAt: "08:00", closesAt: "12:00", notify: false });
    expect(screen.getByText(/08:00/)).toBeDefined();
  });

  it("surfaces action errors inline", async () => {
    mockDelete.mockResolvedValue({ ok: false, code: "NOT_FOUND", message: "Session not found for today." });
    render(<TodaySessionsPlanner initialSessions={[SESSIONS[0]]} todayLabel="Thu 9 Jul" fallbackLabel="your usual Thursday schedule" />);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /delete/i })); });
    expect(screen.getByRole("alert").textContent).toMatch(/not found/i);
  });
});
