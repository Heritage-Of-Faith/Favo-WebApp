// AT-204 — the Untracked hot drink voucher's decision rules (PRD §6.9.1,
// §6.9.2a, §11 redeemVoucher, L41, REQ-151, REQ-154, REQ-155). Pure.
// Money is integer cents: R38 = 3800.

import { describe, it, expect } from "vitest";
import { decideRedeem, decideRemove, lineUnitPriceZar, planLineVouchers } from "@/server/orders/voucher";

const UNTRACKED = { mode: "event" as const, voucherKindsActive: ["untracked_hot_drink"] };
const KIND = "untracked_hot_drink";
const cappuccinoX2 = { quantity: 2, unitPriceZar: 3800, modsZar: 0, discountZar: 0, compReason: null };

describe("lineUnitPriceZar — §6.9.2a: listed price + modifications + extra-shot surcharge, per unit", () => {
  it("a R38 Cappuccino with no modifications is R38", () => {
    expect(lineUnitPriceZar({ unitPriceZar: 3800, modsZar: 0 })).toBe(3800);
  });
  it("a modification is included (R38 + R8 oat = R46)", () => {
    expect(lineUnitPriceZar({ unitPriceZar: 3800, modsZar: 800 })).toBe(4600);
  });
  it("three shots: one chargeable shot (R10) is included — R25 Mocha → R35", () => {
    expect(lineUnitPriceZar({ unitPriceZar: 2500, modsZar: 0, surchargeZar: 1000 })).toBe(3500);
  });
  it("the most a slip can be worth: a R25 Mocha with two chargeable shots is R45", () => {
    expect(lineUnitPriceZar({ unitPriceZar: 2500, modsZar: 0, surchargeZar: 2000 })).toBe(4500);
  });
});

describe("decideRedeem", () => {
  it("REQ-154: 2 × Cappuccino R38, one voucher → line discount R38, line net R38", () => {
    const d = decideRedeem({ session: UNTRACKED, kind: KIND, line: cappuccinoX2, live: { count: 0, discountZar: 0 } });
    expect(d).toEqual({ status: "apply", discountZar: 3800, lineDiscountZar: 3800 });
    if (d.status === "apply") expect(2 * 3800 - d.lineDiscountZar).toBe(3800);
  });

  it("REQ-151: a second voucher on the quantity-2 line is accepted and zeroes the line (R76 off, net R0)", () => {
    const d = decideRedeem({
      session: UNTRACKED, kind: KIND,
      line: { ...cappuccinoX2, discountZar: 3800 }, live: { count: 1, discountZar: 3800 },
    });
    expect(d).toEqual({ status: "apply", discountZar: 3800, lineDiscountZar: 7600 });
  });

  it("REQ-151: a third voucher on a quantity-2 line carrying two is rejected", () => {
    const d = decideRedeem({
      session: UNTRACKED, kind: KIND,
      line: { ...cappuccinoX2, discountZar: 7600 }, live: { count: 2, discountZar: 7600 },
    });
    expect(d).toMatchObject({ status: "refused", code: "VALIDATION" });
  });

  it("one voucher discounts one unit including its modification (R46 with oat)", () => {
    const d = decideRedeem({
      session: UNTRACKED, kind: KIND,
      line: { ...cappuccinoX2, modsZar: 800 }, live: { count: 0, discountZar: 0 },
    });
    expect(d).toEqual({ status: "apply", discountZar: 4600, lineDiscountZar: 4600 });
  });

  it("REQ-155: weekday mode → VOUCHER_NOT_IN_MODE, even if a kind were listed", () => {
    const d = decideRedeem({
      session: { mode: "weekday", voucherKindsActive: [KIND] }, kind: KIND,
      line: cappuccinoX2, live: { count: 0, discountZar: 0 },
    });
    expect(d).toMatchObject({ status: "refused", code: "VOUCHER_NOT_IN_MODE" });
  });

  it("a kind not in the session's voucher_kinds_active → VOUCHER_NOT_IN_MODE (a Sunday session has none)", () => {
    const d = decideRedeem({
      session: { mode: "sunday", voucherKindsActive: [] }, kind: KIND,
      line: cappuccinoX2, live: { count: 0, discountZar: 0 },
    });
    expect(d).toMatchObject({ status: "refused", code: "VOUCHER_NOT_IN_MODE" });
    const other = decideRedeem({ session: UNTRACKED, kind: "christmas", line: cappuccinoX2, live: { count: 0, discountZar: 0 } });
    expect(other).toMatchObject({ status: "refused", code: "VOUCHER_NOT_IN_MODE" });
  });

  // CHANGED (AT-202 part 2): this case asserted the interim refusal
  // VOUCHER_NOT_ON_EXTRA_SHOTS. §6.9.2a (owner, 14 Sep 2026): "A voucher
  // zeroes one whole unit — its listed price, its modifications and its extra
  // shots"; §11 redeemVoucher: "listed price, modifications and extra-shot
  // surcharge together". §6.2.3: a Cappuccino is R20 single, R20 double, R30
  // triple, R40 with four.
  it("AT-202 part 2: a voucher on a triple Cappuccino (R30) zeroes the whole unit, surcharge included", () => {
    const triple = { quantity: 1, unitPriceZar: 2000, modsZar: 0, surchargeZar: 1000, discountZar: 0, compReason: null };
    expect(decideRedeem({ session: UNTRACKED, kind: KIND, line: triple, live: { count: 0, discountZar: 0 } }))
      .toEqual({ status: "apply", discountZar: 3000, lineDiscountZar: 3000 });
    // planLineVouchers (createOrder) shares the rule.
    expect(planLineVouchers({ session: UNTRACKED, kind: KIND, line: triple, count: 1 }))
      .toEqual({ status: "apply", perVoucherZar: [3000], lineDiscountZar: 3000 });
  });

  it("AT-202 part 2: a voucher on a four-shot Cappuccino (R40) takes R40 off — nothing of the surcharge stays owed", () => {
    const quad = { quantity: 1, unitPriceZar: 2000, modsZar: 0, surchargeZar: 2000, discountZar: 0, compReason: null };
    const d = decideRedeem({ session: UNTRACKED, kind: KIND, line: quad, live: { count: 0, discountZar: 0 } });
    expect(d).toEqual({ status: "apply", discountZar: 4000, lineDiscountZar: 4000 });
    if (d.status === "apply") expect(1 * 4000 - d.lineDiscountZar).toBe(0);
  });

  it("§6.9.2a: the most a slip can be worth — a R25 Mocha with four shots — is R45", () => {
    const mocha = { quantity: 1, unitPriceZar: 2500, modsZar: 0, surchargeZar: 2000, discountZar: 0, compReason: null };
    expect(decideRedeem({ session: UNTRACKED, kind: KIND, line: mocha, live: { count: 0, discountZar: 0 } }))
      .toEqual({ status: "apply", discountZar: 4500, lineDiscountZar: 4500 });
  });

  it("boundary: 3 × triple Cappuccino (R30 each), m = 0…3 vouchers → net R90, R60, R30, R0; a 4th is refused", () => {
    const line3 = { quantity: 3, unitPriceZar: 2000, modsZar: 0, surchargeZar: 1000, discountZar: 0, compReason: null };
    const nets = [0, 1, 2, 3].map((m) => {
      const p = planLineVouchers({ session: UNTRACKED, kind: KIND, line: line3, count: m });
      if (p.status !== "apply") throw new Error("refused");
      expect(p.perVoucherZar).toEqual(Array(m).fill(3000));
      return 3 * 3000 - p.lineDiscountZar;
    });
    expect(nets).toEqual([9000, 6000, 3000, 0]);
    expect(planLineVouchers({ session: UNTRACKED, kind: KIND, line: line3, count: 4 }))
      .toMatchObject({ status: "refused", code: "VALIDATION" });
    expect(decideRedeem({
      session: UNTRACKED, kind: KIND,
      line: { ...line3, discountZar: 9000 }, live: { count: 3, discountZar: 9000 },
    })).toMatchObject({ status: "refused", code: "VALIDATION" });
  });

  it("removing one voucher from a vouchered triple restores the whole unit, surcharge included (R30)", () => {
    const r = decideRemove({
      line: { discountZar: 6000 },
      live: [
        { id: "vr_1", discountZar: 3000, at: "2026-11-15T18:00:00Z" },
        { id: "vr_2", discountZar: 3000, at: "2026-11-15T18:01:00Z" },
      ],
    });
    expect(r).toEqual({ status: "apply", redemptionId: "vr_2", lineDiscountZar: 3000, restoredZar: 3000 });
  });

  it("no open session → NO_SESSION", () => {
    const d = decideRedeem({ session: null, kind: KIND, line: cappuccinoX2, live: { count: 0, discountZar: 0 } });
    expect(d).toMatchObject({ status: "refused", code: "NO_SESSION" });
  });

  it("L41: a line carrying the free cup (discount with no voucher row) is rejected", () => {
    const d = decideRedeem({
      session: UNTRACKED, kind: KIND,
      line: { ...cappuccinoX2, discountZar: 3800 }, live: { count: 0, discountZar: 0 },
    });
    expect(d).toMatchObject({ status: "refused", code: "VALIDATION" });
  });

  it("L41: a comped line is rejected", () => {
    const d = decideRedeem({
      session: UNTRACKED, kind: KIND,
      line: { ...cappuccinoX2, discountZar: 7600, compReason: "goodwill" }, live: { count: 0, discountZar: 0 },
    });
    expect(d).toMatchObject({ status: "refused", code: "VALIDATION" });
  });

  it("a line with no net charge (R0 unit price) is rejected — a voucher buys nothing", () => {
    const d = decideRedeem({
      session: UNTRACKED, kind: KIND,
      line: { ...cappuccinoX2, unitPriceZar: 0 }, live: { count: 0, discountZar: 0 },
    });
    expect(d).toMatchObject({ status: "refused", code: "VALIDATION" });
  });
});

describe("decideRemove", () => {
  it("reverses the latest live redemption and restores one unit (R76 off → R38 off)", () => {
    const d = decideRemove({
      line: { ...cappuccinoX2, discountZar: 7600 },
      live: [
        { id: "vr_1", discountZar: 3800, at: new Date("2026-10-11T16:01:00Z") },
        { id: "vr_2", discountZar: 3800, at: new Date("2026-10-11T16:02:00Z") },
      ],
    });
    expect(d).toEqual({ status: "apply", redemptionId: "vr_2", lineDiscountZar: 3800, restoredZar: 3800 });
  });

  it("the remaining line discount is the sum of the live rows left, never column − one row", () => {
    // A stale column (R76) with one live R38 row left: the line ends at R0, not R38.
    const d = decideRemove({
      line: { ...cappuccinoX2, discountZar: 7600 },
      live: [{ id: "vr_1", discountZar: 3800, at: new Date("2026-10-11T16:01:00Z") }],
    });
    expect(d).toEqual({ status: "apply", redemptionId: "vr_1", lineDiscountZar: 0, restoredZar: 3800 });
  });

  it("a line with no live voucher → VALIDATION", () => {
    expect(decideRemove({ line: cappuccinoX2, live: [] })).toMatchObject({ status: "refused", code: "VALIDATION" });
  });
});

describe("planLineVouchers — createOrder's n vouchers on one new line (L41, REQ-151)", () => {
  it("2 vouchers on 2 × Cappuccino R38 with R8 oat → R46 each, line discount R92", () => {
    expect(
      planLineVouchers({ session: UNTRACKED, kind: KIND, line: { ...cappuccinoX2, modsZar: 800 }, count: 2 })
    ).toEqual({ status: "apply", perVoucherZar: [4600, 4600], lineDiscountZar: 9200 });
  });
  it("3 vouchers on quantity 2 → VALIDATION", () => {
    expect(planLineVouchers({ session: UNTRACKED, kind: KIND, line: cappuccinoX2, count: 3 }))
      .toMatchObject({ status: "refused", code: "VALIDATION" });
  });
  it("a line already carrying the free cup's R38 → VALIDATION (L41)", () => {
    expect(planLineVouchers({ session: UNTRACKED, kind: KIND, line: { ...cappuccinoX2, discountZar: 3800 }, count: 1 }))
      .toMatchObject({ status: "refused", code: "VALIDATION" });
  });
  it("no session → NO_SESSION; weekday → VOUCHER_NOT_IN_MODE", () => {
    expect(planLineVouchers({ session: null, kind: KIND, line: cappuccinoX2, count: 1 }))
      .toMatchObject({ status: "refused", code: "NO_SESSION" });
    expect(planLineVouchers({ session: { mode: "weekday", voucherKindsActive: [] }, kind: KIND, line: cappuccinoX2, count: 1 }))
      .toMatchObject({ status: "refused", code: "VOUCHER_NOT_IN_MODE" });
  });
});
