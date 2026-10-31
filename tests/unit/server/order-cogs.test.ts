// AT-188 · REQ-101 · REQ-105 · REQ-106 · REQ-107 · REQ-126 · PRD §7.0.2, §7.0.3.
//
// The one rounding point: `order_cogs = round_half_up( Σ line_cogs )` (§7.0.2
// L1770, repeated L1852). unit_cost is carried to 4 dp, NOT rounded (L1755).
// line_cogs = quantity × Σ( recipe_qty × unit_cost × shot_factor ) (L1763) —
// the seed recipes already carry the cup and lid as ingredients, so each is
// counted once. Every expected figure below is typed in from the PRD (L1856,
// the §7.0.3 table L1881–1889, cogs_zar R196.36), never recomputed here.

import { describe, it, expect, vi } from "vitest";

vi.mock("@db/index", () => ({ db: {} }));

import {
  computeOrderCogs,
  costShotFactor,
  parseUnitCost,
  type CostedConsumption,
} from "@/server/orders/order-cogs";

// ── Lot costs, ¢ per base unit, from the PRD table (L1672–1681) = db/seed/lots.ts
const BEANS = "321.4286";
const WHOLE_MILK = "509.0909";
const CUP_8OZ = "120.0000";
const CUP_12OZ = "150.0000";
const LID = "80.0000";
const CHOC_PER_G = "0.1800";

/** One ingredient consumed `units` times, all from one lot. */
function one(inventoryItemId: string, units: number, unitCostZar: string | null): CostedConsumption {
  return { inventoryItemId, costUnits: units, draws: [{ units, unitCostZar }] };
}

// Recipes (PRD L1662–1668). `q` = line quantity, `s` = shots; the bean term
// carries costShotFactor exactly as the cost module applies it.
const cappuccino = (q: number, s: number): CostedConsumption[] => [
  one("inv_item_beans_cups", q * costShotFactor("bean", s), BEANS),
  one("inv_item_whole_milk_cups", q * costShotFactor("milk", s), WHOLE_MILK),
  one("inv_item_cup_8oz", q * costShotFactor("packaging", s), CUP_8OZ),
  one("inv_item_lid", q * costShotFactor("packaging", s), LID),
];
const americano = (q: number): CostedConsumption[] => [
  one("inv_item_beans_cups", q, BEANS),
  one("inv_item_cup_8oz", q, CUP_8OZ), // no lid — the recipe governs (REQ-126)
];
const hotChocolate = (q: number): CostedConsumption[] => [
  one("inv_item_hot_choc_powder", q * 20, CHOC_PER_G),
  one("inv_item_whole_milk_cups", q, WHOLE_MILK),
  one("inv_item_cup_12oz", q, CUP_12OZ),
  one("inv_item_lid", q, LID),
];
const mocha = (q: number): CostedConsumption[] => [
  one("inv_item_beans_cups", q, BEANS),
  one("inv_item_hot_choc_powder", q * 20, CHOC_PER_G),
  one("inv_item_whole_milk_cups", q, WHOLE_MILK),
  one("inv_item_cup_12oz", q, CUP_12OZ),
  one("inv_item_lid", q, LID),
];

describe("PRD §7.0.2 L1856 worked example — R180 bag yielding 34 cups", () => {
  // 18000 ÷ 34 = 529.4118 ¢/cup, stored unrounded.
  const BAG = "529.4118";

  it("one cup → 529", () => {
    expect(computeOrderCogs([one("inv_item_beans_cups", 1, BAG)])).toEqual({ cogsZar: 529, absentItemIds: [] });
  });

  it("two cups → 1059, NOT 2 × 529 = 1058", () => {
    const r = computeOrderCogs([one("inv_item_beans_cups", 2, BAG)]);
    expect(r.cogsZar).toBe(1059);
    expect(r.cogsZar).not.toBe(1058);
  });
});

describe("FIXTURE-A — Sunday 2026-08-16, per-order integers (PRD §7.0.3 L1881–1889)", () => {
  it("#2649 #2643 #2642 #2640 #2639 · 1 × Cappuccino (double) → 1352", () => {
    expect(computeOrderCogs(cappuccino(1, 2)).cogsZar).toBe(1352);
  });

  it("#2648 · 1 × Cappuccino (double) + 1 × Cappuccino (single) → 2382", () => {
    expect(computeOrderCogs([...cappuccino(1, 2), ...cappuccino(1, 1)]).cogsZar).toBe(2382);
  });

  it("#2647 · 1 × Americano → 441 (cup, no lid)", () => {
    expect(computeOrderCogs(americano(1)).cogsZar).toBe(441);
  });

  it("#2645 #2636 · 2 × Cappuccino (double) → 2704", () => {
    expect(computeOrderCogs(cappuccino(2, 2)).cogsZar).toBe(2704);
  });

  it("#2644 #2641 · 1 × Hot Chocolate → 743", () => {
    expect(computeOrderCogs(hotChocolate(1)).cogsZar).toBe(743);
  });

  it("#2638 · 2 × Mocha (single-shot, L1917) → 2128", () => {
    expect(computeOrderCogs(mocha(2)).cogsZar).toBe(2128);
  });

  it("#2637 · 1 × Cappuccino (single) → 1031", () => {
    expect(computeOrderCogs(cappuccino(1, 1)).cogsZar).toBe(1031);
  });

  it("the day's cogs_zar is the sum of the thirteen integers = 19636 (R196.36)", () => {
    const thirteen = [
      ...Array.from({ length: 5 }, () => cappuccino(1, 2)),
      [...cappuccino(1, 2), ...cappuccino(1, 1)],
      americano(1),
      cappuccino(2, 2),
      cappuccino(2, 2),
      hotChocolate(1),
      hotChocolate(1),
      mocha(2),
      cappuccino(1, 1),
    ];
    expect(thirteen).toHaveLength(13);
    const total = thirteen.reduce((acc, o) => acc + (computeOrderCogs(o).cogsZar as number), 0);
    expect(total).toBe(19636);
  });
});

describe("round half-up, once, in exact decimal (REQ-106)", () => {
  it("an exact .5000 rounds UP", () => {
    expect(computeOrderCogs([one("x", 1, "0.5000")]).cogsZar).toBe(1);
    expect(computeOrderCogs([one("x", 1, "2.5000")]).cogsZar).toBe(3); // not banker's rounding (→ 2)
    expect(computeOrderCogs([one("x", 1, "2.4999")]).cogsZar).toBe(2);
  });

  it("100.0007 + 0.1201 + 3.3792 = 103.5000 exactly → 104 (JS floats would give 103)", () => {
    // The float trap the cost module avoids: the same sum in doubles lands
    // just under the half and Math.round goes the wrong way.
    expect(100.0007 + 0.1201 + 3.3792).toBe(103.49999999999999);
    const r = computeOrderCogs([one("a", 1, "100.0007"), one("b", 1, "0.1201"), one("c", 1, "3.3792")]);
    expect(r.cogsZar).toBe(104);
  });

  it("the result is an integer number of cents", () => {
    expect(Number.isInteger(computeOrderCogs(mocha(2)).cogsZar)).toBe(true);
  });

  it("an order that consumed nothing has a genuine zero", () => {
    expect(computeOrderCogs([])).toEqual({ cogsZar: 0, absentItemIds: [] });
  });
});

describe("REQ-107 — sub-cent unit costs are never rounded to zero", () => {
  it("chocolate 0.1800 ¢/g × 20 g contributes 3.6000, never 0", () => {
    // 3.6000 alone rounds to 4; were it priced at 0 the order would read 0.
    expect(computeOrderCogs([one("inv_item_hot_choc_powder", 20, CHOC_PER_G)]).cogsZar).toBe(4);
    // Hot Chocolate 742.6909 → 743; without the 3.6000 it would be 739.0909 → 739.
    expect(computeOrderCogs(hotChocolate(1)).cogsZar).toBe(743);
  });

  it("parseUnitCost keeps all four decimals", () => {
    expect(parseUnitCost("0.1800")).toBe(1800n);
    expect(parseUnitCost("529.4118")).toBe(5294118n);
    expect(parseUnitCost("120")).toBe(1200000n);
    expect(parseUnitCost("0.18")).toBe(1800n);
  });
});

describe("refusal rule — a NULL or 0.0000 cost is UNAVAILABLE, never a smaller number (§7.0.2 L1791–1795)", () => {
  it("a NULL-cost ingredient → cogs_zar NULL, naming it", () => {
    const r = computeOrderCogs([...cappuccino(1, 1).filter((c) => c.inventoryItemId !== "inv_item_whole_milk_cups"),
      one("inv_item_whole_milk_cups", 1, null)]);
    expect(r).toEqual({ cogsZar: null, absentItemIds: ["inv_item_whole_milk_cups"] });
  });

  it("a 0.0000-cost ingredient (e.g. an unseeded alternative milk) → cogs_zar NULL, naming it", () => {
    const r = computeOrderCogs([one("inv_item_beans_cups", 1, BEANS), one("inv_item_oat_milk", 200, "0.0000")]);
    expect(r).toEqual({ cogsZar: null, absentItemIds: ["inv_item_oat_milk"] });
  });

  it("two offending ingredients are both named, once each, sorted", () => {
    const r = computeOrderCogs([
      one("inv_item_whole_milk_cups", 1, null),
      one("inv_item_beans_cups", 1, "0"),
      one("inv_item_whole_milk_cups", 1, null),
    ]);
    expect(r).toEqual({ cogsZar: null, absentItemIds: ["inv_item_beans_cups", "inv_item_whole_milk_cups"] });
  });

  it("an ingredient with no lot drawn cannot be costed → absent, not zero", () => {
    expect(computeOrderCogs([{ inventoryItemId: "x", costUnits: 1, draws: [] }])).toEqual({
      cogsZar: null,
      absentItemIds: ["x"],
    });
  });
});

describe("DEF-G — each unit is costed at the lot it was drawn from (§7.0.2 L1766–1769)", () => {
  it("two units spanning two lots: one at each lot's cost, not 2 × one lot", () => {
    const r = computeOrderCogs([
      {
        inventoryItemId: "inv_item_beans_cups",
        costUnits: 2,
        draws: [
          { units: 1, unitCostZar: BEANS },
          { units: 1, unitCostZar: "529.4118" },
        ],
      },
    ]);
    // 321.4286 + 529.4118 = 850.8404 → 851 (2 × 321.4286 = 643; 2 × 529.4118 = 1059)
    expect(r.cogsZar).toBe(851);
  });

  it("units beyond what was drawn (shots not yet deducted, pre-#267) cost at the last lot drawn", () => {
    // 2-shot line, deduction drew one cup: both shots at the drawn lot.
    const r = computeOrderCogs([
      { inventoryItemId: "inv_item_beans_cups", costUnits: 2, draws: [{ units: 1, unitCostZar: BEANS }] },
    ]);
    expect(r.cogsZar).toBe(643); // 642.8572
  });

  it("only the lots that carry costed units are checked for absence", () => {
    const r = computeOrderCogs([
      {
        inventoryItemId: "inv_item_beans_cups",
        costUnits: 1,
        draws: [
          { units: 1, unitCostZar: BEANS },
          { units: 0, unitCostZar: null },
        ],
      },
    ]);
    expect(r).toEqual({ cogsZar: 321, absentItemIds: [] });
  });
});

describe("costShotFactor — PRD §7.0.2 L1760 shot_factor", () => {
  it("coffee (kind 'bean') × shots; every other ingredient × 1", () => {
    expect(costShotFactor("bean", 2)).toBe(2);
    expect(costShotFactor("bean", 4)).toBe(4);
    expect(costShotFactor("milk", 2)).toBe(1);
    expect(costShotFactor("packaging", 3)).toBe(1);
  });

  it("an absent or invalid shot count counts as one shot", () => {
    expect(costShotFactor("bean", undefined)).toBe(1);
    expect(costShotFactor("bean", null)).toBe(1);
    expect(costShotFactor("bean", 0)).toBe(1);
  });
});
