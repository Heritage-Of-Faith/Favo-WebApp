// Unit tests for draftOrder Zustand store (M2)

import { describe, it, expect, beforeEach } from "vitest";
import { useDraftOrder, lineKey } from "@/store/draftOrder";

const item1 = {
  menuItemId: "mi-1",
  menuItemName: "Cappuccino",
  unitPriceZar: 4500,
  modifications: [],
};

const item2 = {
  menuItemId: "mi-2",
  menuItemName: "Extra Shot",
  unitPriceZar: 1000,
  modifications: [],
};

function store() {
  return useDraftOrder.getState();
}

describe("draftOrder store", () => {
  beforeEach(() => {
    useDraftOrder.getState().reset();
  });

  it("starts with empty state", () => {
    const s = store();
    expect(s.step).toBe("customer");
    expect(s.customer).toBeNull();
    expect(s.items).toHaveLength(0);
    expect(s.totalZar).toBe(0);
    expect(s.orderId).toBeNull();
  });

  it("setStep updates the step", () => {
    store().setStep("build");
    expect(store().step).toBe("build");
  });

  it("setCustomer stores and retrieves a customer", () => {
    const c = { id: "c1", name: "Louis", phone: "0821234567", email: null, loyaltyPoints: 50, activePackCount: 0 };
    store().setCustomer(c);
    expect(store().customer).toEqual(c);
  });

  it("setCustomer(null) clears the customer", () => {
    const c = { id: "c1", name: "Louis", phone: null, email: null, loyaltyPoints: 0, activePackCount: 0 };
    store().setCustomer(c);
    store().setCustomer(null);
    expect(store().customer).toBeNull();
  });

  it("addItem adds a new line and updates totalZar", () => {
    store().addItem(item1);
    expect(store().items).toHaveLength(1);
    expect(store().totalZar).toBe(4500);
  });

  it("addItem increments quantity when same item + mods added again", () => {
    store().addItem(item1);
    store().addItem(item1);
    expect(store().items).toHaveLength(1);
    expect(store().items[0].quantity).toBe(2);
    expect(store().totalZar).toBe(9000);
  });

  it("addItem keeps distinct lines for different modifications", () => {
    const mod = { id: "mod-1", name: "Oat Milk", priceDeltaZar: 500 };
    store().addItem({ ...item1, modifications: [] });
    store().addItem({ ...item1, modifications: [mod] });
    expect(store().items).toHaveLength(2);
  });

  it("removeItem deletes a line and recalculates total", () => {
    store().addItem(item1);
    store().addItem(item2);
    store().removeItem(lineKey(item1));
    expect(store().items).toHaveLength(1);
    expect(store().totalZar).toBe(1000);
  });

  it("removeItem targets only the exact line (same item, different mods)", () => {
    const mod = { id: "mod-1", name: "Oat Milk", priceDeltaZar: 500 };
    store().addItem({ ...item1, modifications: [] });
    store().addItem({ ...item1, modifications: [mod] });
    // Remove only the plain cappuccino — oat-milk variant should remain
    store().removeItem(lineKey({ ...item1, modifications: [] }));
    expect(store().items).toHaveLength(1);
    expect(store().items[0].modifications[0].id).toBe("mod-1");
  });

  it("updateQuantity changes quantity and recalculates total", () => {
    store().addItem(item1);
    store().updateQuantity(lineKey(item1), 3);
    expect(store().items[0].quantity).toBe(3);
    expect(store().totalZar).toBe(13500);
  });

  it("updateQuantity(0) removes the item", () => {
    store().addItem(item1);
    store().updateQuantity(lineKey(item1), 0);
    expect(store().items).toHaveLength(0);
  });

  it("totalZar accounts for modification price deltas", () => {
    const mod = { id: "mod-1", name: "Oat Milk", priceDeltaZar: 500 };
    store().addItem({ ...item1, modifications: [mod] });
    // 4500 base + 500 mod = 5000
    expect(store().totalZar).toBe(5000);
  });

  it("setOrderCreated stores orderId and moves to pay step", () => {
    store().addItem(item1);
    store().setOrderCreated("ord-1", "secret-abc");
    expect(store().orderId).toBe("ord-1");
    expect(store().yocoClientSecret).toBe("secret-abc");
    expect(store().step).toBe("pay");
  });

  it("reset returns to initial state", () => {
    store().addItem(item1);
    store().setCustomer({ id: "c1", name: "Louis", phone: null, email: null, loyaltyPoints: 0, activePackCount: 0 });
    store().setOrderCreated("ord-1", "secret");
    store().reset();
    const s = store();
    expect(s.items).toHaveLength(0);
    expect(s.customer).toBeNull();
    expect(s.orderId).toBeNull();
    expect(s.step).toBe("customer");
    expect(s.totalZar).toBe(0);
  });
});
