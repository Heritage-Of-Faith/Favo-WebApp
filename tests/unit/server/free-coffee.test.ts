// AT-183 / AT-184 — pure decision logic for the free weekday cup (L03).
import { describe, it, expect } from "vitest";
import {
  decideFreeCup, pickFreeCupLine, isFreeCupWeekday, FREE_CUP_COPY, type FreeCupInput,
} from "@/server/orders/free-coffee";

const COFFEE = { category: "coffee", unitPriceZar: 3000, quantity: 1 };
const TEA = { category: "tea", unitPriceZar: 3500, quantity: 1 };
const OFFICE = { status: "office_staff" as const };
const CHURCH = { status: "church_member" as const };

const base: FreeCupInput = {
  customer: OFFICE, customerBound: true, sessionOpen: true, weekdayDate: true, weekday: true,
  lines: [COFFEE], alreadyClaimed: false,
};

describe("decideFreeCup", () => {
  it("applies one unit of the first eligible line", () => {
    expect(decideFreeCup(base)).toEqual({ status: "apply", lineIndex: 0, discountZar: 3000 });
  });

  it("discounts one unit's unit_price_zar even on a quantity-2 line (never the line)", () => {
    expect(decideFreeCup({ ...base, lines: [{ ...COFFEE, quantity: 2 }] }))
      .toEqual({ status: "apply", lineIndex: 0, discountZar: 3000 });
  });

  it("already claimed today → ENTITLEMENT_USED, audited", () => {
    expect(decideFreeCup({ ...base, alreadyClaimed: true })).toEqual({
      status: "refused", code: "ENTITLEMENT_USED", reason: "already_claimed",
      message: "Free cup already claimed today", audit: true,
    });
  });

  it("church member → NOT_ELIGIBLE", () => {
    expect(decideFreeCup({ ...base, customer: CHURCH })).toMatchObject({
      code: "NOT_ELIGIBLE", reason: "not_office_staff", message: "Not eligible for the free cup",
    });
  });

  it("no opening session on a weekday → NO_SESSION (PRD S1), audited when a coffee line was there", () => {
    expect(decideFreeCup({ ...base, sessionOpen: false, weekday: false })).toEqual({
      status: "refused", code: "NO_SESSION", reason: "no_session",
      message: "Open today's session first", audit: true,
    });
  });

  it("a Saturday with no session is simply not a weekday — never 'Open today's session first'", () => {
    expect(decideFreeCup({ ...base, sessionOpen: false, weekdayDate: false, weekday: false })).toEqual({
      status: "refused", code: "NOT_ELIGIBLE", reason: "not_weekday",
      message: "Not eligible for the free cup", audit: false,
    });
  });

  it("not weekday → NOT_ELIGIBLE", () => {
    expect(decideFreeCup({ ...base, weekday: false })).toMatchObject({ code: "NOT_ELIGIBLE", reason: "not_weekday" });
  });

  it("no eligible (coffee) line → NOT_ELIGIBLE, audited", () => {
    expect(decideFreeCup({ ...base, lines: [TEA] })).toMatchObject({
      code: "NOT_ELIGIBLE", reason: "no_eligible_item", audit: true,
    });
  });

  it("no customer → pick-the-customer message on a weekday coffee order, silence otherwise", () => {
    const none = { ...base, customer: null, customerBound: false };
    expect(decideFreeCup(none)).toMatchObject({ reason: "no_customer", message: FREE_CUP_COPY.noCustomer });
    expect(decideFreeCup({ ...none, weekday: false })).toMatchObject({ reason: "no_customer", message: null });
  });

  it("a church member on a Sunday is not told anything", () => {
    expect(decideFreeCup({ ...base, customer: CHURCH, weekday: false })).toMatchObject({ message: null });
  });
});

describe("pickFreeCupLine", () => {
  it("picks the first coffee line, skipping non-coffee", () => {
    expect(pickFreeCupLine([TEA, COFFEE, { ...COFFEE, unitPriceZar: 3800 }])).toBe(1);
  });
  it("returns null when nothing is eligible", () => {
    expect(pickFreeCupLine([TEA])).toBeNull();
  });
});

describe("isFreeCupWeekday — mode='weekday' AND Mon–Fri in SAST", () => {
  const THU = new Date("2026-10-08T09:00:00+02:00");
  const SUN = new Date("2026-10-11T09:00:00+02:00");
  it("weekday mode on a Thursday", () => expect(isFreeCupWeekday(["weekday"], THU)).toBe(true));
  it("no session today → not weekday", () => expect(isFreeCupWeekday([], THU)).toBe(false));
  it("event mode → not weekday", () => expect(isFreeCupWeekday(["event"], THU)).toBe(false));
  it("sunday mode → not weekday", () => expect(isFreeCupWeekday(["sunday"], SUN)).toBe(false));
  it("weekday mode but the date is a Sunday → not weekday", () => expect(isFreeCupWeekday(["weekday"], SUN)).toBe(false));
});
