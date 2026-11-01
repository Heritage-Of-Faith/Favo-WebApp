// AT-209 / L33, L41, REQ-059, REQ-152 (DEF-A, DEF-B): the comp decision.
// Literal values from PRD v7.0: the closed reason list (L33, §10.3), the
// ceiling min(line_gross − discount_zar, (highest live menu price + (T15 − 2) ×
// extra_shot_zar) × quantity), "the highest live menu price is R25", T15 = 4,
// extra_shot_zar = R10, so the per-unit cap is R45 ("a four-shot Mocha at R45").

import { describe, it, expect } from "vitest";
import {
  COMP_REASONS,
  COMPS_PER_SESSION_WITHOUT_PIN,
  DEFAULT_EXTRA_SHOT_ZAR,
  DEFAULT_MAX_SHOTS_PER_LINE,
  compCeilingZar,
  decideComp,
  lineGrossZar,
} from "@/server/orders/comp";

const MENU = { highestLivePriceZar: 2500, maxShotsPerLine: 4, extraShotZar: 1000 };
const line = (o: Partial<{ quantity: number; unitPriceZar: number; modsZar: number; discountZar: number; compReason: string | null }> = {}) => ({
  quantity: 1, unitPriceZar: 2000, modsZar: 0, discountZar: 0, compReason: null, ...o,
});

describe("L33 constants", () => {
  it("the reason list is exactly the six values of record", () => {
    expect([...COMP_REASONS]).toEqual(["wrong_drink", "wrong_charge", "spillage", "staff_error", "goodwill", "donation"]);
  });
  it("two comps per barista per session before an admin PIN; T15 = 4; extra shot R10", () => {
    expect(COMPS_PER_SESSION_WITHOUT_PIN).toBe(2);
    expect(DEFAULT_MAX_SHOTS_PER_LINE).toBe(4);
    expect(DEFAULT_EXTRA_SHOT_ZAR).toBe(1000);
  });
});

describe("compCeilingZar", () => {
  it("per unit, R25 + (4 − 2) × R10 = R45", () => {
    expect(compCeilingZar({ line: line({ unitPriceZar: 9900 }), ...MENU })).toBe(4500);
  });
  it("scales with quantity: a quantity-2 line caps at R90", () => {
    expect(compCeilingZar({ line: line({ quantity: 2, unitPriceZar: 9900 }), ...MENU })).toBe(9000);
  });
  it("REQ-152: reads line_gross − discount_zar, not line_gross", () => {
    // quantity 2 × R20 = R40 gross, one free cup (R20) already on the line.
    expect(compCeilingZar({ line: line({ quantity: 2, discountZar: 2000 }), ...MENU })).toBe(2000);
  });
  it("line_gross is quantity × (listed price + priced modifications)", () => {
    expect(lineGrossZar({ quantity: 2, unitPriceZar: 2000, modsZar: 500 })).toBe(5000);
  });
});

describe("decideComp", () => {
  it("comps a R20 line to R0: value R20", () => {
    expect(decideComp({ line: line(), orderHasComp: false, ...MENU })).toEqual({ status: "apply", valueZar: 2000, ceilingZar: 2000 });
  });
  it("a quantity-2 line comps both cups (R40)", () => {
    expect(decideComp({ line: line({ quantity: 2 }), orderHasComp: false, ...MENU })).toMatchObject({ status: "apply", valueZar: 4000 });
  });
  it("a R45 line is exactly at the cap and is comped", () => {
    expect(decideComp({ line: line({ unitPriceZar: 2500, modsZar: 2000 }), orderHasComp: false, ...MENU }))
      .toMatchObject({ status: "apply", valueZar: 4500 });
  });
  it("a line worth more than R45 a unit is refused", () => {
    expect(decideComp({ line: line({ unitPriceZar: 2500, modsZar: 2100 }), orderHasComp: false, ...MENU }))
      .toMatchObject({ status: "refused", code: "VALIDATION", reason: "over_ceiling" });
  });
  it("at most once per order: COMP_LIMIT with the §6.0.1 copy", () => {
    expect(decideComp({ line: line(), orderHasComp: true, ...MENU })).toEqual({
      status: "refused", code: "COMP_LIMIT", reason: "order_already_comped", message: "Comp limit reached — needs an admin",
    });
  });
  it("L41: a line already carrying a free cup or a voucher is refused", () => {
    expect(decideComp({ line: line({ quantity: 2, discountZar: 2000 }), orderHasComp: false, ...MENU }))
      .toMatchObject({ status: "refused", code: "VALIDATION", reason: "line_already_discounted" });
  });
  it("a line with no value is refused", () => {
    expect(decideComp({ line: line({ unitPriceZar: 0 }), orderHasComp: false, ...MENU }))
      .toMatchObject({ status: "refused", code: "VALIDATION", reason: "nothing_to_comp" });
  });
});
