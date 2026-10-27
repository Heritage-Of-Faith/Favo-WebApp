import { describe, it, expect } from "vitest";
import { customerMatches, normalisePhoneDigits, planSearch } from "@/lib/pos/customer-match";
import { wasteQuantityError } from "@/lib/pos/waste-validation";

const LOUIS = { name: "Louis", surname: "Dlamini", phone: "0821234567" };
const INTL = { name: "Louis", surname: "Botha", phone: "+27 82 123 4567" };

describe("customer search matcher", () => {
  it.each(["0821", "082 123 4567", "+27821234567", "27821234567", "+27 82 123", "0821234567", "4567"])(
    "finds by phone input %s",
    (q) => {
      expect(customerMatches(LOUIS, q)).toBe(true);
      expect(customerMatches(INTL, q)).toBe(true);
    }
  );
  it("does not match a different number", () => {
    expect(customerMatches(LOUIS, "0831")).toBe(false);
  });
  it("normalises international input to the local form", () => {
    expect(normalisePhoneDigits("+27821234567")).toBe("0821234567");
    expect(normalisePhoneDigits("0027 82 123 4567")).toBe("0821234567");
  });
  it.each(["botha louis", "Louis Botha", "Botha, Louis", "lou", "BOTHA"])("matches name input %s", (q) => {
    expect(customerMatches(INTL, q)).toBe(true);
  });
  it("matches 'Dlamini, Louis' on given name + surname, any order", () => {
    expect(customerMatches(LOUIS, "Dlamini, Louis")).toBe(true);
    expect(customerMatches(LOUIS, "louis dlamini")).toBe(true);
    expect(customerMatches(LOUIS, "botha louis")).toBe(false);
  });
  it("plans phone vs name", () => {
    expect(planSearch("082 123").kind).toBe("phone");
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
