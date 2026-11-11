// S7a ("'free' wins" — deferred mode is inert under a free posture), T3 step 2
// (createOrder(payment_mode='yoco_deferred') while deferred), REQ-133 (any
// §07 figure grouping by mode splits yoco_deferred by settled_at and
// written_off_at), §6.7 / REQ-166 (the close and the admin unpaid list share
// one definition of unpaid; a settled order is never on it). Integer cents.

import { describe, it, expect } from "vitest";
import { newOrderPaymentMode } from "@/server/deferred/order-mode";
import { rollupDay, type DayOrder } from "@/server/cogs/day-rollup";
import { isUnpaid, type OrderSettlementFacts } from "@/server/close/write-offs";
import { toUnpaidRows } from "@/server/deferred/unpaid";

describe("payment_mode of a new order (S7a, T3 step 2)", () => {
  it("'free' wins over deferred: a weekday order, or R0, is never created deferred", () => {
    expect(newOrderPaymentMode({ weekdayFree: true, totalZar: 2000, tillDeferred: true })).toBe("free");
    expect(newOrderPaymentMode({ weekdayFree: false, totalZar: 0, tillDeferred: true })).toBe("free");
  });
  it("a charged order while the till is deferred is 'yoco_deferred'; otherwise 'yoco'", () => {
    expect(newOrderPaymentMode({ weekdayFree: false, totalZar: 3000, tillDeferred: true })).toBe("yoco_deferred");
    expect(newOrderPaymentMode({ weekdayFree: false, totalZar: 3000, tillDeferred: false })).toBe("yoco");
  });
});

describe("REQ-133 — yoco_deferred split by settled_at and written_off_at", () => {
  const base: DayOrder = {
    netChargedZar: 3000, paymentMode: "yoco_deferred", writtenOff: false, payment: null,
    cogs: { cogsZar: 1352, absentItemIds: [], estimated: true }, lines: [{ quantity: 1, shots: 3 }],
  };
  it("open R30.00 · settled R20.00 · written off R25.00; card gross still carries all three", () => {
    const d = rollupDay([
      base,
      { ...base, netChargedZar: 2000, settled: true },
      { ...base, netChargedZar: 2500, writtenOff: true },
      { ...base, paymentMode: "yoco", netChargedZar: 4000, payment: { feeZar: 106, tipZar: 0 } },
    ]);
    expect(d.deferred).toEqual({ openZar: 3000, settledZar: 2000, writtenOffZar: 2500 });
    expect(d.cardGrossZar).toBe(3000 + 2000 + 2500 + 4000);
    expect(d.writtenOffZar).toBe(2500);
  });
  it("a day with no deferred order splits to zeroes", () => {
    expect(rollupDay([{ ...base, paymentMode: "yoco" }]).deferred).toEqual({ openZar: 0, settledZar: 0, writtenOffZar: 0 });
  });
});

describe("one definition of unpaid — a settled deferred order is not swept and not listed", () => {
  // A Saturday: neither the weekday nor the Sunday (DEC-21) exemption applies.
  const facts: OrderSettlementFacts = {
    id: "o-deferred-1234", staffId: "staff_nkuli", totalZar: 3000, placedAt: new Date("2026-11-07T08:00:00Z"),
    revenueDay: "2026-11-07", state: "ready", paymentMode: "yoco_deferred", writtenOff: false,
    hasSuccessfulPayment: false, hasFundSpend: false, latestAttempt: null,
  };
  it("open → unpaid; settled_at set (path B, no payment row) → not unpaid", () => {
    expect(isUnpaid(facts)).toBe(true);
    expect(isUnpaid({ ...facts, settled: true })).toBe(false);
  });
  it("the admin list names the order, its age in minutes and its value, oldest first", () => {
    const now = new Date("2026-11-07T09:30:00Z");
    const rows = toUnpaidRows(
      [
        { id: "o-later-99999", placedAt: new Date("2026-11-07T09:00:00Z"), revenueDay: "2026-11-07", totalZar: 2000, paymentMode: "yoco" },
        { id: facts.id, placedAt: facts.placedAt, revenueDay: facts.revenueDay, totalZar: 3000, paymentMode: "yoco_deferred" },
      ],
      now
    );
    expect(rows).toEqual([
      { orderId: "o-deferred-1234", orderRef: "o-deferr", revenueDay: "2026-11-07", placedAt: "2026-11-07T08:00:00.000Z",
        ageMinutes: 90, valueZar: 3000, paymentMode: "yoco_deferred" },
      { orderId: "o-later-99999", orderRef: "o-later-", revenueDay: "2026-11-07", placedAt: "2026-11-07T09:00:00.000Z",
        ageMinutes: 30, valueZar: 2000, paymentMode: "yoco" },
    ]);
  });
});
