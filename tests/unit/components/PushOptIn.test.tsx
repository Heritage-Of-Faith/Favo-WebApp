// Component test for PushOptIn — task N5 acceptance criteria
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import PushOptIn from "@/components/customer/PushOptIn";

// Notification API is not available in jsdom — mock it
const mockRequestPermission = vi.fn();

beforeEach(() => {
  vi.resetAllMocks();

  // Default: push supported, permission is "default"
  // configurable: true so individual tests can redefine it
  Object.defineProperty(window, "Notification", {
    writable: true,
    configurable: true,
    value: {
      permission: "default",
      requestPermission: mockRequestPermission,
    },
  });

  Object.defineProperty(navigator, "serviceWorker", {
    writable: true,
    value: {
      getRegistration: vi.fn().mockResolvedValue(undefined),
      ready: new Promise(() => {}), // intentionally never resolves — should NOT be used
    },
  });
});

describe("PushOptIn", () => {
  it("renders the Enable button when permission is default", () => {
    render(<PushOptIn customerId="test-customer-id" />);
    expect(screen.getByRole("button", { name: /enable notifications/i })).toBeTruthy();
  });

  it("renders nothing when Push API is unsupported", () => {
    // Set Notification to undefined — component guard checks truthiness
    Object.defineProperty(window, "Notification", { writable: true, configurable: true, value: undefined });
    const { container } = render(<PushOptIn customerId="test-customer-id" />);
    expect(container.firstChild).toBeNull();
  });

  it("renders enabled status when permission is already granted", () => {
    Object.defineProperty(window, "Notification", {
      writable: true,
      value: { permission: "granted", requestPermission: mockRequestPermission },
    });
    render(<PushOptIn customerId="test-customer-id" />);
    expect(screen.getByText(/notifications enabled/i)).toBeTruthy();
  });

  it("renders blocked message when permission is denied", () => {
    Object.defineProperty(window, "Notification", {
      writable: true,
      value: { permission: "denied", requestPermission: mockRequestPermission },
    });
    render(<PushOptIn customerId="test-customer-id" />);
    expect(screen.getByText(/notifications blocked/i)).toBeTruthy();
  });
});
