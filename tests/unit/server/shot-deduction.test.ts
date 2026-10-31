// AT-182 · REQ-137 · REQ-105 · DEC-09 · PRD §7.0.2 shot_factor, §10.5(3).
//
// REQ-137: "Given an order line at n shots · When stock deducts at
// `in_progress` · Then coffee deducts n × the base recipe quantity and every
// other ingredient deducts exactly 1 ×"
// REQ-105: "Given a line with quantity n · When gross or COGS is computed ·
// Then the price, the surcharge, the modifications, the cup and the lid are
// each multiplied by n"
// §7.0.2: "shot_factor = order_items.shots for the COFFEE ingredient, 1 for
// every other ingredient" — "coffee × shots, same cup, same lid, same milk."
//
// The coffee ingredient is the recipe ingredient of inventory kind 'bean'.
// order_items.shots is integer NOT NULL DEFAULT 1, CHECK BETWEEN 1 AND 4
// (db/schema.ts) — a missing / null / 0 value can only come from a caller that
// did not read the column, and is treated as 1 shot.
//
// Quantities only. Cost (line_cogs / order_cogs) is AT-188 — no money here.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@db/index", () => ({ db: {} }));
vi.mock("@/server/audit", () => ({ writeAudit: vi.fn().mockResolvedValue(undefined) }));

type Ing = { inventoryItemId: string; quantity: number; itemUnit: string; itemKind: string };
type Line = { menuItemId: string; recipeId: string | null; orderQty: number; shots?: number | null };

const BEANS: Ing = { inventoryItemId: "inv_item_beans_cups", quantity: 1, itemUnit: "cup", itemKind: "bean" };
const MILK: Ing = { inventoryItemId: "inv_item_whole_milk_cups", quantity: 1, itemUnit: "cup", itemKind: "milk" };
const CUP_8OZ: Ing = { inventoryItemId: "inv_item_cup_8oz", quantity: 1, itemUnit: "unit", itemKind: "packaging" };
const CUP_12OZ: Ing = { inventoryItemId: "inv_item_cup_12oz", quantity: 1, itemUnit: "unit", itemKind: "packaging" };
const LID: Ing = { inventoryItemId: "inv_item_lid", quantity: 1, itemUnit: "unit", itemKind: "packaging" };
const HOT_CHOC: Ing = { inventoryItemId: "inv_item_hot_choc_powder", quantity: 20, itemUnit: "g", itemKind: "other" };
const SYRUP: Ing = { inventoryItemId: "inv_item_vanilla_syrup", quantity: 10, itemUnit: "ml", itemKind: "syrup" };

// Ingredient lists as seeded in db/seed/recipes.ts.
const RECIPES: Record<string, Ing[]> = {
  recipe_cappuccino: [BEANS, MILK, CUP_8OZ, LID],
  recipe_americano: [BEANS, CUP_8OZ],
  recipe_mocha: [BEANS, HOT_CHOC, MILK, CUP_12OZ, LID],
  recipe_hot_chocolate: [HOT_CHOC, MILK, CUP_12OZ, LID],
  // A synthetic recipe carrying a non-milk, non-packaging ingredient (syrup).
  recipe_vanilla_cappuccino: [BEANS, MILK, SYRUP, CUP_8OZ, LID],
};

/**
 * Fake tx answering by query shape. The recipe-ingredient reads come one per
 * recipe line, in line order, so they are answered from a queue.
 */
function buildTx(lines: Line[], modes: string[]) {
  const values = vi.fn().mockResolvedValue([]);
  const recipeQueue = lines.filter((l) => l.recipeId).map((l) => RECIPES[l.recipeId as string]);
  const select = vi.fn().mockImplementation((fields: Record<string, unknown>) => {
    const keys = Object.keys(fields ?? {});
    let rows: unknown[];
    if (keys.includes("orderItemId")) {
      rows = lines.map((l, i) => ({
        orderItemId: `oi_${i}`,
        menuItemId: l.menuItemId,
        orderQty: l.orderQty,
        recipeId: l.recipeId,
        modifications: [],
        ...(l.shots === undefined ? {} : { shots: l.shots }),
      }));
    } else if (keys.includes("itemKind")) {
      rows = recipeQueue.shift() ?? [];
    } else if (keys.includes("revenueDay")) {
      rows = [{ revenueDay: "2026-08-16" }];
    } else if (keys.includes("mode")) {
      rows = modes.map((mode) => ({ mode }));
    } else {
      throw new Error(`unexpected select: ${keys.join(",")}`);
    }
    const chain = { from: () => chain, innerJoin: () => chain, where: () => Promise.resolve(rows) };
    return chain;
  });
  return {
    tx: {
      select,
      insert: vi.fn().mockReturnValue({ values }),
      update: vi.fn().mockReturnValue({ set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }) }),
      execute: vi.fn().mockResolvedValue([]),
    },
    values,
  };
}

/** Runs deductForOrder and returns the total units deducted per inventory item. */
async function deducted(lines: Line[], modes: string[] = ["sunday"]) {
  const lotPicker = await import("@/server/inventory/lot-picker");
  // Lot id = item id, with ample stock, so every take is the whole request.
  vi.spyOn(lotPicker, "pickOpenContainer").mockImplementation(async (itemId: string) => ({
    id: itemId, currentStock: 1000, isLegacyLot: true,
  }));
  vi.spyOn(lotPicker, "pickActiveLot").mockImplementation(async (itemId: string) => ({
    id: itemId, currentStock: 100000, isLegacyLot: true,
  }));
  const { deductForOrder } = await import("@/server/orders/deduction");
  const { tx, values } = buildTx(lines, modes);
  await deductForOrder("order_001", tx as never, "staff_thandeka");
  const out: Record<string, number> = {};
  for (const [row] of values.mock.calls as [{ inventoryLotId: string; delta: number }][]) {
    out[row.inventoryLotId] = (out[row.inventoryLotId] ?? 0) - row.delta;
  }
  return out;
}

const capp = (orderQty: number, shots?: number | null): Line => ({
  menuItemId: "menu_cappuccino", recipeId: "recipe_cappuccino", orderQty, shots,
});

describe("REQ-137 — coffee deducts shots × the base quantity, everything else 1×", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("2-shot Cappuccino, quantity 1 (Sunday): beans 2, milk/cup/lid 1 each", async () => {
    expect(await deducted([capp(1, 2)])).toEqual({
      inv_item_beans_cups: 2,
      inv_item_whole_milk_cups: 1,
      inv_item_cup_8oz: 1,
      inv_item_lid: 1,
    });
  });

  it("2-shot line with syrup: syrup deducts its recipe quantity exactly once", async () => {
    const out = await deducted([{ menuItemId: "menu_x", recipeId: "recipe_vanilla_cappuccino", orderQty: 1, shots: 2 }]);
    expect(out.inv_item_beans_cups).toBe(2);
    expect(out.inv_item_vanilla_syrup).toBe(10);
    expect(out.inv_item_whole_milk_cups).toBe(1);
  });

  it("2-shot Cappuccino on a weekday: beans 2, milk 1, and still no cup or lid (#263 / REQ-125)", async () => {
    expect(await deducted([capp(1, 2)], ["weekday"])).toEqual({
      inv_item_beans_cups: 2,
      inv_item_whole_milk_cups: 1,
    });
  });

  it("1-shot Cappuccino: beans 1 (unchanged behaviour)", async () => {
    expect(await deducted([capp(1, 1)])).toEqual({
      inv_item_beans_cups: 1,
      inv_item_whole_milk_cups: 1,
      inv_item_cup_8oz: 1,
      inv_item_lid: 1,
    });
  });

  it("quantity 2 at 2 shots composes: beans 4, everything else 2 (REQ-105 + REQ-137)", async () => {
    expect(await deducted([capp(2, 2)])).toEqual({
      inv_item_beans_cups: 4,
      inv_item_whole_milk_cups: 2,
      inv_item_cup_8oz: 2,
      inv_item_lid: 2,
    });
  });

  it("4-shot line deducts 4 beans and 1 of everything else", async () => {
    expect(await deducted([capp(1, 4)])).toEqual({
      inv_item_beans_cups: 4,
      inv_item_whole_milk_cups: 1,
      inv_item_cup_8oz: 1,
      inv_item_lid: 1,
    });
  });

  it.each([
    ["absent", undefined],
    ["null", null],
    ["0", 0],
  ])("shots %s behaves as 1 shot", async (_label, shots) => {
    expect((await deducted([capp(1, shots)])).inv_item_beans_cups).toBe(1);
  });

  it("a recipe with no coffee (Hot Chocolate) ignores shots entirely", async () => {
    expect(await deducted([{ menuItemId: "menu_hot_chocolate", recipeId: "recipe_hot_chocolate", orderQty: 1, shots: 2 }])).toEqual({
      inv_item_hot_choc_powder: 20,
      inv_item_whole_milk_cups: 1,
      inv_item_cup_12oz: 1,
      inv_item_lid: 1,
    });
  });
});

// ─── FIXTURE-A (PRD §7.0.3, Sunday 2026-08-16) — deduction quantities only ──

const americano: Line = { menuItemId: "menu_americano", recipeId: "recipe_americano", orderQty: 1, shots: 1 };
const hotChoc: Line = { menuItemId: "menu_hot_chocolate", recipeId: "recipe_hot_chocolate", orderQty: 1, shots: 1 };
const mocha2: Line = { menuItemId: "menu_mocha", recipeId: "recipe_mocha", orderQty: 2, shots: 1 };

// The 13 FAVO orders, as listed in §7.0.3's per-order table.
const FIXTURE_A: Record<string, Line[]> = {
  "#2649": [capp(1, 2)],
  "#2643": [capp(1, 2)],
  "#2642": [capp(1, 2)],
  "#2640": [capp(1, 2)],
  "#2639": [capp(1, 2)],
  "#2648": [capp(1, 2), capp(1, 1)],
  "#2647": [americano],
  "#2645": [capp(2, 2)],
  "#2636": [capp(2, 2)],
  "#2644": [hotChoc],
  "#2641": [hotChoc],
  "#2638": [mocha2],
  "#2637": [capp(1, 1)],
};

describe("FIXTURE-A — 13 orders, 17 drinks, 10 doubles: bean units deducted", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("is 13 orders and 17 drinks", () => {
    const lines = Object.values(FIXTURE_A).flat();
    expect(Object.keys(FIXTURE_A)).toHaveLength(13);
    expect(lines.reduce((n, l) => n + l.orderQty, 0)).toBe(17);
  });

  it("double-shot Cappuccino order: 2 beans, 1 milk, 1 cup, 1 lid", async () => {
    expect(await deducted(FIXTURE_A["#2649"])).toEqual({
      inv_item_beans_cups: 2, inv_item_whole_milk_cups: 1, inv_item_cup_8oz: 1, inv_item_lid: 1,
    });
  });

  it("Americano (single shot): 1 bean, 1 cup, no lid", async () => {
    expect(await deducted(FIXTURE_A["#2647"])).toEqual({ inv_item_beans_cups: 1, inv_item_cup_8oz: 1 });
  });

  it("the day: 25 bean units (15 coffee drinks + 10 extra for the doubles), and no extra milk, cup or lid", async () => {
    const total: Record<string, number> = {};
    for (const lines of Object.values(FIXTURE_A)) {
      for (const [item, n] of Object.entries(await deducted(lines))) total[item] = (total[item] ?? 0) + n;
    }
    // 15 drinks carry coffee (17 less 2 Hot Chocolates); 10 of them are doubles.
    expect(total.inv_item_beans_cups).toBe(15 + 10);
    // Milk: 12 Cappuccinos + 2 Mochas + 2 Hot Chocolates — one per drink.
    expect(total.inv_item_whole_milk_cups).toBe(16);
    // One cup per drink, one lid per drink except the Americano.
    expect((total.inv_item_cup_8oz ?? 0) + (total.inv_item_cup_12oz ?? 0)).toBe(17);
    expect(total.inv_item_lid).toBe(16);
  });
});

// ─── The pre-payment stock gate (checkRecipeStock) ──────────────────────────

const GATE_INGREDIENTS = [
  { inventoryItemId: "inv_item_beans_cups", itemName: "Espresso Beans (bag)", quantity: 1, itemUnit: "cup", itemKind: "bean" },
  { inventoryItemId: "inv_item_whole_milk_cups", itemName: "Full-Cream Milk (carton)", quantity: 1, itemUnit: "cup", itemKind: "milk" },
];

/**
 * Executor for checkRecipeStock on a beans + milk recipe: each item has one
 * open lot whose running stock is `cupsLeft`. `quantityReceived` set = a
 * legacy (counted) lot; null = a container lot with no predicted total.
 */
function buildGateExecutor(cupsLeft: number, quantityReceived: number | null) {
  const select = vi.fn().mockImplementation((fields: Record<string, unknown>) => {
    const keys = Object.keys(fields ?? {});
    const resolve = (): unknown[] => {
      if (keys.includes("itemName")) return GATE_INGREDIENTS;
      if (keys.includes("mode")) return [{ mode: "sunday" }];
      if (keys.includes("total")) return [{ total: cupsLeft }];
      if (keys.includes("id")) return [{ id: "lot_open", quantityReceived }];
      throw new Error(`unexpected select: ${keys.join(",")}`);
    };
    const chain: Record<string, unknown> = {};
    chain.from = () => chain;
    chain.innerJoin = () => chain;
    chain.where = () => {
      const p = Promise.resolve(resolve()) as Promise<unknown[]> & Record<string, unknown>;
      p.orderBy = () => p;
      p.limit = () => p;
      return p;
    };
    return chain;
  });
  return { select } as never;
}

describe("REQ-137 stock gate — the pre-payment check applies the same shot factor", () => {
  it("a 2-shot drink is refused when only one bean unit remains, naming the beans", async () => {
    const { checkRecipeStock } = await import("@/server/inventory/lot-picker");
    const res = await checkRecipeStock("recipe_cappuccino", 1, buildGateExecutor(1, 30), "2026-08-16", 2);
    expect(res).toEqual({ ok: false, itemName: "Espresso Beans (bag)" });
  });

  it("a 1-shot drink is allowed when one bean unit remains", async () => {
    const { checkRecipeStock } = await import("@/server/inventory/lot-picker");
    const res = await checkRecipeStock("recipe_cappuccino", 1, buildGateExecutor(1, 30), "2026-08-16", 1);
    expect(res).toEqual({ ok: true });
  });

  it("shots omitted behaves as 1 shot", async () => {
    const { checkRecipeStock } = await import("@/server/inventory/lot-picker");
    const res = await checkRecipeStock("recipe_cappuccino", 1, buildGateExecutor(1, 30), "2026-08-16");
    expect(res).toEqual({ ok: true });
  });

  it("a container lot (no predicted total) has nothing to count, so an open bag passes", async () => {
    const { checkRecipeStock } = await import("@/server/inventory/lot-picker");
    const res = await checkRecipeStock("recipe_cappuccino", 1, buildGateExecutor(-5, null), "2026-08-16", 4);
    expect(res).toEqual({ ok: true });
  });
});
