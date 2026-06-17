// Unit tests for LoginForm (M1)
// Covers: digit entry, backspace, max-length cap, submit gating,
// success redirect, error display, loading state.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

// ─── Mocks ───────────────────────────────────────────────────────────────────

vi.mock("next/image", () => ({
  default: (props: React.ImgHTMLAttributes<HTMLImageElement>) => (
    <img {...props} alt={props.alt ?? ""} />
  ),
}));

const mockLoginWithPin = vi.fn();
vi.mock("@/server/actions/auth", () => ({
  loginWithPin: (...args: unknown[]) => mockLoginWithPin(...args),
}));

// ─── Import after mocks ───────────────────────────────────────────────────────

import LoginForm from "@/components/pos/LoginForm";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getDigitButton(digit: string) {
  return screen.getByRole("button", { name: `Digit ${digit}` });
}

function pressDigits(...digits: string[]) {
  digits.forEach((d) => fireEvent.click(getDigitButton(d)));
}

function getSubmitButton() {
  return screen.getByRole("button", { name: "Confirm PIN" });
}

function getDeleteButton() {
  return screen.getByRole("button", { name: "Delete last digit" });
}

// ─── Tests ───────────────────────────────────────────────────────────────────

let lastHref = "";
beforeEach(() => {
  lastHref = "";
  // window.location.href is not writable in jsdom by default — replace with a stub.
  Object.defineProperty(window, "location", {
    configurable: true,
    value: {
      get href() { return lastHref; },
      set href(v: string) { lastHref = v; },
    },
  });
});

describe("LoginForm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the PIN keypad with all digit buttons", () => {
    render(<LoginForm />);
    ["0","1","2","3","4","5","6","7","8","9"].forEach((d) => {
      expect(getDigitButton(d)).toBeDefined();
    });
  });

  it("submit button is disabled until 4 digits are entered", () => {
    render(<LoginForm />);
    expect(getSubmitButton()).toBeDisabled();
    pressDigits("1", "2", "3");
    expect(getSubmitButton()).toBeDisabled();
    pressDigits("4");
    expect(getSubmitButton()).not.toBeDisabled();
  });

  it("caps PIN entry at 6 digits", () => {
    render(<LoginForm />);
    pressDigits("1","2","3","4","5","6");
    // The 7th press on any digit should be no-op — all digit buttons disabled
    expect(getDigitButton("1")).toBeDisabled();
  });

  it("delete button removes the last entered digit", () => {
    render(<LoginForm />);
    pressDigits("1","2","3","4");
    fireEvent.click(getDeleteButton());
    // Submit should be disabled again (only 3 digits)
    expect(getSubmitButton()).toBeDisabled();
  });

  it("delete button is disabled when PIN is empty", () => {
    render(<LoginForm />);
    expect(getDeleteButton()).toBeDisabled();
  });

  it("calls loginWithPin with the entered PIN on submit", async () => {
    mockLoginWithPin.mockResolvedValue({ ok: true, data: { staffId: "s1", name: "Alice" } });
    render(<LoginForm />);
    pressDigits("1","2","3","4");
    fireEvent.click(getSubmitButton());
    await waitFor(() => expect(mockLoginWithPin).toHaveBeenCalledWith("1234"));
  });

  it("routes a barista to /pos/queue on successful login", async () => {
    mockLoginWithPin.mockResolvedValue({ ok: true, data: { staffId: "s1", name: "Alice", role: "barista" } });
    render(<LoginForm />);
    pressDigits("1","2","3","4");
    fireEvent.click(getSubmitButton());
    await waitFor(() => expect(lastHref).toBe("/pos/queue"));
  });

  it("routes an admin to /admin on successful login", async () => {
    mockLoginWithPin.mockResolvedValue({ ok: true, data: { staffId: "s2", name: "Mia", role: "admin" } });
    render(<LoginForm />);
    pressDigits("4","3","2","1");
    fireEvent.click(getSubmitButton());
    await waitFor(() => expect(lastHref).toBe("/admin"));
  });

  it("respects a custom redirectTo prop, overriding role routing", async () => {
    mockLoginWithPin.mockResolvedValue({ ok: true, data: { staffId: "s1", name: "Alice", role: "admin" } });
    render(<LoginForm redirectTo="/pos/order/123" />);
    pressDigits("1","2","3","4");
    fireEvent.click(getSubmitButton());
    await waitFor(() => expect(lastHref).toBe("/pos/order/123"));
  });

  it("displays an error message on failed login and clears the PIN", async () => {
    mockLoginWithPin.mockResolvedValue({
      ok: false,
      code: "INVALID_CREDENTIALS",
      message: "Incorrect PIN.",
    });
    render(<LoginForm />);
    pressDigits("9","9","9","9");
    fireEvent.click(getSubmitButton());
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("Incorrect PIN.")
    );
    // PIN cleared — submit should be disabled again
    expect(getSubmitButton()).toBeDisabled();
  });

  it("displays a fallback error when the action throws", async () => {
    mockLoginWithPin.mockRejectedValue(new Error("Network error"));
    render(<LoginForm />);
    pressDigits("1","2","3","4");
    fireEvent.click(getSubmitButton());
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("Something went wrong")
    );
  });

  it("clears the error when the user starts typing a new PIN", async () => {
    mockLoginWithPin.mockResolvedValue({
      ok: false,
      code: "INVALID_CREDENTIALS",
      message: "Incorrect PIN.",
    });
    render(<LoginForm />);
    pressDigits("9","9","9","9");
    fireEvent.click(getSubmitButton());
    await waitFor(() => screen.getByRole("alert"));
    // Start typing — error should disappear
    fireEvent.click(getDigitButton("1"));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("does not allow double-submit while loading", async () => {
    let resolve: (v: unknown) => void;
    mockLoginWithPin.mockReturnValue(new Promise((res) => { resolve = res; }));
    render(<LoginForm />);
    pressDigits("1","2","3","4");
    fireEvent.click(getSubmitButton());
    // While pending, button should be disabled
    expect(getSubmitButton()).toBeDisabled();
    // Resolve to clean up
    resolve!({ ok: true, data: { staffId: "s1", name: "Alice" } });
  });

  it("uses the correct number of PIN dot indicators", () => {
    render(<LoginForm />);
    const status = screen.getByRole("status");
    // 0 digits entered
    expect(status).toHaveAccessibleName("0 digits entered");
    pressDigits("1","2","3");
    expect(status).toHaveAccessibleName("3 digits entered");
    pressDigits("4");
    expect(status).toHaveAccessibleName("4 digits entered");
  });

  it("shows the unified Staff sub-label", () => {
    render(<LoginForm />);
    expect(screen.getByText("Staff")).toBeInTheDocument();
    expect(screen.queryByText("Point of Sale")).toBeNull();
    expect(screen.queryByText("Admin")).toBeNull();
  });
});
