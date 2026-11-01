// AT-204 Wave 2 — the draft order's per-line vouchers and L37's
// one-line-per-distinct-configuration rule (REQ-147, REQ-148, §6.9.3).

import { describe, it, expect, beforeEach } from "vitest";
import { useDraftOrder, lineKey } from "@/store/draftOrder";
import {
  draftLineNetZar, draftNetZar, nextVoucherCount, voucherContextFor, NO_VOUCHERS,
  draftLineGrossZar, draftLineTakesVoucher, draftUnitZar,
} from "@/lib/pos-vouchers";

// §6.9.2a's own example prices: a R20 cappuccino, a R20 hot chocolate.
const capp = { menuItemId: "mi_capp", menuItemName: "Cappuccino", unitPriceZar: 2000, modifications: [] };
const macadamia = { id: "mod_mac", name: "Macadamia", priceDeltaZar: 500 };
const s = () => useDraftOrder.getState();

beforeEach(() => s().reset());

describe("REQ-148 / L37 — one line per distinct configuration", () => {
  it("the same item with different modifications opens a new line", () => {
    s().addItem(capp);
    s().addItem({ ...capp, modifications: [macadamia] });
    expect(s().items).toHaveLength(2);
  });

  it("the same item with a matching configuration steps that line up and no second line appears", () => {
    s().addItem(capp);
    s().addItem({ ...capp, modifications: [macadamia] });
    s().addItem(capp);
    expect(s().items).toHaveLength(2);
    expect(s().items.find((i) => i.modifications.length === 0)?.quantity).toBe(2);
  });
});

describe("per-line voucherCount", () => {
  it("setVoucherCount is clamped to 0..quantity", () => {
    s().addItem({ ...capp, quantity: 3 });
    const key = lineKey(capp);
    s().setVoucherCount(key, 2);
    expect(s().items[0].voucherCount).toBe(2);
    s().setVoucherCount(key, 9);
    expect(s().items[0].voucherCount).toBe(3);
    s().setVoucherCount(key, -1);
    expect(s().items[0].voucherCount).toBe(0);
  });

  it("stepping the quantity down below the voucher count lowers the count with it", () => {
    s().addItem({ ...capp, quantity: 3 });
    s().setVoucherCount(lineKey(capp), 3);
    s().updateQuantity(lineKey(capp), 2);
    expect(s().items[0].voucherCount).toBe(2);
  });

  it("vouchers attach to one configuration only (§6.2.4a)", () => {
    s().addItem(capp);
    s().addItem({ ...capp, modifications: [macadamia] });
    s().setVoucherCount(lineKey(capp), 1);
    const plain = s().items.find((i) => i.modifications.length === 0)!;
    const mac = s().items.find((i) => i.modifications.length === 1)!;
    expect(plain.voucherCount).toBe(1);
    expect(mac.voucherCount ?? 0).toBe(0);
  });
});

describe("draft display arithmetic (§6.9.2a: one voucher = one whole unit)", () => {
  it("2 of 3 R20 cappuccinos leaves R20.00 on the line", () => {
    expect(draftLineNetZar({ ...capp, quantity: 3, voucherCount: 2 })).toBe(2000);
  });

  it("a voucher covers the unit's modifications too: 1 of 1 macadamia cappuccino is R0.00", () => {
    expect(draftLineNetZar({ ...capp, modifications: [macadamia], quantity: 1, voucherCount: 1 })).toBe(0);
  });

  it("T10: vouchered hot chocolate beside a paid cappuccino owes R20.00", () => {
    const hot = { menuItemId: "mi_hot", menuItemName: "Hot Chocolate", unitPriceZar: 2000, modifications: [] };
    expect(draftNetZar([{ ...capp, quantity: 1 }, { ...hot, quantity: 1, voucherCount: 1 }])).toBe(2000);
  });

  it("one tap adds the next voucher; on a full line it removes them (the toggle)", () => {
    expect(nextVoucherCount({ quantity: 1, voucherCount: 0 })).toBe(1);
    expect(nextVoucherCount({ quantity: 1, voucherCount: 1 })).toBe(0);
    expect(nextVoucherCount({ quantity: 3, voucherCount: 2 })).toBe(3);
    expect(nextVoucherCount({ quantity: 3, voucherCount: 3 })).toBe(0);
  });
});

describe("AT-202 interim: a surcharge line takes no voucher; its surcharge stays owed", () => {
  // A R20 cappuccino at 3 shots on a Sunday: R10 surcharge per unit → R30.00.
  const triple = { ...capp, shots: 3, surchargeZar: 1000 };

  it("draftLineTakesVoucher: no on a surcharge line, yes on a 1- or 2-shot line", () => {
    expect(draftLineTakesVoucher(triple)).toBe(false);
    expect(draftLineTakesVoucher({ surchargeZar: 0 })).toBe(true); // 1 or 2 shots
    expect(draftLineTakesVoucher({ surchargeZar: undefined })).toBe(true); // no picker (absent = 0)
  });

  it("gross includes the surcharge per unit: a quantity-2 triple is R60.00", () => {
    expect(draftLineGrossZar({ ...triple, quantity: 2 })).toBe(6000);
  });

  it("a stray voucherCount on a surcharge line is never counted: the net stays R30.00", () => {
    expect(draftLineNetZar({ ...triple, quantity: 1, voucherCount: 1 })).toBe(3000);
    expect(draftNetZar([{ ...triple, quantity: 1, voucherCount: 1 }])).toBe(3000);
  });

  it("draftUnitZar is listed price + modifications only (a voucher never zeroes a surcharge)", () => {
    expect(draftUnitZar({ ...triple, quantity: 1 })).toBe(2000);
  });
});

describe("voucherContextFor — L48 / REQ-146", () => {
  it("no open session → no chip", () => {
    expect(voucherContextFor(null)).toEqual(NO_VOUCHERS);
  });
  it("weekday mode → no chip, whatever the kinds say", () => {
    expect(voucherContextFor({ mode: "weekday", voucherKindsActive: ["untracked_hot_drink"] }).available).toBe(false);
  });
  it("voucher_kinds_active empty → no chip", () => {
    expect(voucherContextFor({ mode: "sunday", voucherKindsActive: [] }).available).toBe(false);
  });
  it("an Untracked Church session → chip, kind untracked_hot_drink", () => {
    expect(voucherContextFor({ mode: "event", voucherKindsActive: ["untracked_hot_drink"] })).toEqual({
      available: true, kind: "untracked_hot_drink", kinds: ["untracked_hot_drink"],
    });
  });
});
