// Stock deduction unit tests — task G9
// Tests the pure helpers and the DeductionError class without a DB connection.
// The full integration (happy path, concurrency, rollback) is covered by
// tests/e2e/phase2-acceptance.spec.ts which runs against a real staging DB.

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  willDepleteLot,
  DeductionError,
} from "@/server/inventory/lot-picker";

// ─── willDepleteLot ───────────────────────────────────────────────────────────

describe("willDepleteLot", () => {
  it("returns true when needed equals current stock (exact depletion)", () => {
    expect(willDepleteLot(100, 100)).toBe(true);
  });

  it("returns true when needed exceeds current stock", () => {
    // Should not happen (guard prevents it), but the helper is still correct.
    expect(willDepleteLot(50, 100)).toBe(true);
  });

  it("returns false when stock remains after deduction", () => {
    expect(willDepleteLot(200, 7)).toBe(false);
    expect(willDepleteLot(1000, 150)).toBe(false);
  });

  it("returns false when stock is exactly 1 unit above depletion", () => {
    expect(willDepleteLot(8, 7)).toBe(false);
  });

  it("handles zero stock correctly (already depleted)", () => {
    expect(willDepleteLot(0, 0)).toBe(true);
  });

  it("cappuccino: 7g beans from 2000g lot does NOT deplete", () => {
    expect(willDepleteLot(2000, 7)).toBe(false);
  });

  it("cappuccino: 150ml milk from 150ml remaining DOES deplete", () => {
    expect(willDepleteLot(150, 150)).toBe(true);
  });
});

// ─── DeductionError ───────────────────────────────────────────────────────────

describe("DeductionError", () => {
  it("is an instance of Error", () => {
    const err = new DeductionError("OUT_OF_STOCK", "No beans left");
    expect(err).toBeInstanceOf(Error);
  });

  it("carries the structured code", () => {
    const err = new DeductionError("OUT_OF_STOCK", "No beans left");
    expect(err.code).toBe("OUT_OF_STOCK");
    expect(err.message).toBe("No beans left");
  });

  it("NO_ACTIVE_LOT code is supported", () => {
    const err = new DeductionError("NO_ACTIVE_LOT", "No active lot for item x");
    expect(err.code).toBe("NO_ACTIVE_LOT");
  });

  it("name is DeductionError (not just Error)", () => {
    const err = new DeductionError("OUT_OF_STOCK", "test");
    expect(err.name).toBe("DeductionError");
  });

  it("can be caught by type narrowing", () => {
    const err = new DeductionError("OUT_OF_STOCK", "test");
    expect(err instanceof DeductionError).toBe(true);
  });
});

// ─── deductForOrder — mocked DB ───────────────────────────────────────────────

// We mock the Drizzle DB at module level to avoid needing a real PG connection.
// This verifies the deduction logic flow without hitting the database.

vi.mock("@db/index", () => ({
  db: {
    insert: vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue([]) }),
    update: vi.fn().mockReturnValue({ set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }) }),
    select: vi.fn(),
    execute: vi.fn().mockResolvedValue([]),
    transaction: vi.fn(),
  },
}));

vi.mock("@/server/audit", () => ({
  writeAudit: vi.fn().mockResolvedValue(undefined),
}));

// Helper: build a minimal mock tx that simulates specific query results
function buildMockTx({
  orderLines = [] as { orderItemId: string; menuItemId: string; orderQty: number; recipeId: string | null }[],
  ingredients = [] as { inventoryItemId: string; quantity: number; unit: string }[],
  lotId = "lot_001",
  currentStock = 2000,
}: {
  orderLines?: { orderItemId: string; menuItemId: string; orderQty: number; recipeId: string | null }[];
  ingredients?: { inventoryItemId: string; quantity: number; unit: string }[];
  lotId?: string;
  currentStock?: number;
}) {
  let callCount = 0;
  const mockSelect = vi.fn().mockImplementation(() => {
    callCount++;
    const chain = {
      from: vi.fn().mockReturnThis(),
      innerJoin: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      for: vi.fn().mockImplementation(() => {
        // FOR UPDATE call — returns lot
        return Promise.resolve([{ id: lotId }]);
      }),
    };
    // First select = order items, second = recipe ingredients, third = stock sum
    if (callCount === 1) {
      chain.where = vi.fn().mockResolvedValue(orderLines);
    } else if (callCount === 2) {
      chain.where = vi.fn().mockResolvedValue(ingredients);
    } else {
      // Stock sum query
      chain.from = vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([{ total: currentStock }]),
      });
    }
    return chain;
  });

  return {
    select: mockSelect,
    insert: vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue([]) }),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }),
    }),
    execute: vi.fn().mockResolvedValue([]),
  };
}

describe("deductForOrder — mocked DB", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("skips deduction for order items with no recipe (food items)", async () => {
    // Import inside the test so mocks are applied
    const { deductForOrder } = await import("@/server/orders/deduction");
    const { writeAudit } = await import("@/server/audit");

    const tx = buildMockTx({
      orderLines: [
        { orderItemId: "oi_1", menuItemId: "menu_croissant", orderQty: 1, recipeId: null },
      ],
      ingredients: [],
    });

    await deductForOrder("order_001", tx as never, "staff_sam");

    // No audit written — nothing to deduct
    expect(writeAudit).not.toHaveBeenCalled();
  });

  it("throws OUT_OF_STOCK when stock < needed", async () => {
    const { deductForOrder } = await import("@/server/orders/deduction");
    const { pickActiveLot } = await import("@/server/inventory/lot-picker");

    // Mock pickActiveLot to return a lot with insufficient stock
    vi.spyOn(
      await import("@/server/inventory/lot-picker"),
      "pickActiveLot"
    ).mockResolvedValueOnce({ id: "lot_001", currentStock: 3 });

    const tx = {
      select: vi.fn()
        .mockReturnValueOnce({
          from: vi.fn().mockReturnValue({
            innerJoin: vi.fn().mockReturnValue({
              where: vi.fn().mockResolvedValue([
                { orderItemId: "oi_1", menuItemId: "menu_cappuccino", orderQty: 1, recipeId: "recipe_cappuccino" },
              ]),
            }),
          }),
        })
        .mockReturnValueOnce({
          from: vi.fn().mockReturnValue({
            innerJoin: vi.fn().mockReturnValue({
              where: vi.fn().mockResolvedValue([
                // Non-cup item → quantity path → pickActiveLot (mocked, stock 3).
                { inventoryItemId: "inv_item_hot_choc_powder", quantity: 7, itemUnit: "g" },
              ]),
            }),
          }),
        }),
      insert: vi.fn(),
      update: vi.fn(),
      execute: vi.fn(),
    };

    await expect(
      deductForOrder("order_001", tx as never, "staff_sam")
    ).rejects.toThrow(DeductionError);

    void pickActiveLot; // suppress unused warning
  });

  it("container item: deducts one cup per drink from the open container", async () => {
    const { deductForOrder } = await import("@/server/orders/deduction");
    const { writeAudit } = await import("@/server/audit");

    // Open container has plenty of cups — single movement, no spanning.
    vi.spyOn(
      await import("@/server/inventory/lot-picker"),
      "pickOpenContainer"
    ).mockResolvedValueOnce({ id: "lot_milk_open", currentStock: 11 });

    const values = vi.fn().mockResolvedValue([]);
    const tx = {
      select: vi.fn()
        .mockReturnValueOnce({
          from: vi.fn().mockReturnValue({
            innerJoin: vi.fn().mockReturnValue({
              where: vi.fn().mockResolvedValue([
                { orderItemId: "oi_1", menuItemId: "menu_latte", orderQty: 2, recipeId: "recipe_latte" },
              ]),
            }),
          }),
        })
        .mockReturnValueOnce({
          from: vi.fn().mockReturnValue({
            innerJoin: vi.fn().mockReturnValue({
              where: vi.fn().mockResolvedValue([
                { inventoryItemId: "inv_item_whole_milk_cups", quantity: 1, itemUnit: "cup" },
              ]),
            }),
          }),
        }),
      insert: vi.fn().mockReturnValue({ values }),
      update: vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }),
      }),
      execute: vi.fn().mockResolvedValue([]),
    };

    await deductForOrder("order_001", tx as never, "staff_sam");

    // 2 lattes → 2 cups of milk in a single movement against the open container.
    expect(values).toHaveBeenCalledTimes(1);
    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        inventoryLotId: "lot_milk_open",
        delta: -2,
        kind: "deduction",
        relatedOrderId: "order_001",
      })
    );
    expect(writeAudit).toHaveBeenCalledTimes(1);
  });

  it("AT-145: substitution deducts the chosen milk, not the base recipe ingredient", async () => {
    const { deductForOrder } = await import("@/server/orders/deduction");
    const { writeAudit } = await import("@/server/audit");

    vi.spyOn(
      await import("@/server/inventory/lot-picker"),
      "pickOpenContainer"
    ).mockResolvedValueOnce({ id: "lot_oat_milk_open", currentStock: 10 });

    const values = vi.fn().mockResolvedValue([]);
    const tx = {
      select: vi.fn()
        // 1. order lines, with an Oat Milk modification selected
        .mockReturnValueOnce({
          from: vi.fn().mockReturnValue({
            innerJoin: vi.fn().mockReturnValue({
              where: vi.fn().mockResolvedValue([
                {
                  orderItemId: "oi_1",
                  menuItemId: "menu_cappuccino",
                  orderQty: 1,
                  recipeId: "recipe_cappuccino",
                  modifications: [{ id: "mod_cappuccino_oat_milk", name: "Oat Milk", priceDeltaZar: 800 }],
                },
              ]),
            }),
          }),
        })
        // 2. modRows — the customisation's inventory effect
        .mockReturnValueOnce({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([
              { id: "mod_cappuccino_oat_milk", substitutesInventoryItemId: "inv_item_oat_milk", addsInventoryItemId: null, addsQuantity: null },
            ]),
          }),
        })
        // 3. effectItemRows — the substitute's own kind + unit
        .mockReturnValueOnce({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([
              { id: "inv_item_oat_milk", kind: "milk", unit: "cup" },
            ]),
          }),
        })
        // 4. base recipe ingredients — dairy milk (cup, milk kind)
        .mockReturnValueOnce({
          from: vi.fn().mockReturnValue({
            innerJoin: vi.fn().mockReturnValue({
              where: vi.fn().mockResolvedValue([
                { inventoryItemId: "inv_item_whole_milk_cups", quantity: 1, itemUnit: "cup", itemKind: "milk" },
              ]),
            }),
          }),
        }),
      insert: vi.fn().mockReturnValue({ values }),
      update: vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }),
      }),
      execute: vi.fn().mockResolvedValue([]),
    };

    await deductForOrder("order_001", tx as never, "staff_sam");

    // Deducted the OAT milk lot, never the dairy one.
    expect(values).toHaveBeenCalledTimes(1);
    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({ inventoryLotId: "lot_oat_milk_open", delta: -1 })
    );
    expect(writeAudit).toHaveBeenCalledTimes(1);
  });

  it("AT-145: additive customisation (Extra Shot ×2) deducts twice, on top of the base recipe", async () => {
    const { deductForOrder } = await import("@/server/orders/deduction");

    // Base recipe deducts beans once (americano); each Extra Shot adds one more.
    vi.spyOn(
      await import("@/server/inventory/lot-picker"),
      "pickOpenContainer"
    ).mockResolvedValue({ id: "lot_beans_open", currentStock: 100 });

    const values = vi.fn().mockResolvedValue([]);
    const tx = {
      select: vi.fn()
        .mockReturnValueOnce({
          from: vi.fn().mockReturnValue({
            innerJoin: vi.fn().mockReturnValue({
              where: vi.fn().mockResolvedValue([
                {
                  orderItemId: "oi_1",
                  menuItemId: "menu_americano",
                  orderQty: 1,
                  recipeId: "recipe_americano",
                  modifications: [
                    { id: "mod_americano_extra_shot", name: "Extra Shot", priceDeltaZar: 1000 },
                    { id: "mod_americano_extra_shot", name: "Extra Shot", priceDeltaZar: 1000 },
                  ],
                },
              ]),
            }),
          }),
        })
        // modRows — same customisation queried once via inArray, one row back
        .mockReturnValueOnce({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([
              { id: "mod_americano_extra_shot", substitutesInventoryItemId: null, addsInventoryItemId: "inv_item_beans_cups", addsQuantity: 1 },
            ]),
          }),
        })
        // effectItemRows
        .mockReturnValueOnce({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([
              { id: "inv_item_beans_cups", kind: "bean", unit: "cup" },
            ]),
          }),
        })
        // base recipe ingredients — beans, cup
        .mockReturnValueOnce({
          from: vi.fn().mockReturnValue({
            innerJoin: vi.fn().mockReturnValue({
              where: vi.fn().mockResolvedValue([
                { inventoryItemId: "inv_item_beans_cups", quantity: 1, itemUnit: "cup", itemKind: "bean" },
              ]),
            }),
          }),
        }),
      insert: vi.fn().mockReturnValue({ values }),
      update: vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }),
      }),
      execute: vi.fn().mockResolvedValue([]),
    };

    await deductForOrder("order_001", tx as never, "staff_sam");

    // 1 cup for the base recipe + 2 cups for the two Extra Shot selections = 3 calls.
    expect(values).toHaveBeenCalledTimes(3);
    for (const call of values.mock.calls) {
      expect(call[0]).toEqual(expect.objectContaining({ inventoryLotId: "lot_beans_open", delta: -1 }));
    }
  });

  it("OUT_OF_STOCK has the correct error code", async () => {
    const { deductForOrder } = await import("@/server/orders/deduction");

    vi.spyOn(
      await import("@/server/inventory/lot-picker"),
      "pickActiveLot"
    ).mockResolvedValueOnce({ id: "lot_001", currentStock: 3 });

    const tx = {
      select: vi.fn()
        .mockReturnValueOnce({
          from: vi.fn().mockReturnValue({
            innerJoin: vi.fn().mockReturnValue({
              where: vi.fn().mockResolvedValue([
                { orderItemId: "oi_1", menuItemId: "menu_cappuccino", orderQty: 1, recipeId: "recipe_cappuccino" },
              ]),
            }),
          }),
        })
        .mockReturnValueOnce({
          from: vi.fn().mockReturnValue({
            innerJoin: vi.fn().mockReturnValue({
              where: vi.fn().mockResolvedValue([
                // Non-cup item → quantity path → pickActiveLot (mocked, stock 3).
                { inventoryItemId: "inv_item_hot_choc_powder", quantity: 7, itemUnit: "g" },
              ]),
            }),
          }),
        }),
      insert: vi.fn(),
      update: vi.fn(),
      execute: vi.fn(),
    };

    try {
      await deductForOrder("order_001", tx as never, "staff_sam");
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(DeductionError);
      expect((err as DeductionError).code).toBe("OUT_OF_STOCK");
    }
  });
});

// ─── transitionOrder state machine (existing pure tests) ─────────────────────

import { canTransition } from "@/server/orders/state-machine";

describe("canTransition (deduction boundary)", () => {
  it("ordered → in_progress is the deduction trigger", () => {
    expect(canTransition("ordered", "in_progress")).toBe(true);
  });

  it("in_progress → in_progress is rejected (no double-deduction)", () => {
    expect(canTransition("in_progress", "in_progress")).toBe(false);
  });

  it("collected → any is rejected (no post-completion deductions)", () => {
    expect(canTransition("collected", "in_progress")).toBe(false);
    expect(canTransition("collected", "ordered")).toBe(false);
  });
});
