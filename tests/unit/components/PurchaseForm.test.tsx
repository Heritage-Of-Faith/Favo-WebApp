// PurchaseForm — QA r1-admin P1-1 (visible unit cost) and P2a (field messages).
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import PurchaseForm from "@/components/admin/PurchaseForm";

vi.mock("@/server/actions/purchases", () => ({
  recordPurchase: vi.fn().mockResolvedValue({ ok: true, data: { purchaseIds: ["p1"] } }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const ITEMS = [{ id: "inv_item_espresso_beans", name: "Espresso Beans", unit: "g", kind: "bean" }];

function renderForm() {
  return render(<PurchaseForm items={ITEMS} canApprove onClose={vi.fn()} onSaved={vi.fn()} />);
}

beforeEach(() => vi.clearAllMocks());

describe("PurchaseForm", () => {
  it("shows the derived cost per g next to the inputs: R225 for 500 g = R0.4500 (45.0000 c)", () => {
    renderForm();
    fireEvent.change(screen.getByLabelText("Line 1 quantity (g)"), { target: { value: "500" } });
    fireEvent.change(screen.getByLabelText("Line 1 total paid (R)"), { target: { value: "225" } });
    expect(screen.getByTestId("line-1-unit-cost").textContent).toBe("Cost per g: R0.4500 (45.0000 c)");
  });

  it("R20 for 100 g previews R0.2000 (20.0000 c)", () => {
    renderForm();
    fireEvent.change(screen.getByLabelText("Line 1 quantity (g)"), { target: { value: "100" } });
    fireEvent.change(screen.getByLabelText("Line 1 total paid (R)"), { target: { value: "20" } });
    expect(screen.getByTestId("line-1-unit-cost").textContent).toBe("Cost per g: R0.2000 (20.0000 c)");
  });

  it("sends unitCostZar 45.0000 for R225 / 500 g", async () => {
    const { recordPurchase } = await import("@/server/actions/purchases");
    renderForm();
    fireEvent.change(screen.getByLabelText("Source"), { target: { value: "Origin" } });
    fireEvent.change(screen.getByLabelText("Line 1 quantity (g)"), { target: { value: "500" } });
    fireEvent.change(screen.getByLabelText("Line 1 total paid (R)"), { target: { value: "225" } });
    fireEvent.click(screen.getByRole("button", { name: "Record purchase" }));
    await waitFor(() => expect(recordPurchase).toHaveBeenCalled());
    expect(vi.mocked(recordPurchase).mock.calls[0]![0].items[0]).toMatchObject({
      quantity: 500,
      totalZar: 22500,
      unitCostZar: "45.0000",
    });
  });

  it("shows a field message for an empty source instead of failing silently", () => {
    renderForm();
    fireEvent.click(screen.getByRole("button", { name: "Record purchase" }));
    expect(screen.getByRole("alert").textContent).toBe("Enter a source name.");
  });

  it("shows a field message for an empty total", () => {
    renderForm();
    fireEvent.change(screen.getByLabelText("Source"), { target: { value: "Origin" } });
    fireEvent.change(screen.getByLabelText("Line 1 quantity (g)"), { target: { value: "500" } });
    fireEvent.click(screen.getByRole("button", { name: "Record purchase" }));
    expect(screen.getByRole("alert").textContent).toMatch(/total paid/);
  });

  it("caps the source at 100 characters", () => {
    renderForm();
    expect(screen.getByLabelText("Source").getAttribute("maxLength")).toBe("100");
  });
});
