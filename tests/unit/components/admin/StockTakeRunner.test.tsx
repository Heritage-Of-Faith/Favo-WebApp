// QA R4-SEC-2: a refused count ("That count is too large…") must not stay on
// screen after a later valid save moves on to the next lot.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";

const mockRecord = vi.fn();
vi.mock("@/server/actions/stock-takes", () => ({
  recordStockTakeLine: (...a: unknown[]) => mockRecord(...a),
  closeStockTake: vi.fn(),
  getStockTake: vi.fn(),
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), dismiss: vi.fn() },
}));

import { toast } from "sonner";
import StockTakeRunner from "@/components/admin/StockTakeRunner";
import type { StockTake } from "@/lib/types";

const line = (id: string) => ({
  id,
  inventoryLotId: `lot_${id}`,
  inventoryItemName: "Oat Milk",
  unit: "units",
  expected: 4,
  counted: null,
  variancePct: null,
});
const TAKE: StockTake = {
  id: "take_1",
  kind: "spot",
  startedAt: "2026-10-27T08:00:00Z",
  completedAt: null,
  byStaffId: "s1",
  byStaffName: "Admin",
  variancePct: null,
  lines: [line("a"), line("b"), line("c")],
} as StockTake;

beforeEach(() => vi.clearAllMocks());

describe("StockTakeRunner — refused count message", () => {
  it("clears the 'too large' error once a later count saves", async () => {
    const tooLarge = "That count is too large. Enter 10 000 000 or less.";
    mockRecord
      .mockResolvedValueOnce({ ok: false, code: "VALIDATION_ERROR", message: tooLarge })
      .mockResolvedValueOnce({ ok: true, data: {} });
    render(<StockTakeRunner initialTake={TAKE} />);

    const input = screen.getByLabelText(/counted quantity/i);
    fireEvent.change(input, { target: { value: "99999999" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /save & next/i })); });
    expect(toast.error).toHaveBeenCalledWith(tooLarge, { id: "stock-take-line-error" });
    expect(toast.dismiss).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText(/counted quantity/i), { target: { value: "5" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /save & next/i })); });
    await waitFor(() => expect(toast.dismiss).toHaveBeenCalledWith("stock-take-line-error"));
  });
});
