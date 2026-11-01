// AT-189 · AT-192 · REQ-106 · REQ-108 · REQ-109 · REQ-110 · REQ-111 · REQ-117.
// FIXTURE-A — Sunday 2026-08-16, the whole day (PRD §7.0.3 L1858–1919, §15.1
// L3190). Every expected figure is typed in from the PRD, never recomputed:
//   gross R350.00 · fees R9.27 · net settled R340.73 · written off R0.00 ·
//   comps R0.00 · cogs R196.36 · gross margin R153.64 · contribution R144.37 ·
//   drinks 17 · double shots 10 · flag provisional, not green.
//
// Per-transaction fees: the PRD states R0.53 on R20 and R1.32 on R50 (L1098,
// L1932) and R9.27 for the 13 (L1875). The three R40 orders carry the
// remainder, R9.27 − 9 × R0.53 − R1.32 = R3.18 = 3 × R1.06.
//
// If contribution comes out R144.36 the arithmetic disagrees with the spec:
// STOP and report it (CLAUDE.md §3) — do not adjust this test.

import { describe, it, expect, vi } from "vitest";

vi.mock("@db/index", () => ({ db: {} }));

import { computeOrderCogs, costShotFactor, type CostedConsumption } from "@/server/orders/order-cogs";
import { rollupDay, type DayOrder } from "@/server/cogs/day-rollup";
import { netTone } from "@/lib/cost-state";

// Lot costs, ¢ per base unit — PRD table L1672–1681.
const BEANS = "321.4286";
const WHOLE_MILK = "509.0909";
const CUP_8OZ = "120.0000";
const CUP_12OZ = "150.0000";
const LID = "80.0000";
const CHOC_PER_G = "0.1800";

const one = (id: string, units: number, cost: string): CostedConsumption => ({
  inventoryItemId: id,
  costUnits: units,
  draws: [{ units, unitCostZar: cost }],
});
const cappuccino = (q: number, s: number) => [
  one("beans", q * costShotFactor("bean", s), BEANS),
  one("milk", q, WHOLE_MILK),
  one("cup_8oz", q, CUP_8OZ),
  one("lid", q, LID),
];
const americano = (q: number) => [one("beans", q, BEANS), one("cup_8oz", q, CUP_8OZ)];
const hotChocolate = (q: number) => [
  one("choc", q * 20, CHOC_PER_G),
  one("milk", q, WHOLE_MILK),
  one("cup_12oz", q, CUP_12OZ),
  one("lid", q, LID),
];
const mocha = (q: number) => [
  one("beans", q, BEANS),
  one("choc", q * 20, CHOC_PER_G),
  one("milk", q, WHOLE_MILK),
  one("cup_12oz", q, CUP_12OZ),
  one("lid", q, LID),
];

/** One FAVO order of the day: its consumption, its lines, its charge and fee. */
function order(
  consumed: CostedConsumption[],
  lines: { quantity: number; shots: number }[],
  netChargedZar: number,
  feeZar: number
): DayOrder {
  const { cogsZar, absentItemIds } = computeOrderCogs(consumed);
  return {
    netChargedZar,
    paymentMode: "yoco",
    writtenOff: false,
    payment: { feeZar, tipZar: 0 },
    // Every lot on the day is cost_source = 'estimate' (L1919).
    cogs: { cogsZar, absentItemIds, estimated: true },
    lines,
  };
}

// The thirteen FAVO orders (L1881–1889). The 250ml cups line (#2646) is not a
// FAVO order and is excluded (L1864).
const THIRTEEN: DayOrder[] = [
  ...Array.from({ length: 5 }, () => order(cappuccino(1, 2), [{ quantity: 1, shots: 2 }], 2000, 53)), // #2649 #2643 #2642 #2640 #2639
  order([...cappuccino(1, 2), ...cappuccino(1, 1)], [{ quantity: 1, shots: 2 }, { quantity: 1, shots: 1 }], 4000, 106), // #2648
  order(americano(1), [{ quantity: 1, shots: 1 }], 2000, 53), // #2647
  order(cappuccino(2, 2), [{ quantity: 2, shots: 2 }], 4000, 106), // #2645
  order(cappuccino(2, 2), [{ quantity: 2, shots: 2 }], 4000, 106), // #2636
  order(hotChocolate(1), [{ quantity: 1, shots: 1 }], 2000, 53), // #2644
  order(hotChocolate(1), [{ quantity: 1, shots: 1 }], 2000, 53), // #2641
  order(mocha(2), [{ quantity: 2, shots: 1 }], 5000, 132), // #2638 — single-shot (L1917)
  order(cappuccino(1, 1), [{ quantity: 1, shots: 1 }], 2000, 53), // #2637
];

describe("FIXTURE-A — Sunday 2026-08-16, every figure asserted (REQ-117)", () => {
  const day = rollupDay(THIRTEEN);

  it("is thirteen FAVO orders", () => {
    expect(THIRTEEN).toHaveLength(13);
  });

  it("gross_zar R350.00", () => expect(day.grossZar).toBe(35000));
  it("processing_fee R9.27", () => expect(day.processingFeeZar).toBe(927));
  it("net_settled R340.73", () => expect(day.netSettledZar).toBe(34073));
  it("written_off_zar R0.00", () => expect(day.writtenOffZar).toBe(0));
  it("comps_zar R0.00", () => expect(day.compsZar).toBe(0));
  it("collected_zar R350.00", () => expect(day.collectedZar).toBe(35000));
  it("cogs_zar R196.36 — Σ of the thirteen integers", () => expect(day.cogs.cogsZar).toBe(19636));
  it("gross_margin R153.64", () => expect(day.grossMarginZar).toBe(15364));
  it("contribution R144.37 (not R144.36)", () => expect(day.contributionZar).toBe(14437));
  it("17 drinks, 10 double shots", () => {
    expect(day.drinks).toBe(17);
    expect(day.doubleShots).toBe(10);
  });

  it("the flag renders provisional, not green (REQ-110)", () => {
    expect(day.cogs.state).toBe("provisional");
    expect(netTone(day.cogs.state, day.contributionZar)).toBe("warn");
    expect(netTone(day.cogs.state, day.contributionZar)).not.toBe("positive");
  });
});

describe("the refusal rules on the same day", () => {
  it("one settled payment with fee_zar NULL → fees, net settled and contribution UNAVAILABLE (REQ-108)", () => {
    const day = rollupDay([...THIRTEEN.slice(1), { ...THIRTEEN[0], payment: { feeZar: null, tipZar: 0 } }]);
    expect(day.processingFeeZar).toBeNull();
    expect(day.netSettledZar).toBeNull();
    expect(day.contributionZar).toBeNull();
    expect(day.cogs.cogsZar).toBe(19636); // cogs is not fee-dependent
  });

  it("one order with an absent cost input → cogs, margin and contribution UNAVAILABLE, item named (REQ-109)", () => {
    const refused: DayOrder = { ...THIRTEEN[0], cogs: { cogsZar: null, absentItemIds: ["inv_item_oat_milk"], estimated: true } };
    const day = rollupDay([...THIRTEEN.slice(1), refused]);
    expect(day.cogs.state).toBe("unavailable");
    expect(day.cogs.cogsZar).toBeNull();
    expect(day.cogs.absentItemIds).toEqual(["inv_item_oat_milk"]);
    expect(day.grossMarginZar).toBeNull();
    expect(day.contributionZar).toBeNull();
    expect(day.grossZar).toBe(35000); // revenue is not cost-dependent
  });

  it("a written-off order is gross but not collected, and not profit (REQ-111)", () => {
    const day = rollupDay([...THIRTEEN.slice(1), { ...THIRTEEN[0], writtenOff: true, payment: null }]);
    expect(day.writtenOffZar).toBe(2000);
    expect(day.collectedZar).toBe(day.grossZar - 2000);
  });
});
