import { describe, it, expect } from "vitest";
import bcrypt from "bcryptjs";
import { MENU_ITEMS, ESPRESSO_DRINK_IDS } from "@db/seed/menu";
import { CUSTOMISATIONS } from "@db/seed/customisations";
import { STAFF_SEED } from "@db/seed/staff";
import { CUSTOMERS_SEED } from "@db/seed/customers";
import { OPERATING_HOURS_SEED } from "@db/seed/hours";

const isPositiveInt = (n: number) => Number.isInteger(n) && n > 0;
const isNonNegativeInt = (n: number) => Number.isInteger(n) && n >= 0;

describe("seed: menu", () => {
  it("includes a Cappuccino (required by the acceptance test)", () => {
    const cappuccino = MENU_ITEMS.find((m) => m.name === "Cappuccino");
    expect(cappuccino).toBeDefined();
    expect(cappuccino?.category).toBe("coffee");
  });

  it("prices are positive integer cents (never decimals)", () => {
    for (const item of MENU_ITEMS) {
      expect(isPositiveInt(item.currentPriceZar)).toBe(true);
    }
  });

  it("has unique ids", () => {
    const ids = MENU_ITEMS.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every espresso drink id exists in the menu", () => {
    for (const id of ESPRESSO_DRINK_IDS) {
      expect(MENU_ITEMS.some((m) => m.id === id)).toBe(true);
    }
  });
});

describe("seed: customisations", () => {
  it("every espresso drink offers an Extra Shot", () => {
    for (const drinkId of ESPRESSO_DRINK_IDS) {
      const hasExtraShot = CUSTOMISATIONS.some(
        (c) => c.menuItemId === drinkId && c.name === "Extra Shot"
      );
      expect(hasExtraShot).toBe(true);
    }
  });

  it("every customisation references a real menu item", () => {
    const menuIds = new Set(MENU_ITEMS.map((m) => m.id));
    for (const c of CUSTOMISATIONS) {
      expect(menuIds.has(c.menuItemId)).toBe(true);
    }
  });

  it("price deltas are non-negative integer cents", () => {
    for (const c of CUSTOMISATIONS) {
      expect(isNonNegativeInt(c.priceDeltaZar)).toBe(true);
    }
  });

  it("has unique ids", () => {
    const ids = CUSTOMISATIONS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("seed: staff", () => {
  it("has exactly one barista with the documented test PIN 1234", () => {
    const testPinStaff = STAFF_SEED.filter((s) => s.pin === "1234");
    expect(testPinStaff).toHaveLength(1);
    expect(testPinStaff[0].role).toBe("barista");
  });

  it("all PINs are 4-digit numeric strings", () => {
    for (const s of STAFF_SEED) {
      expect(s.pin).toMatch(/^\d{4}$/);
    }
  });

  it("has unique ids and PINs", () => {
    expect(new Set(STAFF_SEED.map((s) => s.id)).size).toBe(STAFF_SEED.length);
    expect(new Set(STAFF_SEED.map((s) => s.pin)).size).toBe(STAFF_SEED.length);
  });

  it("a bcrypt hash of the PIN verifies (and plain PIN is never the hash)", async () => {
    const { pin } = STAFF_SEED[0];
    const hash = await bcrypt.hash(pin, 10);
    expect(hash).not.toBe(pin);
    expect(await bcrypt.compare(pin, hash)).toBe(true);
    expect(await bcrypt.compare("0000", hash)).toBe(false);
  });
});

describe("seed: customers", () => {
  it("includes Louis, findable by a 'lou' prefix search", () => {
    const louis = CUSTOMERS_SEED.find((c) => c.id === "cust_louis");
    expect(louis).toBeDefined();
    expect(louis?.name.toLowerCase().startsWith("lou")).toBe(true);
  });

  it("loyalty points are non-negative integers", () => {
    for (const c of CUSTOMERS_SEED) {
      expect(isNonNegativeInt(c.loyaltyPoints)).toBe(true);
    }
  });
});

describe("seed: operating hours", () => {
  it("covers all 7 days exactly once (0=Sun … 6=Sat)", () => {
    const days = OPERATING_HOURS_SEED.map((h) => h.dayOfWeek).sort((a, b) => a - b);
    expect(days).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it("Saturday (6) is closed", () => {
    const sat = OPERATING_HOURS_SEED.find((h) => h.dayOfWeek === 6);
    expect(sat?.isClosed).toBe(true);
  });

  it("open days have HH:MM open and close times", () => {
    for (const h of OPERATING_HOURS_SEED.filter((d) => !d.isClosed)) {
      expect(h.openTime).toMatch(/^\d{2}:\d{2}$/);
      expect(h.closeTime).toMatch(/^\d{2}:\d{2}$/);
    }
  });
});
