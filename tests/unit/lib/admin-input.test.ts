// Admin input rules (QA r1-admin P1-1, P2b, P2h).
// Plain numbers only. PRD v7 §7.0.2: unit_cost = lot.cost_zar / lot.yield_units,
// "cents to 4 decimal places, NOT rounded" (stored in inventory_lots.unit_cost_zar,
// numeric(10,4)). So R225 for 500 g is 22500 c / 500 g = 45.0000 c/g = R0.45 per g.

import { describe, it, expect } from "vitest";
import {
  deriveUnitCostCents,
  formatUnitCostRands,
  parseLotUnitCost,
  parseMenuPriceCents,
  INT4_MAX,
  UNIT_COST_MAX,
  SOURCE_NAME_MAX,
} from "@/lib/admin-input";

describe("deriveUnitCostCents (purchase -> inventory_lots.unit_cost_zar)", () => {
  it("R225 for 500 g = 45.0000 c/g (R0.45 per g)", () => {
    const r = deriveUnitCostCents(22500, 500);
    expect(r).toEqual({ ok: true, value: "45.0000" });
    if (r.ok) expect(formatUnitCostRands(r.value)).toBe("R0.4500");
  });

  it("R20 for 100 g = 20.0000 c/g (R0.20 per g)", () => {
    const r = deriveUnitCostCents(2000, 100);
    expect(r).toEqual({ ok: true, value: "20.0000" });
    if (r.ok) expect(formatUnitCostRands(r.value)).toBe("R0.2000");
  });

  it("keeps sub-cent costs to 4 dp (R1.80 for 1000 g = 0.1800 c/g)", () => {
    expect(deriveUnitCostCents(180, 1000)).toEqual({ ok: true, value: "0.1800" });
  });

  it("keeps sub-cent costs to 4 dp (R1 for 3000 g = 0.0333 c/g)", () => {
    expect(deriveUnitCostCents(100, 3000)).toEqual({ ok: true, value: "0.0333" });
  });

  it("refuses a cost that would round to 0.0000 (never silently free)", () => {
    const r = deriveUnitCostCents(1, 1_000_000);
    expect(r.ok).toBe(false);
  });

  it("refuses zero or negative totals and quantities", () => {
    expect(deriveUnitCostCents(0, 500).ok).toBe(false);
    expect(deriveUnitCostCents(-100, 500).ok).toBe(false);
    expect(deriveUnitCostCents(22500, 0).ok).toBe(false);
    expect(deriveUnitCostCents(22500, -5).ok).toBe(false);
    expect(deriveUnitCostCents(Number.NaN, 500).ok).toBe(false);
  });

  it("refuses a per-unit cost the numeric(10,4) column cannot hold", () => {
    // R10 000 000 for 1 unit = 1 000 000 000 c/unit > 999 999.9999
    const r = deriveUnitCostCents(1_000_000_000, 1);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/too large/i);
  });
});

describe("parseLotUnitCost (admin recost)", () => {
  it("accepts 0.45 and normalises to 4 dp", () => {
    expect(parseLotUnitCost("0.45")).toEqual({ ok: true, value: "0.4500" });
  });
  it("accepts a comma decimal (0,2000)", () => {
    expect(parseLotUnitCost("0,2000")).toEqual({ ok: true, value: "0.2000" });
  });
  it("refuses empty", () => {
    expect(parseLotUnitCost("").ok).toBe(false);
    expect(parseLotUnitCost("   ").ok).toBe(false);
  });
  it("refuses 0 (an ingredient must never silently become free)", () => {
    expect(parseLotUnitCost("0").ok).toBe(false);
    expect(parseLotUnitCost("0.0000").ok).toBe(false);
  });
  it("refuses a value that rounds to 0.0000 (0.00001)", () => {
    expect(parseLotUnitCost("0.00001").ok).toBe(false);
  });
  it("refuses negatives and text", () => {
    expect(parseLotUnitCost("-1").ok).toBe(false);
    expect(parseLotUnitCost("abc").ok).toBe(false);
  });
  it("refuses 99999999 and 1e9 with a message (no server 500)", () => {
    for (const v of ["99999999", "1000000000", "1e9"]) {
      const r = parseLotUnitCost(v);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.message).toMatch(/too large|number/i);
    }
  });
  it("UNIT_COST_MAX is the numeric(10,4) ceiling", () => {
    expect(UNIT_COST_MAX).toBe(999999.9999);
    expect(parseLotUnitCost("999999.9999")).toEqual({ ok: true, value: "999999.9999" });
  });
});

describe("parseMenuPriceCents", () => {
  it("R46.00 -> 4600", () => {
    expect(parseMenuPriceCents("46.00")).toEqual({ ok: true, value: 4600 });
  });
  it("refuses -5, empty, 0, abc, 45.555", () => {
    for (const v of ["-5", "", "0", "abc", "45.555"]) {
      expect(parseMenuPriceCents(v).ok).toBe(false);
    }
  });
  it("refuses 99999999 rands (does not fit an integer cents column)", () => {
    const r = parseMenuPriceCents("99999999");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/too large/i);
  });
  it("INT4_MAX is the Postgres integer ceiling", () => {
    expect(INT4_MAX).toBe(2147483647);
  });
});

describe("SOURCE_NAME_MAX", () => {
  it("is 100 characters", () => {
    expect(SOURCE_NAME_MAX).toBe(100);
  });
});
