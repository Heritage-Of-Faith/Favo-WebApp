// Unit tests for OnlineIndicator + RoleGuard (M7)

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";

// ─── Mocks ───────────────────────────────────────────────────────────────────

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

import OnlineIndicator, { OnlineIndicatorInline } from "@/components/pos/OnlineIndicator";
import RoleGuard from "@/components/pos/RoleGuard";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fireOnline()  { window.dispatchEvent(new Event("online")); }
function fireOffline() { window.dispatchEvent(new Event("offline")); }

// ─── OnlineIndicator tests ────────────────────────────────────────────────────

describe("OnlineIndicator (toast)", () => {
  beforeEach(() => {
    Object.defineProperty(navigator, "onLine", { value: true, configurable: true });
  });

  it("renders nothing when online", () => {
    const { container } = render(<OnlineIndicator />);
    expect(container.firstChild).toBeNull();
  });

  it("shows offline banner when navigator.onLine is false on mount", () => {
    Object.defineProperty(navigator, "onLine", { value: false, configurable: true });
    render(<OnlineIndicator />);
    expect(screen.getByRole("status", { name: /offline/i })).toBeDefined();
  });

  it("shows banner after offline event fires", () => {
    render(<OnlineIndicator />);
    act(() => fireOffline());
    expect(screen.getByRole("status", { name: /offline/i })).toBeDefined();
  });

  it("hides banner after coming back online", () => {
    Object.defineProperty(navigator, "onLine", { value: false, configurable: true });
    render(<OnlineIndicator />);
    act(() => fireOnline());
    expect(screen.queryByRole("status")).toBeNull();
  });
});

describe("OnlineIndicatorInline", () => {
  it("shows Online label when online", () => {
    Object.defineProperty(navigator, "onLine", { value: true, configurable: true });
    render(<OnlineIndicatorInline />);
    expect(screen.getByRole("status", { name: /online/i })).toBeDefined();
  });

  it("shows Offline label after offline event", () => {
    Object.defineProperty(navigator, "onLine", { value: true, configurable: true });
    render(<OnlineIndicatorInline />);
    act(() => fireOffline());
    expect(screen.getByRole("status", { name: /offline/i })).toBeDefined();
  });
});

// ─── RoleGuard tests ──────────────────────────────────────────────────────────

describe("RoleGuard", () => {
  it("renders children when role is allowed", () => {
    render(
      <RoleGuard roles={["barista", "manager"]} userRole="barista">
        <span>allowed content</span>
      </RoleGuard>
    );
    expect(screen.getByText("allowed content")).toBeDefined();
  });

  it("renders nothing when role is not allowed", () => {
    const { container } = render(
      <RoleGuard roles={["admin"]} userRole="barista">
        <span>secret</span>
      </RoleGuard>
    );
    expect(container.textContent).toBe("");
  });

  it("renders fallback when role is not allowed and fallback is provided", () => {
    render(
      <RoleGuard roles={["admin"]} userRole="barista" fallback={<span>no access</span>}>
        <span>secret</span>
      </RoleGuard>
    );
    expect(screen.getByText("no access")).toBeDefined();
    expect(screen.queryByText("secret")).toBeNull();
  });

  it("renders children for owner role", () => {
    render(
      <RoleGuard roles={["barista", "manager", "admin", "owner"]} userRole="owner">
        <span>owner content</span>
      </RoleGuard>
    );
    expect(screen.getByText("owner content")).toBeDefined();
  });
});
