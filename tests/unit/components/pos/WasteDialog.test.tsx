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

  // QA R4 barista P2-1: open and closed lots always refuse waste, so the picker
  // must not offer them; an open container is retired via Close instead.
  it("offers only sealed lots, never open or closed ones", async () => {
    mockListLots.mockResolvedValue({
      ok: true,
      data: {
        lots: [
          { ...LOTS[0], id: "lot_open", batchNumber: "OPEN-1", state: "open" },
          { ...LOTS[0], id: "lot_closed", batchNumber: "CLOSED-1", state: "closed" },
          { ...LOTS[0], id: "lot_sealed", batchNumber: "SEALED-1", state: "active" },
        ],
      },
    });
    render(<WasteDialog onClose={vi.fn()} />);
    const lot = (await screen.findByLabelText("Lot")) as HTMLSelectElement;
    const values = Array.from(lot.options).map((o) => o.value);
    expect(values).toEqual(["lot_sealed"]);
  });

  it("with only an open container, points to Close and does not log", async () => {
    mockListLots.mockResolvedValue({
      ok: true,
      data: { lots: [{ ...LOTS[0], id: "lot_open", state: "open" }] },
    });
    render(<WasteDialog onClose={vi.fn()} />);
    expect(
      await screen.findByText("This bag or carton is open. To bin what is left, tap Close on its stock tile.")
    ).toBeDefined();
    expect(screen.queryByLabelText("Lot")).toBeNull();
    expect(screen.getByRole("button", { name: /log waste/i })).toBeDisabled();
  });

  // QA R5 barista #2: Almond Milk (only closed lots) said "closed lot"; an item
  // with no lots at all said nothing and would log a lot-less row.
  it.each([
    ["only closed lots", [{ ...LOTS[0], id: "lot_closed", state: "closed" }]],
    ["no lots at all", []],
  ])("with %s, says there is no stock to waste and does not log", async (_l, lots) => {
    mockListLots.mockResolvedValue({ ok: true, data: { lots } });
    render(<WasteDialog onClose={vi.fn()} />);
    expect(await screen.findByText("No stock to waste for this item.")).toBeDefined();
    expect(screen.queryByText(/closed lot/i)).toBeNull();
    const btn = screen.getByRole("button", { name: /log waste/i });
    expect(btn).toBeDisabled();
    await act(async () => { fireEvent.click(btn); });
    expect(mockLogWaste).not.toHaveBeenCalled();
  });

  // QA R6 barista P3-1: a lot with nothing left (remaining <= 0) is refused by
  // logWaste, so the picker never offers it.
  it("does not list lots with nothing left", async () => {
    mockListLots.mockResolvedValue({
      ok: true,
      data: {
        lots: [
          { ...LOTS[0], id: "lot_neg", state: "active", quantityRemaining: -2 },
          { ...LOTS[0], id: "lot_zero", state: "active", quantityRemaining: 0 },
          { ...LOTS[0], id: "lot_ok", state: "depleted", quantityRemaining: 4 },
        ],
      },
    });
    render(<WasteDialog onClose={vi.fn()} />);
    const lot = (await screen.findByLabelText("Lot")) as HTMLSelectElement;
    expect(Array.from(lot.options).map((o) => o.value)).toEqual(["lot_ok"]);
  });

  it("with only lots at or below zero, says there is no stock to waste and does not log", async () => {
    mockListLots.mockResolvedValue({
      ok: true,
      data: { lots: [{ ...LOTS[0], id: "lot_cup", state: "active", quantityRemaining: -66 }] },
    });
    render(<WasteDialog onClose={vi.fn()} />);
    expect(await screen.findByText("No stock to waste for this item.")).toBeDefined();
    expect(screen.queryByLabelText("Lot")).toBeNull();
    expect(screen.getByRole("button", { name: /log waste/i })).toBeDisabled();
  });

  it("caps the reason at 500 characters", async () => {
    render(<WasteDialog onClose={vi.fn()} />);
    const reason = (await screen.findByLabelText(/reason/i)) as HTMLInputElement;
    expect(reason.maxLength).toBe(500);
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
