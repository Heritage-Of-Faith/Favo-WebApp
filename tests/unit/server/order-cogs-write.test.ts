// AT-188 · REQ-105 · REQ-106 · REQ-125 · REQ-126 · PRD §7.0.2 (DEF-G L1766).
//
// deductForOrder → writeOrderCogs through one fake transaction: the row that
// reaches order_cogs is the cost of the lots actually drawn, rounded once.
// Expected integers are the PRD's (§7.0.3 table, L1856), typed in.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@db/index", () => ({ db: {} }));
vi.mock("@/server/audit", () => ({ writeAudit: vi.fn().mockResolvedValue(undefined) }));

import { orderCogs, stockMovements } from "@db/schema";

type Ing = { inventoryItemId: string; quantity: number; itemUnit: string; itemKind: string };

const BEANS: Ing = { inventoryItemId: "inv_item_beans_cups", quantity: 1, itemUnit: "cup", itemKind: "bean" };
const MILK: Ing = { inventoryItemId: "inv_item_whole_milk_cups", quantity: 1, itemUnit: "cup", itemKind: "milk" };
const CUP_8OZ: Ing = { inventoryItemId: "inv_item_cup_8oz", quantity: 1, itemUnit: "unit", itemKind: "packaging" };
const LID: Ing = { inventoryItemId: "inv_item_lid", quantity: 1, itemUnit: "unit", itemKind: "packaging" };

const RECIPES: Record<string, Ing[]> = {
  recipe_cappuccino: [BEANS, MILK, CUP_8OZ, LID],
  recipe_americano: [BEANS, CUP_8OZ], // no lid (PRD L1663)
};

// Lot costs, ¢ per base unit — PRD table L1672–1681 / db/seed/lots.ts.
const COST_BY_LOT: Record<string, string | null> = {
  lot_beans_open: "321.4286",
  lot_beans_next: "529.4118", // the PRD L1856 R180 ÷ 34 bag
  lot_milk_open: "509.0909",
  lot_cup_8oz: "120.0000",
  lot_lid: "80.0000",
};
const LOT_BY_ITEM: Record<string, string> = {
  inv_item_beans_cups: "lot_beans_open",
  inv_item_whole_milk_cups: "lot_milk_open",
  inv_item_cup_8oz: "lot_cup_8oz",
  inv_item_lid: "lot_lid",
};

type Line = { recipeId: string; orderQty: number; shots: number };

/** Answers each select by the fields it asks for, not by call order. */
function buildTx(lines: Line[], modes: string[], costs = COST_BY_LOT) {
  const movements: { inventoryLotId: string; delta: number }[] = [];
  const cogsRows: Record<string, unknown>[] = [];
  const onConflict = vi.fn();
  let recipeCall = 0;
  const select = vi.fn().mockImplementation((fields: Record<string, unknown>) => {
    const keys = Object.keys(fields ?? {});
    let rows: unknown[];
    if (keys.includes("orderItemId")) {
      rows = lines.map((l, i) => ({
        orderItemId: `oi_${i}`, menuItemId: `menu_${l.recipeId}`, orderQty: l.orderQty,
        recipeId: l.recipeId, modifications: [], shots: l.shots,
      }));
    } else if (keys.includes("itemKind")) {
      rows = RECIPES[lines[recipeCall++].recipeId];
    } else if (keys.includes("revenueDay")) {
      rows = [{ revenueDay: "2026-08-16" }];
    } else if (keys.includes("mode")) {
      rows = modes.map((mode) => ({ mode }));
    } else if (keys.includes("unitCostZar")) {
      rows = Object.entries(costs).map(([id, unitCostZar]) => ({ id, unitCostZar }));
    } else {
      throw new Error(`unexpected select: ${keys.join(",")}`);
    }
    const chain = { from: () => chain, innerJoin: () => chain, where: () => Promise.resolve(rows) };
    return chain;
  });
  const insert = vi.fn().mockImplementation((table: unknown) => ({
    values: (v: Record<string, unknown>) => {
      if (table === stockMovements) movements.push(v as { inventoryLotId: string; delta: number });
      if (table === orderCogs) cogsRows.push(v);
      return Object.assign(Promise.resolve([]), {
        onConflictDoNothing: (arg: unknown) => {
          onConflict(arg);
          return Promise.resolve([]);
        },
      });
    },
  }));
  const update = vi.fn().mockReturnValue({ set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }) });
  return { tx: { select, insert, update, execute: vi.fn().mockResolvedValue([]) }, movements, cogsRows, onConflict, update };
}

async function spyLots(opts: { beansOpenLeft?: number } = {}) {
  const lotPicker = await import("@/server/inventory/lot-picker");
  let beansLeft = opts.beansOpenLeft;
  vi.spyOn(lotPicker, "pickOpenContainer").mockImplementation(async (itemId: string) => {
    if (itemId === "inv_item_beans_cups" && beansLeft !== undefined) {
      // A legacy (counted) bean lot with `beansLeft` cups, then the next bag.
      // deductCups takes all `beansLeft` and asks again for the rest.
      if (beansLeft > 0) {
        const left = beansLeft;
        beansLeft = 0;
        return { id: "lot_beans_open", currentStock: left, isLegacyLot: true };
      }
      return { id: "lot_beans_next", currentStock: 34, isLegacyLot: true };
    }
    return { id: LOT_BY_ITEM[itemId], currentStock: 100, isLegacyLot: true };
  });
  vi.spyOn(lotPicker, "pickActiveLot").mockImplementation(async (itemId: string) => ({
    id: LOT_BY_ITEM[itemId], currentStock: 100, isLegacyLot: true,
  }));
}

async function sell(lines: Line[], modes: string[], costs?: Record<string, string | null>) {
  const { deductForOrder } = await import("@/server/orders/deduction");
  const { writeOrderCogs } = await import("@/server/orders/order-cogs");
  const fake = buildTx(lines, modes, costs);
  const consumed = await deductForOrder("order_001", fake.tx as never, "staff_thandeka");
  await writeOrderCogs("order_001", consumed, fake.tx as never);
  return fake;
}

describe("AT-188 — the order_cogs row written after deduction", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("FIXTURE-A #2649 · Sunday 1 × Cappuccino (double) → 1352, estimated NULL", async () => {
    await spyLots();
    const { cogsRows } = await sell([{ recipeId: "recipe_cappuccino", orderQty: 1, shots: 2 }], ["sunday"]);
    expect(cogsRows).toEqual([{ orderId: "order_001", cogsZar: 1352, absentItemIds: [], estimated: null }]);
  });

  it("FIXTURE-A #2648 · two Cappuccino lines, double + single → 2382 (one rounding for the order)", async () => {
    await spyLots();
    const { cogsRows } = await sell(
      [
        { recipeId: "recipe_cappuccino", orderQty: 1, shots: 2 },
        { recipeId: "recipe_cappuccino", orderQty: 1, shots: 1 },
      ],
      ["sunday"]
    );
    expect(cogsRows[0]?.cogsZar).toBe(2382);
  });

  it("FIXTURE-A #2645 · 2 × Cappuccino (double): quantity multiplies every ingredient → 2704 (REQ-105)", async () => {
    await spyLots();
    const { cogsRows } = await sell([{ recipeId: "recipe_cappuccino", orderQty: 2, shots: 2 }], ["sunday"]);
    expect(cogsRows[0]?.cogsZar).toBe(2704);
  });

  it("REQ-126 · Sunday Americano: the cup is costed, no lid → 441", async () => {
    await spyLots();
    const { cogsRows, movements } = await sell([{ recipeId: "recipe_americano", orderQty: 1, shots: 1 }], ["sunday"]);
    expect(movements.map((m) => m.inventoryLotId)).toEqual(["lot_beans_open", "lot_cup_8oz"]);
    expect(cogsRows[0]?.cogsZar).toBe(441);
  });

  it("REQ-125 · weekday Cappuccino (single): no cup and no lid drawn, none costed → 831", async () => {
    await spyLots();
    const { cogsRows, movements } = await sell([{ recipeId: "recipe_cappuccino", orderQty: 1, shots: 1 }], ["weekday"]);
    expect(movements.map((m) => m.inventoryLotId)).toEqual(["lot_beans_open", "lot_milk_open"]);
    // beans 321.4286 + milk 509.0909 = 830.5195 → 831. The same drink on a
    // Sunday is 1031 (PRD #2637): the 120c cup and 80c lid are the difference.
    expect(cogsRows[0]?.cogsZar).toBe(831);
  });

  it("DEF-G · a bean bag running out mid-order: each cup at the lot it came from", async () => {
    // 2 × Americano; the open (counted) bean bag has 1 cup left, the next bag
    // is the PRD's R180 ÷ 34 = 529.4118 ¢/cup.
    await spyLots({ beansOpenLeft: 1 });
    const { cogsRows, movements } = await sell([{ recipeId: "recipe_americano", orderQty: 2, shots: 1 }], ["sunday"]);
    expect(movements.filter((m) => m.inventoryLotId.startsWith("lot_beans"))).toEqual([
      expect.objectContaining({ inventoryLotId: "lot_beans_open", delta: -1 }),
      expect.objectContaining({ inventoryLotId: "lot_beans_next", delta: -1 }),
    ]);
    // 321.4286 + 529.4118 + 2 × 120 = 1090.8404 → 1091 (one lot's cost × 2 would give 883 or 1299).
    expect(cogsRows[0]?.cogsZar).toBe(1091);
  });

  it("refusal · the open milk bottle has no cost yet (NULL) → cogs_zar NULL, milk named", async () => {
    await spyLots();
    const { cogsRows } = await sell(
      [{ recipeId: "recipe_cappuccino", orderQty: 1, shots: 1 }],
      ["sunday"],
      { ...COST_BY_LOT, lot_milk_open: null }
    );
    expect(cogsRows[0]).toEqual(
      expect.objectContaining({ cogsZar: null, absentItemIds: ["inv_item_whole_milk_cups"] })
    );
  });

  it("refusal · a 0.0000 lot cost is absent too, never a smaller number", async () => {
    await spyLots();
    const { cogsRows } = await sell(
      [{ recipeId: "recipe_americano", orderQty: 1, shots: 1 }],
      ["sunday"],
      { ...COST_BY_LOT, lot_cup_8oz: "0.0000" }
    );
    expect(cogsRows[0]).toEqual(expect.objectContaining({ cogsZar: null, absentItemIds: ["inv_item_cup_8oz"] }));
  });

  it("frozen · insert is ON CONFLICT (order_id) DO NOTHING and nothing is ever updated", async () => {
    await spyLots();
    const { onConflict, update } = await sell([{ recipeId: "recipe_americano", orderQty: 1, shots: 1 }], ["sunday"]);
    expect(onConflict).toHaveBeenCalledTimes(1);
    expect(onConflict).toHaveBeenCalledWith({ target: orderCogs.orderId });
    // The only updates deduction may make are lot state changes; none here.
    expect(update).not.toHaveBeenCalled();
  });
});
