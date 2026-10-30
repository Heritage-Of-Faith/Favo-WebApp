// MenuEditor — QA r1-admin P2a (silent price failures), P2k (deactivate confirm).
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import MenuEditor from "@/components/admin/MenuEditor";

vi.mock("@/server/actions/menu", () => ({
  getMenuAdmin: vi.fn().mockResolvedValue({
    ok: true,
    data: [{ id: "m1", name: "Mocha", category: "coffee", currentPriceZar: 4600, active: true, customisations: [] }],
  }),
  getMenuItemPriceHistory: vi.fn().mockResolvedValue({ ok: true, data: [] }),
  setMenuItemPrice: vi.fn().mockResolvedValue({ ok: true, data: {} }),
  createMenuItem: vi.fn().mockResolvedValue({ ok: true, data: { name: "x" } }),
  setMenuItemActive: vi.fn().mockResolvedValue({ ok: true, data: undefined }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("next/link", () => ({ default: ({ children }: { children: React.ReactNode }) => <a>{children}</a> }));

beforeEach(() => vi.clearAllMocks());

describe("MenuEditor", () => {
  it.each(["-5", "", "0", "abc", "45.555"])("edit price %j shows a field message and does not save", async (v) => {
    const { setMenuItemPrice } = await import("@/server/actions/menu");
    render(<MenuEditor />);
    fireEvent.click(await screen.findByRole("button", { name: "Edit price" }));
    fireEvent.change(screen.getByLabelText("New price (Rands)"), { target: { value: v } });
    fireEvent.click(screen.getByRole("button", { name: "Save price" }));
    expect(screen.getByRole("alert").textContent).toBe("Enter a price greater than R0, e.g. 42.00.");
    expect(setMenuItemPrice).not.toHaveBeenCalled();
  });

  it("add item with an empty name shows a field message", async () => {
    render(<MenuEditor />);
    fireEvent.click(await screen.findByRole("button", { name: "+ Add item" }));
    fireEvent.click(screen.getByRole("button", { name: "Add item" }));
    expect(screen.getByRole("alert").textContent).toBe("Name is required.");
  });

  it("deactivate asks first, and does nothing if you cancel", async () => {
    const { setMenuItemActive } = await import("@/server/actions/menu");
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<MenuEditor />);
    fireEvent.click(await screen.findByRole("button", { name: "Deactivate" }));
    expect(confirm).toHaveBeenCalled();
    expect(setMenuItemActive).not.toHaveBeenCalled();
    confirm.mockRestore();
  });

  it("deactivate proceeds after you confirm", async () => {
    const { setMenuItemActive } = await import("@/server/actions/menu");
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<MenuEditor />);
    fireEvent.click(await screen.findByRole("button", { name: "Deactivate" }));
    await waitFor(() => expect(setMenuItemActive).toHaveBeenCalledWith("m1", false));
    confirm.mockRestore();
  });
});
