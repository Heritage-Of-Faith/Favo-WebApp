// AT-207 — the admin banners: the §6.0.5 write-off approval queue (REQ-035)
// and the blocked-close in-app alert (REQ-036).

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";

const mockQueue = vi.fn();
const mockApprove = vi.fn();
const mockBlocked = vi.fn();
vi.mock("@/server/actions/write-offs", () => ({
  listWriteOffApprovalQueue: (...a: unknown[]) => mockQueue(...a),
  approveDayWriteOffs: (...a: unknown[]) => mockApprove(...a),
  listBlockedCloses: (...a: unknown[]) => mockBlocked(...a),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import WriteOffApprovalsBanner from "@/components/admin/WriteOffApprovalsBanner";
import BlockedClosesBanner from "@/components/admin/BlockedClosesBanner";

const QUEUE = [
  {
    revenueDay: "2026-10-25",
    count: 2,
    totalZar: 7000,
    items: [
      // 06:00 UTC = 08:00 SAST; 07:45 UTC = 09:45 SAST.
      { orderId: "o-1", placedAt: new Date("2026-10-25T06:00:00Z"), valueZar: 2500, reason: "deferred_unsettled", staffId: "s1", baristaName: "Louis" },
      { orderId: "o-2", placedAt: new Date("2026-10-25T07:45:00Z"), valueZar: 4500, reason: "unresolved_at_close", staffId: "s2", baristaName: "Nkuli" },
    ],
  },
];

beforeEach(() => vi.clearAllMocks());

describe("WriteOffApprovalsBanner (REQ-035)", () => {
  it("renders nothing when no day is unapproved", async () => {
    mockQueue.mockResolvedValue({ ok: true, data: [] });
    const { container } = render(<WriteOffApprovalsBanner />);
    await act(async () => {});
    expect(container.innerHTML).toBe("");
  });

  it("lists each write-off with its date AND time, value, reason and barista", async () => {
    mockQueue.mockResolvedValue({ ok: true, data: QUEUE });
    render(<WriteOffApprovalsBanner />);
    await act(async () => {});
    expect(screen.getByText(/2 write-offs unapproved for 2026-10-25/)).toBeDefined();
    const items = screen.getAllByRole("listitem").map((li) => li.textContent ?? "");
    expect(items[0]).toMatch(/25 Oct 2026/);
    expect(items[0]).toMatch(/08:00/);
    expect(items[0]).toMatch(/deferred_unsettled/);
    expect(items[0]).toMatch(/Louis/);
    expect(items[1]).toMatch(/09:45/);
    expect(items[1]).toMatch(/unresolved_at_close/);
    expect(items[1]).toMatch(/Nkuli/);
  });

  it("approves the day with the typed PIN and drops it from the list", async () => {
    mockQueue.mockResolvedValue({ ok: true, data: QUEUE });
    mockApprove.mockResolvedValue({ ok: true, data: { revenueDay: "2026-10-25", count: 2, totalZar: 7000 } });
    render(<WriteOffApprovalsBanner />);
    await act(async () => {});
    fireEvent.change(screen.getByLabelText(/Admin PIN to approve the write-offs of 2026-10-25/), { target: { value: "2468" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Approve" })); });
    expect(mockApprove).toHaveBeenCalledWith("2026-10-25", "2468");
    expect(screen.queryByText(/unapproved for 2026-10-25/)).toBeNull();
  });

  it("a refused PIN leaves the day listed", async () => {
    mockQueue.mockResolvedValue({ ok: true, data: QUEUE });
    mockApprove.mockResolvedValue({ ok: false, code: "INVALID_CREDENTIALS", message: "Incorrect PIN." });
    render(<WriteOffApprovalsBanner />);
    await act(async () => {});
    fireEvent.change(screen.getByLabelText(/Admin PIN/), { target: { value: "1111" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Approve" })); });
    expect(screen.getByText(/unapproved for 2026-10-25/)).toBeDefined();
  });
});

describe("BlockedClosesBanner (REQ-036)", () => {
  it("shows each blocked day with its reason, and offers no resolve action", async () => {
    mockBlocked.mockResolvedValue({
      ok: true,
      data: [{ revenueDay: "2026-10-25", blockedReason: "Revenue R 1 000,00 vs payments R 800,00 — 20.0% variance (critical).", closedAt: new Date() }],
    });
    render(<BlockedClosesBanner />);
    await act(async () => {});
    expect(screen.getByRole("alert").textContent).toMatch(/Daily close blocked/);
    expect(screen.getByText(/2026-10-25: Revenue .* variance \(critical\)/)).toBeDefined();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("renders nothing when no close is blocked", async () => {
    mockBlocked.mockResolvedValue({ ok: true, data: [] });
    const { container } = render(<BlockedClosesBanner />);
    await act(async () => {});
    expect(container.innerHTML).toBe("");
  });
});
