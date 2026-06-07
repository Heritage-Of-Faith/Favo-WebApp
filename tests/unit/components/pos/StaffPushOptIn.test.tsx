// Unit tests for StaffPushOptIn (M10)

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, act, fireEvent } from "@testing-library/react";

const mockEnable = vi.fn();
vi.mock("@/lib/push/staff-subscribe", () => ({
  enableStaffPush: (...a: unknown[]) => mockEnable(...a),
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), message: vi.fn(), error: vi.fn() },
}));

import StaffPushOptIn from "@/components/pos/StaffPushOptIn";

function setPermission(p: NotificationPermission) {
  Object.defineProperty(window, "Notification", {
    value: { permission: p, requestPermission: vi.fn() },
    configurable: true,
    writable: true,
  });
  Object.defineProperty(navigator, "serviceWorker", { value: {}, configurable: true });
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  mockEnable.mockResolvedValue({ ok: true });
});

describe("StaffPushOptIn", () => {
  it("shows the card when permission is default and not asked before", async () => {
    setPermission("default");
    render(<StaffPushOptIn />);
    expect(await screen.findByText(/get stock & order alerts/i)).toBeDefined();
  });

  it("does not show when permission already granted", async () => {
    setPermission("granted");
    const { container } = render(<StaffPushOptIn />);
    await waitFor(() => {});
    expect(container.firstChild).toBeNull();
  });

  it("does not re-show after being dismissed (asked-once flag)", async () => {
    setPermission("default");
    localStorage.setItem("favo_pos_push_asked", "1");
    const { container } = render(<StaffPushOptIn />);
    await waitFor(() => {});
    expect(container.firstChild).toBeNull();
  });

  it("re-shows when permission was revoked (denied) even if asked before", async () => {
    setPermission("denied");
    localStorage.setItem("favo_pos_push_asked", "1");
    render(<StaffPushOptIn />);
    expect(await screen.findByText(/get stock & order alerts/i)).toBeDefined();
  });

  it("calls enableStaffPush when Enable is tapped", async () => {
    setPermission("default");
    render(<StaffPushOptIn />);
    const btn = await screen.findByRole("button", { name: /enable/i });
    await act(async () => { fireEvent.click(btn); });
    await waitFor(() => expect(mockEnable).toHaveBeenCalledTimes(1));
  });
});
