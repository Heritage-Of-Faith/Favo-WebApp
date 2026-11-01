// AT-191 · REQ-110 · PRD §7.0.1b: "The flag turns green only when every
// contributing lot is invoice-backed." order_cogs.estimated is that flag, per
// order.

import { describe, it, expect, vi } from "vitest";

vi.mock("@db/index", () => ({ db: {} }));

import { orderUsesEstimate, type Consumption } from "@/server/orders/order-cogs";

const beans: Consumption = { inventoryItemId: "beans", costUnits: 2, draws: [{ lotId: "lot_a", units: 2 }] };
const milk: Consumption = { inventoryItemId: "milk", costUnits: 1, draws: [{ lotId: "lot_b", units: 1 }] };

describe("orderUsesEstimate", () => {
  it("every lot invoice-backed → false (the only green case)", () => {
    const src = new Map([["lot_a", "invoice"], ["lot_b", "invoice"]] as const);
    expect(orderUsesEstimate([beans, milk], src)).toBe(false);
  });

  it("one estimate lot → true", () => {
    const src = new Map([["lot_a", "invoice"], ["lot_b", "estimate"]] as const);
    expect(orderUsesEstimate([beans, milk], src)).toBe(true);
  });

  it("a lot whose cost_source is unknown counts as an estimate", () => {
    const src = new Map([["lot_a", "invoice"]] as const);
    expect(orderUsesEstimate([beans, milk], src)).toBe(true);
  });

  it("DEF-G: a multi-lot draw is estimated if either lot is", () => {
    const split: Consumption = {
      inventoryItemId: "beans",
      costUnits: 2,
      draws: [
        { lotId: "lot_a", units: 1 },
        { lotId: "lot_c", units: 1 },
      ],
    };
    const src = new Map([["lot_a", "invoice"], ["lot_c", "estimate"]] as const);
    expect(orderUsesEstimate([split], src)).toBe(true);
  });

  it("an order that consumed nothing is not estimated", () => {
    expect(orderUsesEstimate([], new Map())).toBe(false);
  });
});
