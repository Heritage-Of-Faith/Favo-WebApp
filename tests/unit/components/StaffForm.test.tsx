// StaffForm — QA r1-admin P2a (silent failures) and P1-3 (PIN refusal shown).
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import StaffForm from "@/components/admin/StaffForm";

vi.mock("@/server/actions/staff", () => ({
  createStaff: vi.fn().mockResolvedValue({
    ok: false, code: "PIN_TAKEN", message: "That PIN can't be used. Choose a different PIN.",
  }),
  setStaffPin: vi.fn().mockResolvedValue({ ok: true, data: undefined }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

beforeEach(() => vi.clearAllMocks());

describe("StaffForm — add", () => {
  it("shows a message for an empty name", () => {
    render(<StaffForm onClose={vi.fn()} onSaved={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Add staff" }));
    expect(screen.getByRole("alert").textContent).toBe("Enter a name of at least 2 characters.");
  });

  it("shows a message for a 3-digit PIN", () => {
    render(<StaffForm onClose={vi.fn()} onSaved={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "QA Temp" } });
    fireEvent.change(screen.getByLabelText("Initial PIN"), { target: { value: "123" } });
    fireEvent.click(screen.getByRole("button", { name: "Add staff" }));
    expect(screen.getByRole("alert").textContent).toBe("PIN must be 4–6 digits.");
  });

  it("shows the server's PIN refusal in the dialog", async () => {
    render(<StaffForm onClose={vi.fn()} onSaved={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "QA Temp" } });
    fireEvent.change(screen.getByLabelText("Initial PIN"), { target: { value: "1234" } });
    fireEvent.click(screen.getByRole("button", { name: "Add staff" }));
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toBe("That PIN can't be used. Choose a different PIN.")
    );
  });
});

// QA R6-7: typing in the PIN box (even a non-digit that is stripped) clears a
// stale PIN error.
describe("StaffForm — stale PIN error", () => {
  it("clears the server's PIN refusal as soon as the user types in the PIN box", async () => {
    render(<StaffForm onClose={vi.fn()} onSaved={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "QA Temp" } });
    fireEvent.change(screen.getByLabelText("Initial PIN"), { target: { value: "1234" } });
    fireEvent.click(screen.getByRole("button", { name: "Add staff" }));
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    fireEvent.change(screen.getByLabelText("Initial PIN"), { target: { value: "1234a" } });
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("StaffForm — reset PIN", () => {
  it("shows a message for a 2-digit PIN and does not call the server", async () => {
    const { setStaffPin } = await import("@/server/actions/staff");
    render(<StaffForm staffId="s1" staffName="Sam" onClose={vi.fn()} onSaved={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("New PIN"), { target: { value: "12" } });
    fireEvent.click(screen.getByRole("button", { name: "Update PIN" }));
    expect(screen.getByRole("alert").textContent).toBe("PIN must be 4–6 digits.");
    expect(setStaffPin).not.toHaveBeenCalled();
  });

  it("plain reset never asks the server to reactivate", async () => {
    const { setStaffPin } = await import("@/server/actions/staff");
    render(<StaffForm staffId="s1" staffName="Sam" onClose={vi.fn()} onSaved={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("New PIN"), { target: { value: "5555" } });
    fireEvent.click(screen.getByRole("button", { name: "Update PIN" }));
    await waitFor(() => expect(setStaffPin).toHaveBeenCalled());
    expect(setStaffPin).toHaveBeenCalledWith({ staffId: "s1", newPin: "5555", reactivate: undefined });
  });
});

describe("StaffForm — reactivate (QA R2-5/R2-6)", () => {
  it("is labelled as reactivation and sends reactivate: true", async () => {
    const { setStaffPin } = await import("@/server/actions/staff");
    render(<StaffForm staffId="s1" staffName="Sam" reactivate onClose={vi.fn()} onSaved={vi.fn()} />);
    expect(screen.getByText("Reactivate — Sam")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("New PIN"), { target: { value: "5555" } });
    fireEvent.click(screen.getByRole("button", { name: "Reactivate" }));
    await waitFor(() =>
      expect(setStaffPin).toHaveBeenCalledWith({ staffId: "s1", newPin: "5555", reactivate: true })
    );
  });
});
