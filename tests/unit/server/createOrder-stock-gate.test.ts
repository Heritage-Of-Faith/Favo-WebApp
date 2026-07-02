// Regression test: createOrder must reject BEFORE payment when a recipe
// ingredient (e.g. an empty milk/bean container) can't cover the order, rather
// than taking the customer's money and only discovering it's unfulfillable
// when the barista hits "Start Making" (deductForOrder throws at that point).
//
// checkRecipeStock (lot-picker.ts) is mocked here — its own DB-level rules
// (cup-container totals vs. single-oldest-active-lot for quantity items) are
// exercised for real by the container-model deduction tests; this file only
// verifies createOrder wires the gate correctly.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/server/auth/guard", () => ({
  authorize: vi.fn(async () => ({ ok: true, session: { id: "staff1", role: "barista" } })),
}));

let menuRows: { id: string; name: string; currentPriceZar: number; recipeId: string | null }[] = [];

vi.mock("@/lib/db", () => ({
  db: {
    select: () => ({ from: () => ({ where: () => Promise.resolve(menuRows) }) }),
    transaction: async (cb: (tx: unknown) => Promise<void>) =>
      cb({ insert: () => ({ values: () => Promise.resolve() }) }),
    insert: () => ({ values: () => Promise.resolve() }),
  },
}));

vi.mock("@/server/audit", () => ({ writeAudit: vi.fn(async () => {}) }));
vi.mock("@/server/queue/notify", () => ({ notifyOrderChange: vi.fn(async () => {}) }));
vi.mock("@/server/orders/pricing", () => ({ computeOrderTotalZar: () => 4000 }));
vi.mock("@/server/yoco/client", () => ({
  createPaymentIntent: vi.fn(async () => ({ id: "ch_1", clientSecret: "cs_1" })),
}));

const mockCheckRecipeStock = vi.fn();
vi.mock("@/server/inventory/lot-picker", () => ({
  checkRecipeStock: (...a: unknown[]) => mockCheckRecipeStock(...a),
}));

import { createOrder } from "@/server/actions/orders";

beforeEach(() => {
  vi.clearAllMocks();
  menuRows = [{ id: "mi-latte", name: "Latte", currentPriceZar: 4000, recipeId: "recipe_latte" }];
});

const LATTE_ORDER = { items: [{ menuItemId: "mi-latte", quantity: 1, modifications: [] }] };

describe("createOrder — pre-payment stock gate", () => {
  it("rejects with OUT_OF_STOCK before charging when a recipe ingredient is unavailable", async () => {
    mockCheckRecipeStock.mockResolvedValue({ ok: false, itemName: "Full-Cream Milk (carton)" });

    const res = await createOrder(LATTE_ORDER);

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.code).toBe("OUT_OF_STOCK");
      expect(res.message).toContain("Full-Cream Milk (carton)");
    }
  });

  it("checks stock for the ordered quantity, not a fixed 1", async () => {
    mockCheckRecipeStock.mockResolvedValue({ ok: true });

    await createOrder({ items: [{ menuItemId: "mi-latte", quantity: 3, modifications: [] }] });

    expect(mockCheckRecipeStock).toHaveBeenCalledWith("recipe_latte", 3, expect.anything());
  });

  it("still creates the order when stock is available", async () => {
    mockCheckRecipeStock.mockResolvedValue({ ok: true });

    const res = await createOrder(LATTE_ORDER);

    expect(res.ok).toBe(true);
    expect(mockCheckRecipeStock).toHaveBeenCalledWith("recipe_latte", 1, expect.anything());
  });

  it("skips the stock check for items with no recipe (food/merch)", async () => {
    menuRows = [{ id: "mi-croissant", name: "Croissant", currentPriceZar: 3500, recipeId: null }];

    const res = await createOrder({
      items: [{ menuItemId: "mi-croissant", quantity: 1, modifications: [] }],
    });

    expect(res.ok).toBe(true);
    expect(mockCheckRecipeStock).not.toHaveBeenCalled();
  });
});
