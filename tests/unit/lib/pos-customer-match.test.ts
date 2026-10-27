import { describe, it, expect } from "vitest";
import { customerMatches, normalisePhoneDigits, planSearch } from "@/lib/pos/customer-match";
import { wasteQuantityError } from "@/lib/pos/waste-validation";

const LOUIS = { name: "Louis", surname: "Dlamini", phone: "0821234567" };
const INTL = { name: "Louis", surname: "Botha", phone: "+27 82 123 4567" };

// CHANGED (review round): phone prefix / partial matching was removed — it let a
// barista rebuild full numbers. A phone query is the FULL number or EXACTLY the last 4 digits.
describe("customer search matcher — phone", () => {
  it.each(["0821234567", "082 123 4567", "+27821234567", "27821234567", "+27 82 123 4567", "4567"])(
    "finds by full number or last 4: %s",
    (q) => {
      expect(customerMatches(LOUIS, q)).toBe(true);
      expect(customerMatches(INTL, q)).toBe(true);
    }
  );
  it.each(["0821", "082", "08212", "082123", "1234567", "821234567", "+2782", "234567", "567", "34567"])(
    "does NOT match a prefix, suffix or middle part: %s",
    (q) => {
      expect(customerMatches(LOUIS, q)).toBe(false);
      expect(customerMatches(INTL, q)).toBe(false);
    }
  );
  it("does not match a different number", () => {
    expect(customerMatches(LOUIS, "0831234567")).toBe(false);
    expect(customerMatches(LOUIS, "1111")).toBe(false);
  });
  it("normalises international input to the local form", () => {
    expect(normalisePhoneDigits("+27821234567")).toBe("0821234567");
    expect(normalisePhoneDigits("0027 82 123 4567")).toBe("0821234567");
  });
  it("requires at least 4 digits for a phone query", () => {
    expect(planSearch("082").kind).toBe("none");
    expect(planSearch("4567")).toEqual({ kind: "phone", full: null, last4: "4567" });
    expect(planSearch("082 123 4567")).toEqual({ kind: "phone", full: "0821234567", last4: null });
  });
});

describe("customer search matcher — names", () => {
  it.each(["botha louis", "Louis Botha", "Botha, Louis", "lou", "BOTHA"])("matches name input %s", (q) => {
    expect(customerMatches(INTL, q)).toBe(true);
  });
  it("matches 'Dlamini, Louis' on given name + surname, any order", () => {
    expect(customerMatches(LOUIS, "Dlamini, Louis")).toBe(true);
    expect(customerMatches(LOUIS, "louis dlamini")).toBe(true);
    expect(customerMatches(LOUIS, "botha louis")).toBe(false);
  });
  it("plans name vs none", () => {
    expect(planSearch("Lou").kind).toBe("name");
    expect(planSearch(" , ").kind).toBe("none");
  });
});

describe("waste quantity validation", () => {
  it.each(["0", "-1", "1.5", "", "abc", "501", "99999999"])("rejects %s with a message", (q) => {
    expect(wasteQuantityError(q)).toBeTruthy();
  });
  it.each(["1", "500", " 12 "])("accepts %s", (q) => {
    expect(wasteQuantityError(q)).toBeNull();
  });
});
