// FavoPicker — AT-143/144's shared editor. Drink pick, toggle vs stepper
// behaviour, repeated-id stacking on save, and the unsaved-changes guard.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";

const mockSetFavo = vi.fn();
vi.mock("@/server/actions/favo", () => ({
  setFavo: (...a: unknown[]) => mockSetFavo(...a),
}));

import FavoPicker, { formatFavoSummary } from "@/components/favo/FavoPicker";
import type { MenuItem } from "@/lib/types";
import type { FavoView } from "@/server/favo/schema";

const MENU: MenuItem[] = [
  {
    id: "menu_mocha", name: "Mocha", category: "coffee", active: true, currentPriceZar: 2500, recipeId: null,
    customisations: [
      { id: "mod_mac", name: "Macadamia Milk", priceDeltaZar: 0, substitutesInventoryItemId: "inv_mac", addsInventoryItemId: null, addsQuantity: null },
      { id: "mod_shot", name: "Extra Shot", priceDeltaZar: 1000, substitutesInventoryItemId: null, addsInventoryItemId: "inv_beans", addsQuantity: 1 },
    ],
  },
  {
    id: "menu_americano", name: "Americano", category: "coffee", active: true, currentPriceZar: 2000, recipeId: null,
    customisations: [],
  },
] as unknown as MenuItem[];

const SAVED: FavoView = {
  items: [{ menuItemId: "menu_mocha", quantity: 1, modifications: ["mod_mac", "mod_shot", "mod_shot"] }],
  updatedAt: "2026-07-09T10:00:00.000Z",
  updatedByStaffId: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  mockSetFavo.mockResolvedValue({ ok: true, data: { favo: SAVED } });
});

describe("FavoPicker", () => {
  it("saves the picked drink with stacked stepper ids (Extra Shot ×2)", async () => {
    const onSaved = vi.fn();
    render(
      <FavoPicker customerId="c1" title="Your Favo" menu={MENU} initialFavo={null}
        onSaved={onSaved} onCancel={vi.fn()} />
    );

    fireEvent.click(screen.getByRole("button", { name: /mocha/i }));
    fireEvent.click(screen.getByRole("button", { name: /macadamia milk/i }));
    fireEvent.click(screen.getByRole("button", { name: /increase extra shot/i }));
    fireEvent.click(screen.getByRole("button", { name: /increase extra shot/i }));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /save favo/i })); });

    expect(mockSetFavo).toHaveBeenCalledWith("c1", [
      { menuItemId: "menu_mocha", quantity: 1, modifications: ["mod_mac", "mod_shot", "mod_shot"] },
    ]);
    expect(onSaved).toHaveBeenCalledWith(SAVED);
  });

  it("clears customisations when a different drink is picked", async () => {
    render(
      <FavoPicker customerId="c1" title="Your Favo" menu={MENU} initialFavo={SAVED}
        onSaved={vi.fn()} onCancel={vi.fn()} />
    );
    // Initial favo pre-selects Mocha + mods; switching drink wipes them.
    fireEvent.click(screen.getByRole("button", { name: /americano/i }));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /save favo/i })); });
    expect(mockSetFavo).toHaveBeenCalledWith("c1", [
      { menuItemId: "menu_americano", quantity: 1, modifications: [] },
    ]);
  });

  it("guards dirty cancels: first tap asks, Discard then closes", () => {
    const onCancel = vi.fn();
    render(
      <FavoPicker customerId="c1" title="Your Favo" menu={MENU} initialFavo={null}
        onSaved={vi.fn()} onCancel={onCancel} />
    );
    fireEvent.click(screen.getByRole("button", { name: /mocha/i })); // dirty now
    fireEvent.click(screen.getByRole("button", { name: /^cancel$/i }));
    expect(onCancel).not.toHaveBeenCalled();
    expect(screen.getByText(/discard changes\?/i)).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: /^discard$/i }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("cancels immediately when nothing changed", () => {
    const onCancel = vi.fn();
    render(
      <FavoPicker customerId="c1" title="Your Favo" menu={MENU} initialFavo={SAVED}
        onSaved={vi.fn()} onCancel={onCancel} />
    );
    fireEvent.click(screen.getByRole("button", { name: /^cancel$/i }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("disables Save until a drink is picked", () => {
    render(
      <FavoPicker customerId="c1" title="Your Favo" menu={MENU} initialFavo={null}
        onSaved={vi.fn()} onCancel={vi.fn()} />
    );
    expect((screen.getByRole("button", { name: /save favo/i }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("formatFavoSummary", () => {
  it("renders drink + grouped customisations", () => {
    expect(formatFavoSummary(SAVED, MENU)).toBe("Mocha · Macadamia Milk, Extra Shot ×2");
  });

  it("degrades gracefully for items no longer on the menu", () => {
    const stale: FavoView = { ...SAVED, items: [{ menuItemId: "menu_gone", quantity: 1, modifications: [] }] };
    expect(formatFavoSummary(stale, MENU)).toBe("Unknown item");
  });
});
