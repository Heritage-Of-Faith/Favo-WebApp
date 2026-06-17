// M19 — OfflineBanner visibility + dismiss

import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import OfflineBanner from "@/components/pos/OfflineBanner";

function setOnline(v: boolean) {
  Object.defineProperty(navigator, "onLine", { value: v, configurable: true });
}

beforeEach(() => { setOnline(true); sessionStorage.clear(); vi.clearAllMocks(); });

describe("OfflineBanner", () => {
  it("renders nothing while online", () => {
    const { container } = render(<OfflineBanner pendingCount={0} />);
    expect(container.firstChild).toBeNull();
  });

  it("shows offline copy with pending count when offline", () => {
    setOnline(false);
    render(<OfflineBanner pendingCount={3} />);
    expect(screen.getByText(/working offline/i)).toBeDefined();
    expect(screen.getByText(/3 pending/)).toBeDefined();
    expect(screen.getByText(/sync resumes when wan returns/i)).toBeDefined();
  });

  it("can be dismissed for the session", () => {
    setOnline(false);
    render(<OfflineBanner pendingCount={1} />);
    fireEvent.click(screen.getByRole("button", { name: /dismiss offline banner/i }));
    expect(screen.queryByText(/working offline/i)).toBeNull();
    expect(sessionStorage.getItem("favo-pos-offline-dismissed")).toBe("1");
  });

  it("reappears after reconnect → next offline (dismiss cleared on online)", () => {
    setOnline(false);
    const { rerender } = render(<OfflineBanner pendingCount={0} />);
    fireEvent.click(screen.getByRole("button", { name: /dismiss offline banner/i }));
    expect(screen.queryByText(/working offline/i)).toBeNull();
    // Reconnect clears the dismiss…
    act(() => { setOnline(true); window.dispatchEvent(new Event("online")); });
    // …then drop again — banner is back.
    act(() => { setOnline(false); window.dispatchEvent(new Event("offline")); });
    rerender(<OfflineBanner pendingCount={0} />);
    expect(screen.getByText(/working offline/i)).toBeDefined();
  });
});
