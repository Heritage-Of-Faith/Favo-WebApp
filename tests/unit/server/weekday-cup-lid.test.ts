// AT-187 · REQ-125 · L24 · PRD §4 mode table, §7.4, §10.5(1–2).
//
// REQ-125: "Given a weekday order · When stock deducts · Then `stock_movements`
// contains no cup or lid row; Given the same order in Sunday mode · Then it does"
// L24: "Cup and lid deduction follows the mode. Excluded on weekday orders;
// included on Sunday orders; per the event's `consumes_cup_lid` switch on
// event orders."
//
// Cups and lids are the inventory items of kind 'packaging' (seed:
// inv_item_cup_8oz, inv_item_cup_12oz, inv_item_lid — the only packaging rows).
// The mode is read from the order day's opening_sessions rows (§10.5(2)).

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@db/index", () => ({ db: {} }));
vi.mock("@/server/audit", () => ({ writeAudit: vi.fn().mockResolvedValue(undefined) }));

import { consumesCupAndLid } from "@/server/orders/cup-lid";

const LOT_BY_ITEM: Record<string, string> = {
  inv_item_beans_cups: "lot_beans_open",
  inv_item_whole_milk_cups: "lot_milk_open",
  inv_item_cup_12oz: "lot_cup_12oz_001",
  inv_item_lid: "lot_lid_001",
};

// A cappuccino: beans + milk (container model) + a 12 oz cup + a lid.
const CAPPUCCINO_INGREDIENTS = [
  { inventoryItemId: "inv_item_beans_cups", quantity: 1, itemUnit: "cup", itemKind: "bean" },
  { inventoryItemId: "inv_item_whole_milk_cups", quantity: 1, itemUnit: "cup", itemKind: "milk" },
  { inventoryItemId: "inv_item_cup_12oz", quantity: 1, itemUnit: "unit", itemKind: "packaging" },
  { inventoryItemId: "inv_item_lid", quantity: 1, itemUnit: "unit", itemKind: "packaging" },
];

/**
 * A query-shape-aware fake tx: answers by the table queried, not by call order,
 * so it does not care in what order (or whether) deductForOrder reads the mode.
 */
function buildTx(modes: string[]) {
  const values = vi.fn().mockResolvedValue([]);
  const select = vi.fn().mockImplementation((fields: Record<string, unknown>) => {
    const keys = Object.keys(fields ?? {});
    let rows: unknown[];
    if (keys.includes("orderItemId")) {
      rows = [{ orderItemId: "oi_1", menuItemId: "menu_cappuccino", orderQty: 1, recipeId: "recipe_cappuccino", modifications: [] }];
    } else if (keys.includes("itemKind")) {
      rows = CAPPUCCINO_INGREDIENTS;
    } else if (keys.includes("revenueDay")) {
      rows = [{ revenueDay: "2026-10-21" }];
    } else if (keys.includes("mode")) {
      rows = modes.map((mode) => ({ mode }));
    } else {
      throw new Error(`unexpected select: ${keys.join(",")}`);
    }
    const chain = {
      from: () => chain,
      innerJoin: () => chain,
      where: () => Promise.resolve(rows),
    };
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

async function deductWithMode(modes: string[]) {
  const lotPicker = await import("@/server/inventory/lot-picker");
  vi.spyOn(lotPicker, "pickOpenContainer").mockImplementation(async (itemId: string) => ({
    id: LOT_BY_ITEM[itemId], currentStock: 100, isLegacyLot: true,
  }));
  const pickActiveLot = vi.spyOn(lotPicker, "pickActiveLot").mockImplementation(async (itemId: string) => ({
    id: LOT_BY_ITEM[itemId], currentStock: 100, isLegacyLot: true,
  }));
  const { deductForOrder } = await import("@/server/orders/deduction");
  const { tx, values } = buildTx(modes);
  await deductForOrder("order_001", tx as never, "staff_sam");
  const lots = values.mock.calls.map((c) => (c[0] as { inventoryLotId: string }).inventoryLotId);
  return { lots, pickActiveLot };
}

describe("REQ-125 / L24 — cup and lid deduction follows the mode", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("weekday order: stock_movements gets beans and milk, and no cup or lid row", async () => {
    const { lots, pickActiveLot } = await deductWithMode(["weekday"]);
    expect(lots).toEqual(["lot_beans_open", "lot_milk_open"]);
    expect(lots).not.toContain("lot_cup_12oz_001");
    expect(lots).not.toContain("lot_lid_001");
    // Cup and lid lots are never even locked, so their stock is unchanged.
    expect(pickActiveLot).not.toHaveBeenCalled();
  });

  it("the same order in Sunday mode: cup and lid rows ARE written", async () => {
    const { lots } = await deductWithMode(["sunday"]);
    expect(lots).toEqual(["lot_beans_open", "lot_milk_open", "lot_cup_12oz_001", "lot_lid_001"]);
  });

  it("event mode deducts cup and lid (no consumes_cup_lid switch exists yet — today's behaviour)", async () => {
    const { lots } = await deductWithMode(["event"]);
    expect(lots).toContain("lot_cup_12oz_001");
    expect(lots).toContain("lot_lid_001");
  });

  it("no session for the order's day: not a weekday order, so cup and lid deduct", async () => {
    const { lots } = await deductWithMode([]);
    expect(lots).toContain("lot_cup_12oz_001");
    expect(lots).toContain("lot_lid_001");
  });
});

describe("consumesCupAndLid(modes)", () => {
  it("weekday → excluded; sunday, event, none, mixed → included", () => {
    expect(consumesCupAndLid(["weekday"])).toBe(false);
    expect(consumesCupAndLid(["weekday", "weekday"])).toBe(false);
    expect(consumesCupAndLid(["sunday"])).toBe(true);
    expect(consumesCupAndLid(["event"])).toBe(true);
    expect(consumesCupAndLid([])).toBe(true);
    expect(consumesCupAndLid(["weekday", "event"])).toBe(true);
  });
});

// ─── The pre-payment stock gate (createOrder → checkRecipeStock) ────────────

/**
 * Executor for checkRecipeStock on a beans + 12 oz cup + lid recipe. Only the
 * FIRST lot lookup (the beans, which come first in the recipe) finds a lot;
 * every later one finds none — so cup and lid are out of stock entirely.
 */
const GATE_INGREDIENTS = [
  { inventoryItemId: "inv_item_beans_cups", itemName: "Espresso Beans (bag)", quantity: 1, itemUnit: "cup", itemKind: "bean" },
  { inventoryItemId: "inv_item_cup_12oz", itemName: "12 oz Cup", quantity: 1, itemUnit: "unit", itemKind: "packaging" },
  { inventoryItemId: "inv_item_lid", itemName: "Cup Lid", quantity: 1, itemUnit: "unit", itemKind: "packaging" },
];

function buildGateExecutor(modes: string[]) {
  let lotLookups = 0;
  const select = vi.fn().mockImplementation((fields: Record<string, unknown>) => {
    const keys = Object.keys(fields ?? {});
    const resolve = (): unknown[] => {
      if (keys.includes("itemName")) return GATE_INGREDIENTS;
      if (keys.includes("mode")) return modes.map((mode) => ({ mode }));
      if (keys.includes("total")) return [{ total: 100 }];
      if (keys.includes("id")) return lotLookups++ === 0 ? [{ id: "lot_beans_open" }] : [];
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

describe("REQ-125 intent — the stock gate does not block a weekday order for lack of cups or lids", () => {
  it("weekday: a drink with no cup or lid lot in stock passes the gate", async () => {
    const { checkRecipeStock } = await import("@/server/inventory/lot-picker");
    const res = await checkRecipeStock("recipe_cappuccino", 1, buildGateExecutor(["weekday"]), "2026-10-21");
    expect(res).toEqual({ ok: true });
  });

  it("sunday: the same drink with no cup lot is refused, naming the cup", async () => {
    const { checkRecipeStock } = await import("@/server/inventory/lot-picker");
    const res = await checkRecipeStock("recipe_cappuccino", 1, buildGateExecutor(["sunday"]), "2026-10-25");
    expect(res).toEqual({ ok: false, itemName: "12 oz Cup" });
  });
});
