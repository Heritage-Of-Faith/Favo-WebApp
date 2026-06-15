// M15 — ConnectivityPill band logic

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import ConnectivityPill from "@/components/pos/ConnectivityPill";

function setOnline(v: boolean) {
  Object.defineProperty(navigator, "onLine", { value: v, configurable: true });
}

beforeEach(() => setOnline(true));

describe("ConnectivityPill", () => {
  it("green/online band when connected and queue empty", () => {
    render(<ConnectivityPill pendingCount={0} syncing={false} onClick={vi.fn()} />);
    const pill = screen.getByRole("status");
    expect(pill.getAttribute("data-band")).toBe("online");
    expect(pill.textContent).toMatch(/online/i);
  });

  it("yellow/queued band when online with pending orders", () => {
    render(<ConnectivityPill pendingCount={3} syncing={false} onClick={vi.fn()} />);
    const pill = screen.getByRole("status");
    expect(pill.getAttribute("data-band")).toBe("queued");
    expect(pill.textContent).toMatch(/3 queued/);
  });

  it("red/offline band reflects an offline event", () => {
    render(<ConnectivityPill pendingCount={2} syncing={false} onClick={vi.fn()} />);
    act(() => { setOnline(false); window.dispatchEvent(new Event("offline")); });
    const pill = screen.getByRole("status");
    expect(pill.getAttribute("data-band")).toBe("offline");
    expect(pill.textContent).toMatch(/offline/i);
  });

  it("shows a syncing label while syncing", () => {
    render(<ConnectivityPill pendingCount={2} syncing={true} onClick={vi.fn()} />);
    expect(screen.getByRole("status").textContent).toMatch(/syncing/i);
  });

  it("fires onClick when tapped", () => {
    const onClick = vi.fn();
    render(<ConnectivityPill pendingCount={0} syncing={false} onClick={onClick} />);
    fireEvent.click(screen.getByRole("status"));
    expect(onClick).toHaveBeenCalledOnce();
  });
});
