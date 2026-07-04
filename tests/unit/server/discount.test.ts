import { describe, it, expect } from "vitest";
import {
  isWeekdayInSAST,
  isCoffeeCategory,
  checkStaffDiscountEligibility,
} from "@/server/orders/discount";

// Reference dates (2026): 29 May = Fri, 30 May = Sat, 31 May = Sun, 1 Jun = Mon.
const FRIDAY = new Date("2026-05-29T10:00:00+02:00");
const SATURDAY = new Date("2026-05-30T10:00:00+02:00");
const SUNDAY = new Date("2026-05-31T10:00:00+02:00");
const MONDAY = new Date("2026-06-01T10:00:00+02:00");

describe("discount: weekday in SAST", () => {
  it("treats Mon–Fri as weekdays", () => {
    expect(isWeekdayInSAST(FRIDAY)).toBe(true);
    expect(isWeekdayInSAST(MONDAY)).toBe(true);
  });

  it("treats Sat/Sun as non-weekdays", () => {
    expect(isWeekdayInSAST(SATURDAY)).toBe(false);
    expect(isWeekdayInSAST(SUNDAY)).toBe(false);
  });

  it("evaluates the day in SAST, not UTC", () => {
    // Fri 23:30 UTC is Sat 01:30 in Africa/Johannesburg → NOT a weekday.
    const fridayLateUtc = new Date("2026-05-29T23:30:00Z");
    expect(isWeekdayInSAST(fridayLateUtc)).toBe(false);
  });
});

describe("discount: coffee-category check (L03/L14)", () => {
  it("treats category='coffee' as eligible", () => {
    expect(isCoffeeCategory("coffee")).toBe(true);
  });

  it("rejects non-coffee categories", () => {
    // Any category other than 'coffee' (e.g. hot chocolate, teas) does not qualify.
    expect(isCoffeeCategory("non_coffee")).toBe(false);
    expect(isCoffeeCategory("hot_chocolate")).toBe(false);
    expect(isCoffeeCategory("tea")).toBe(false);
    expect(isCoffeeCategory(null)).toBe(false);
    expect(isCoffeeCategory(undefined)).toBe(false);
  });
});

describe("discount: eligibility gate", () => {
  it("allows an order with a coffee item on a weekday", () => {
    expect(checkStaffDiscountEligibility(true, FRIDAY)).toEqual({
      eligible: true,
    });
  });

  it("accepts ANY coffee item, not just Cappuccino (L03/L14)", () => {
    // The gate is category-based: as long as the order has a coffee item
    // (latte, espresso, flat white, …) it is eligible on a weekday.
    expect(checkStaffDiscountEligibility(true, MONDAY).eligible).toBe(true);
  });

  it("rejects an order with no coffee item even on a weekday", () => {
    const result = checkStaffDiscountEligibility(false, FRIDAY);
    expect(result.eligible).toBe(false);
    if (!result.eligible) expect(result.code).toBe("NOT_COFFEE");
  });

  it("rejects a coffee order on a weekend", () => {
    const result = checkStaffDiscountEligibility(true, SATURDAY);
    expect(result.eligible).toBe(false);
    if (!result.eligible) expect(result.code).toBe("NOT_WEEKDAY");
  });
});
