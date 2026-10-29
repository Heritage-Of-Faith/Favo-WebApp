// AT-202 part 1 — the extra-shot surcharge and the shot ceiling, as pure
// functions. Literal values from PRD v7.0: §6.2.3's table and the §15
// "Shot pricing, at every step" fixture — a cappuccino at R20.00 rings
// R20.00 · R20.00 · R30.00 · R40.00 at 1–4 shots on a Sunday, and a
// quantity-2 line at 3 shots is R60.00 (the surcharge is per unit).
// §12 config defaults: extra_shot_zar 1000, max_shots_per_line 4,
// max_shots_weekday 2.

import { describe, it, expect } from "vitest";
import {
  shotSurchargeZar,
  shotCeiling,
  resolveShotPolicy,
  parseShotConfig,
  parseShotConfigWithFallbacks,
  shotsAboveCeilingMessage,
  FAIL_CLOSED_POLICY,
} from "@/server/orders/shot-surcharge";
import { computeLineTotalZar, computeOrderTotalZar } from "@/server/orders/pricing";

const DEFAULTS = { extraShotZar: 1000, maxShotsPerLine: 4, maxShotsWeekday: 2 };

describe("shotSurchargeZar — REQ-104 / REQ-136 (§7.0.2)", () => {
  it.each([
    [1, 0],
    [2, 0],
    [3, 1000],
    [4, 2000],
  ])("Sunday, %i shots → %i cents per unit", (shots, cents) => {
    expect(shotSurchargeZar(shots, 1000, true)).toBe(cents);
  });

  it("weekday / not in force → 0 at every shot count", () => {
    for (const shots of [1, 2, 3, 4]) expect(shotSurchargeZar(shots, 1000, false)).toBe(0);
  });

  it("refuses a non-integer shot count or non-integer cents", () => {
    expect(() => shotSurchargeZar(2.5, 1000, true)).toThrow(RangeError);
    expect(() => shotSurchargeZar(0, 1000, true)).toThrow(RangeError);
    expect(() => shotSurchargeZar(3, 10.5, true)).toThrow(RangeError);
  });
});

describe("FIXTURE — shot pricing at every step (PRD §15)", () => {
  const capp = (shots: number, quantity = 1) =>
    computeLineTotalZar({
      unitPriceZar: 2000, quantity, modifications: [],
      surchargeZar: shotSurchargeZar(shots, 1000, true),
    });

  it("a R20.00 cappuccino on a Sunday at 1, 2, 3, 4 shots → R20.00 · R20.00 · R30.00 · R40.00", () => {
    expect([capp(1), capp(2), capp(3), capp(4)]).toEqual([2000, 2000, 3000, 4000]);
  });

  it("a quantity-2 line at 3 shots → R60.00 (per unit, not per line)", () => {
    expect(capp(3, 2)).toBe(6000);
  });

  it("an order total sums the surcharge-inclusive lines; with no surcharge it is unchanged", () => {
    expect(computeOrderTotalZar([
      { unitPriceZar: 2000, quantity: 2, modifications: [], surchargeZar: 1000 },
      { unitPriceZar: 2000, quantity: 1, modifications: [{ priceDeltaZar: 800 }] },
    ])).toBe(6000 + 2800);
    expect(computeOrderTotalZar([{ unitPriceZar: 2000, quantity: 1, modifications: [] }])).toBe(2000);
  });
});

describe("shotCeiling / resolveShotPolicy — T15, REQ-138, REQ-144", () => {
  it("weekday ceiling is 2; Sunday ceiling is 4", () => {
    expect(shotCeiling("weekday", DEFAULTS)).toBe(2);
    expect(shotCeiling("sunday", DEFAULTS)).toBe(4);
  });

  it("weekday sessions → ceiling 2, no surcharge", () => {
    expect(resolveShotPolicy(["weekday"], DEFAULTS)).toEqual({
      mode: "weekday", maxShots: 2, surchargeInForce: false, extraShotZar: 1000,
    });
  });

  it("Sunday sessions → ceiling 4, surcharge in force", () => {
    expect(resolveShotPolicy(["sunday", "sunday"], DEFAULTS)).toEqual({
      mode: "sunday", maxShots: 4, surchargeInForce: true, extraShotZar: 1000,
    });
  });

  it("no session, an event, or mixed modes → fail closed: weekday ceiling, no surcharge", () => {
    for (const modes of [[], ["event"], ["weekday", "sunday"]]) {
      expect(resolveShotPolicy(modes, DEFAULTS)).toEqual({
        mode: "unresolved", maxShots: 2, surchargeInForce: false, extraShotZar: 1000,
      });
    }
    expect(shotCeiling("event", DEFAULTS)).toBe(2);
    expect(FAIL_CLOSED_POLICY).toEqual({ mode: "unresolved", maxShots: 2, surchargeInForce: false, extraShotZar: 1000 });
  });

  it("copy names the ceiling in plain words", () => {
    expect(shotsAboveCeilingMessage(resolveShotPolicy(["weekday"], DEFAULTS))).toBe("Weekday drinks take at most 2 shots.");
    expect(shotsAboveCeilingMessage(FAIL_CLOSED_POLICY)).toMatch(/Open today's session first/);
  });
});

describe("parseShotConfig — app_config values, PRD §12 defaults", () => {
  it("no rows → 1000 · 4 · 2", () => {
    expect(parseShotConfig([])).toEqual(DEFAULTS);
  });

  it("reads jsonb numbers", () => {
    expect(parseShotConfig([
      { key: "extra_shot_zar", value: 1200 },
      { key: "max_shots_per_line", value: 3 },
      { key: "max_shots_weekday", value: 1 },
    ])).toEqual({ extraShotZar: 1200, maxShotsPerLine: 3, maxShotsWeekday: 1 });
  });

  it("malformed values fall back to the default; ceilings never exceed the DB CHECK (4) or each other", () => {
    expect(parseShotConfig([
      { key: "extra_shot_zar", value: "1000" },
      { key: "max_shots_per_line", value: 5 },
      { key: "max_shots_weekday", value: 2.5 },
    ])).toEqual(DEFAULTS);
    expect(parseShotConfig([
      { key: "max_shots_per_line", value: 1 },
    ])).toEqual({ extraShotZar: 1000, maxShotsPerLine: 1, maxShotsWeekday: 1 });
    expect(parseShotConfig([{ key: "extra_shot_zar", value: -1 }]).extraShotZar).toBe(1000);
  });
});

describe("parseShotConfigWithFallbacks — a fallback is observable, not silent", () => {
  it("valid rows or no rows → no fallbacks", () => {
    expect(parseShotConfigWithFallbacks([]).fallbacks).toEqual([]);
    expect(parseShotConfigWithFallbacks([
      { key: "extra_shot_zar", value: 1000 },
      { key: "max_shots_per_line", value: 4 },
      { key: "max_shots_weekday", value: 2 },
    ])).toEqual({ config: DEFAULTS, fallbacks: [] });
  });

  it("a string, a fraction and a negative are each named, and the PRD default is used", () => {
    expect(parseShotConfigWithFallbacks([
      { key: "extra_shot_zar", value: "1000" },
      { key: "max_shots_per_line", value: 2.5 },
      { key: "max_shots_weekday", value: -2 },
    ])).toEqual({
      config: DEFAULTS,
      fallbacks: ["extra_shot_zar", "max_shots_per_line", "max_shots_weekday"],
    });
  });

  it("a weekday ceiling above the per-line one is clamped and named", () => {
    expect(parseShotConfigWithFallbacks([
      { key: "max_shots_per_line", value: 2 },
      { key: "max_shots_weekday", value: 3 },
    ])).toEqual({ config: { extraShotZar: 1000, maxShotsPerLine: 2, maxShotsWeekday: 2 }, fallbacks: ["max_shots_weekday"] });
  });
});
