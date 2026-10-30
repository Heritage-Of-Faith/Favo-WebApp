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

describe("StaffForm — reset PIN", () => {
  it("shows a message for a 2-digit PIN and does not call the server", async () => {
    const { setStaffPin } = await import("@/server/actions/staff");
    render(<StaffForm staffId="s1" staffName="Sam" onClose={vi.fn()} onSaved={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("New PIN"), { target: { value: "12" } });
    fireEvent.click(screen.getByRole("button", { name: "Update PIN" }));
    expect(screen.getByRole("alert").textContent).toBe("PIN must be 4–6 digits.");
    expect(setStaffPin).not.toHaveBeenCalled();
  });
});
