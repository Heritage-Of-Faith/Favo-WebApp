// REQ-048 / L29 / R16 — an uninstalled iPhone sees the install requirement and
// the subscribed state is unreachable, even if the server claims a subscription.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import PushOptIn from "@/components/customer/PushOptIn";
import NotificationToggle from "@/components/customer/NotificationToggle";
import WelcomeModal from "@/components/customer/WelcomeModal";

const IPHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";

function setIphone(standalone: boolean) {
  vi.spyOn(navigator, "userAgent", "get").mockReturnValue(IPHONE_UA);
  Object.defineProperty(navigator, "standalone", { configurable: true, value: standalone });
  // iOS Safari has no Notification global until installed; model a granted one
  // anyway to prove the guard does not depend on it.
  Object.defineProperty(window, "Notification", {
    writable: true,
    configurable: true,
    value: { permission: "granted", requestPermission: vi.fn() },
  });
  Object.defineProperty(navigator, "serviceWorker", { writable: true, configurable: true, value: {} });
}

beforeEach(() => localStorage.clear());
afterEach(() => {
  vi.restoreAllMocks();
  Object.defineProperty(navigator, "standalone", { configurable: true, value: undefined });
});

const INSTALL = /add to home screen/i;

describe("uninstalled iPhone", () => {
  it("PushOptIn shows the install requirement and never 'enabled'", async () => {
    setIphone(false);
    render(<PushOptIn customerId="c1" serverHasSubscription={true} />);
    await act(async () => {});
    expect(screen.getByTestId("install-step")).toBeTruthy();
    expect(screen.getByText(INSTALL)).toBeTruthy();
    expect(screen.queryByText(/notifications enabled/i)).toBeNull();
    expect(screen.queryByRole("button", { name: /enable|disable|register/i })).toBeNull();
  });

  it("NotificationToggle shows the install requirement and never 'Enabled on this device'", async () => {
    setIphone(false);
    render(<NotificationToggle customerId="c1" serverHasSubscription={true} />);
    await act(async () => {});
    expect(screen.getByTestId("install-step")).toBeTruthy();
    expect(screen.queryByText(/enabled on this device/i)).toBeNull();
    expect(screen.queryByRole("button", { name: /enable|disable/i })).toBeNull();
  });

  it("WelcomeModal shows the install step instead of an enable prompt", async () => {
    setIphone(false);
    Object.defineProperty(window, "Notification", {
      writable: true, configurable: true,
      value: { permission: "default", requestPermission: vi.fn() },
    });
    render(<WelcomeModal customerId="c1" firstName="Thandi" />);
    await act(async () => {});
    expect(screen.getByTestId("install-step")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /enable notifications/i })).toBeNull();
  });
});

describe("installed iPhone (standalone)", () => {
  it("PushOptIn reaches the enabled state normally", async () => {
    setIphone(true);
    render(<PushOptIn customerId="c1" serverHasSubscription={true} />);
    await act(async () => {});
    expect(screen.queryByTestId("install-step")).toBeNull();
    expect(screen.getByText(/notifications enabled/i)).toBeTruthy();
  });

  it("NotificationToggle reaches 'Enabled on this device'", async () => {
    setIphone(true);
    render(<NotificationToggle customerId="c1" serverHasSubscription={true} />);
    await act(async () => {});
    expect(screen.queryByTestId("install-step")).toBeNull();
    expect(screen.getByText(/enabled on this device/i)).toBeTruthy();
  });
});
