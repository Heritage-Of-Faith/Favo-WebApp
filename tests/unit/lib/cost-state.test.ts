// AT-189 · AT-190 · AT-191 · AT-192 — REQ-106, REQ-109, REQ-110, REQ-129, REQ-131.
// Three states, three renderings (REQ-129): empty ≠ UNAVAILABLE ≠ provisional.

import { describe, it, expect } from "vitest";
import {
  combineCostStates,
  costStatusLabel,
  netTone,
  rollupOrderCogs,
  unavailableText,
} from "@/lib/cost-state";

describe("rollupOrderCogs — a period is a SUM of per-order integers (REQ-106)", () => {
  it("sums the integers, never re-rounding: 529 + 1059 = 1588", () => {
    // PRD L1856: a one-cup order 529c and a two-cup order 1059c.
    const r = rollupOrderCogs([
      { cogsZar: 529, absentItemIds: [], estimated: false },
      { cogsZar: 1059, absentItemIds: [], estimated: false },
    ]);
    expect(r).toMatchObject({ state: "final", cogsZar: 1588 });
  });

  it("N3: orders that costed nothing (cogs 0, nothing estimated) do not make a day final — it reads empty, not green", () => {
    const r = rollupOrderCogs([
      { cogsZar: 0, absentItemIds: [], estimated: false },
      { cogsZar: 0, absentItemIds: [], estimated: false },
    ]);
    expect(r).toMatchObject({ state: "empty", cogsZar: 0, orderCount: 2 });
    expect(netTone(r.state, 4000)).toBe("neutral");
    expect(netTone(r.state, 4000)).not.toBe("positive");
  });

  it("N3: a zero-cost order beside an estimated one leaves the day provisional; beside an invoiced one, final", () => {
    expect(
      rollupOrderCogs([
        { cogsZar: 0, absentItemIds: [], estimated: false },
        { cogsZar: 441, absentItemIds: [], estimated: true },
      ]).state
    ).toBe("provisional");
    expect(
      rollupOrderCogs([
        { cogsZar: 0, absentItemIds: [], estimated: false },
        { cogsZar: 441, absentItemIds: [], estimated: false },
      ]).state
    ).toBe("final");
  });

  it("no orders → empty, a genuine zero", () => {
    expect(rollupOrderCogs([])).toMatchObject({ state: "empty", cogsZar: 0, orderCount: 0 });
  });

  it("any estimated order → provisional (REQ-110)", () => {
    const r = rollupOrderCogs([
      { cogsZar: 529, absentItemIds: [], estimated: false },
      { cogsZar: 441, absentItemIds: [], estimated: true },
    ]);
    expect(r).toMatchObject({ state: "provisional", cogsZar: 970 });
  });

  it("estimated NULL (unknown) is not proof of an invoice → provisional", () => {
    expect(rollupOrderCogs([{ cogsZar: 529, absentItemIds: [], estimated: null }]).state).toBe("provisional");
  });

  it("an order that refused → UNAVAILABLE with no number, the item named, never a smaller sum (REQ-109)", () => {
    const r = rollupOrderCogs([
      { cogsZar: 1352, absentItemIds: [], estimated: true },
      { cogsZar: null, absentItemIds: ["inv_item_oat_milk"], estimated: true },
      { cogsZar: null, absentItemIds: ["inv_item_macadamia_milk", "inv_item_oat_milk"], estimated: true },
    ]);
    expect(r.state).toBe("unavailable");
    expect(r.cogsZar).toBeNull();
    expect(r.absentItemIds).toEqual(["inv_item_macadamia_milk", "inv_item_oat_milk"]);
  });

  it("an order with no order_cogs row at all → UNAVAILABLE, counted", () => {
    const r = rollupOrderCogs([
      { cogsZar: 1352, absentItemIds: [], estimated: false },
      { cogsZar: null, absentItemIds: [], estimated: null, missing: true },
    ]);
    expect(r).toMatchObject({ state: "unavailable", cogsZar: null, ordersWithoutCost: 1 });
  });
});

describe("combineCostStates", () => {
  it("unavailable beats provisional beats final beats empty", () => {
    expect(combineCostStates(["final", "unavailable", "provisional"])).toBe("unavailable");
    expect(combineCostStates(["final", "provisional", "empty"])).toBe("provisional");
    expect(combineCostStates(["empty", "final"])).toBe("final");
    expect(combineCostStates(["empty", "empty"])).toBe("empty");
    expect(combineCostStates([])).toBe("empty");
  });
});

describe("netTone — green only when every lot is invoice-backed (REQ-110)", () => {
  it("provisional is warn at any sign, never positive", () => {
    expect(netTone("provisional", 14437)).toBe("warn");
    expect(netTone("provisional", -500)).toBe("warn");
    expect(netTone("provisional", 0)).toBe("warn");
  });
  it("unavailable has its own tone, distinct from warn", () => {
    expect(netTone("unavailable", null)).toBe("unavailable");
    expect(netTone("unavailable", null)).not.toBe("warn");
  });
  it("final: positive at ≥ 0, negative below", () => {
    expect(netTone("final", 1)).toBe("positive");
    expect(netTone("final", -1)).toBe("negative");
  });
  it("empty is neutral — a zero day is not a profitable day", () => {
    expect(netTone("empty", 0)).toBe("neutral");
  });
});

describe("the render words", () => {
  it("UNAVAILABLE names the offending item (REQ-109)", () => {
    const names = new Map([["inv_item_oat_milk", "Oat milk"]]);
    expect(unavailableText(["inv_item_oat_milk"], 0, names)).toBe("UNAVAILABLE — Oat milk");
    expect(unavailableText([], 2)).toBe("UNAVAILABLE — 2 orders with no recorded cost");
  });
  it("the export's status column marks each state (REQ-131)", () => {
    expect(costStatusLabel({ state: "provisional", absentItemIds: [], ordersWithoutCost: 0 })).toBe(
      "provisional (estimated costs)"
    );
    expect(costStatusLabel({ state: "unavailable", absentItemIds: ["x"], ordersWithoutCost: 0 })).toBe("UNAVAILABLE — x");
    expect(costStatusLabel({ state: "empty", absentItemIds: [], ordersWithoutCost: 0 })).toBe("no orders");
    expect(costStatusLabel({ state: "final", absentItemIds: [], ordersWithoutCost: 0 })).toBe("final");
  });
});
