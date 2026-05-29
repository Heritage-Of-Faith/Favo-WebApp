import { describe, it, expect } from "vitest";
import {
  isWeekdayInSAST,
  isCappuccino,
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

describe("discount: cappuccino check", () => {
  it("matches Cappuccino case-insensitively and trimmed", () => {
    expect(isCappuccino("Cappuccino")).toBe(true);
    expect(isCappuccino("  cappuccino ")).toBe(true);
  });

  it("rejects other drinks", () => {
    expect(isCappuccino("Latte")).toBe(false);
    expect(isCappuccino("Flat White")).toBe(false);
  });
});

describe("discount: eligibility gate", () => {
  it("allows a Cappuccino on a weekday", () => {
    expect(checkStaffDiscountEligibility("Cappuccino", FRIDAY)).toEqual({
      eligible: true,
    });
  });

  it("rejects a non-cappuccino even on a weekday", () => {
    const result = checkStaffDiscountEligibility("Latte", FRIDAY);
    expect(result.eligible).toBe(false);
    if (!result.eligible) expect(result.code).toBe("NOT_CAPPUCCINO");
  });

  it("rejects a Cappuccino on a weekend", () => {
    const result = checkStaffDiscountEligibility("Cappuccino", SATURDAY);
    expect(result.eligible).toBe(false);
    if (!result.eligible) expect(result.code).toBe("NOT_WEEKDAY");
  });
});
