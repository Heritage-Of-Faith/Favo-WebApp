// Unit tests for WasteDialog (M8)

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";

// ─── Mocks ───────────────────────────────────────────────────────────────────

const mockLogWaste = vi.fn();
const mockListInventory = vi.fn();
const mockListLots = vi.fn();

vi.mock("@/server/actions/waste", () => ({
  logWaste: (...args: unknown[]) => mockLogWaste(...args),
}));
vi.mock("@/server/actions/inventory", () => ({
  listInventory: (...args: unknown[]) => mockListInventory(...args),
  listLots: (...args: unknown[]) => mockListLots(...args),
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

import WasteDialog from "@/components/pos/WasteDialog";

const ITEMS = [
  { id: "inv_milk", name: "Whole Milk", kind: "dairy", unit: "ml", lowStockThreshold: 2000, currentStock: 5000, status: "ok" as const },
  { id: "inv_beans", name: "Espresso Beans", kind: "bean", unit: "g", lowStockThreshold: 500, currentStock: 1200, status: "ok" as const },
];
const LOTS = [
  { id: "lot_milk_1", inventoryItemId: "inv_milk", inventoryItemName: "Whole Milk", sourceName: null, batchNumber: "MLK-001", roastDate: null, receivedAt: "2026-05-30T08:00:00Z", state: "active" as const, origin: null, unitCostZar: "2800", quantityReceived: "5000", quantityRemaining: 5000 },
];

beforeEach(() => {
  vi.clearAllMocks();
  mockListInventory.mockResolvedValue({ ok: true, data: { items: ITEMS } });
  mockListLots.mockResolvedValue({ ok: true, data: { lots: LOTS } });
  mockLogWaste.mockResolvedValue({ ok: true, data: { wasteLogId: "w1" } });
});

describe("WasteDialog", () => {
  it("loads inventory items on open", async () => {
    render(<WasteDialog onClose={vi.fn()} />);
    await waitFor(() => expect(mockListInventory).toHaveBeenCalled());
    expect(await screen.findByRole("dialog")).toBeDefined();
  });

  it("preselects the item passed via preselectItemId", async () => {
    render(<WasteDialog preselectItemId="inv_beans" onClose={vi.fn()} />);
    await waitFor(() => expect(mockListLots).toHaveBeenCalledWith("inv_beans"));
  });

  it("calls logWaste with category, lot, and quantity on submit", async () => {
    const onLogged = vi.fn();
    render(<WasteDialog onClose={vi.fn()} onLogged={onLogged} defaultCategory="damaged" />);
    await waitFor(() => expect(mockListLots).toHaveBeenCalled());

    const logBtn = screen.getByRole("button", { name: /log waste/i });
    await act(async () => { fireEvent.click(logBtn); });

    await waitFor(() => expect(mockLogWaste).toHaveBeenCalledTimes(1));
    const arg = mockLogWaste.mock.calls[0][0];
    expect(arg.category).toBe("damaged");
    expect(arg.quantity).toBe(1);
    expect(arg.inventoryLotId).toBe("lot_milk_1");
    expect(onLogged).toHaveBeenCalled();
  });

  it("rejects a non-positive quantity without calling logWaste", async () => {
    render(<WasteDialog onClose={vi.fn()} />);
    await waitFor(() => expect(mockListLots).toHaveBeenCalled());

    const qty = screen.getByLabelText(/quantity/i) as HTMLInputElement;
    fireEvent.change(qty, { target: { value: "0" } });
    const logBtn = screen.getByRole("button", { name: /log waste/i });
    await act(async () => { fireEvent.click(logBtn); });

    expect(mockLogWaste).not.toHaveBeenCalled();
  });
});
