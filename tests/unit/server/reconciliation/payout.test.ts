// REQ-120 (§7.0.4, T10): "Given a Yoco payout · When it is reconciled · Then
// Σ (gross − fee) over the settled transactions equals the payout, per device,
// and a difference — including any tip the machine let through (DEC-17) — is
// an open T10 item." Pure: no DB.
//
// §7.0.2 processing_fee: "if ANY settled order in the period has fee_zar IS
// NULL, every fee-dependent figure renders as UNAVAILABLE, never as a number."

import { describe, it, expect } from "vitest";
import {
  clearedTipCountsByDevice,
  openPayoutCount,
  payoutCheck,
  payoutEntityId,
  payoutLine,
  parsePayoutEntityId,
  type SettledCardPayment,
} from "@/server/reconciliation/payout";

// The grounded Sunday 2026-08-16 (§7.0.3): gross R350.00, fees R9.27, net settled R340.73.
const GROSS = [2000, 2000, 2000, 2000, 2000, 4000, 2000, 4000, 4000, 2000, 2000, 5000, 2000];
const FEES = [53, 53, 53, 53, 53, 106, 53, 106, 106, 53, 53, 132, 53];

function grounded(device = "dev-khumo"): SettledCardPayment[] {
  return GROSS.map((g, i) => ({ paymentId: `p${i}`, deviceId: device, chargedAmountZar: g, feeZar: FEES[i] }));
}

describe("REQ-120: Σ (gross − fee) per device against the payout", () => {
  it("the fixture sums to the PRD's R350.00 gross and R9.27 fees", () => {
    expect(GROSS.reduce((a, b) => a + b, 0)).toBe(35000);
    expect(FEES.reduce((a, b) => a + b, 0)).toBe(927);
  });

  it("the grounded Sunday: a payout of R340.73 is OK", () => {
    expect(payoutCheck(34073, grounded(), "dev-khumo")).toEqual({
      state: "ok", deviceId: "dev-khumo", payoutZar: 34073, expectedZar: 34073, differenceZar: 0, count: 13,
    });
  });

  it("DEC-17: a R5.00 tip the machine let through is an open variance of R5.00, never booked", () => {
    expect(payoutCheck(34573, grounded(), "dev-khumo")).toEqual({
      state: "variance", deviceId: "dev-khumo", payoutZar: 34573, expectedZar: 34073, differenceZar: 500, count: 13,
    });
  });

  it("a payout short of the sum is a negative difference", () => {
    expect(payoutCheck(34000, grounded(), "dev-khumo")).toMatchObject({ state: "variance", differenceZar: -73 });
  });

  it("per device: another machine's payments are not counted", () => {
    const mixed = [...grounded(), { paymentId: "other", deviceId: "dev-2", chargedAmountZar: 9000, feeZar: 240 }];
    expect(payoutCheck(34073, mixed, "dev-khumo")).toMatchObject({ state: "ok", count: 13 });
    expect(payoutCheck(8760, mixed, "dev-2")).toMatchObject({ state: "ok", expectedZar: 8760, count: 1 });
  });

  it("UNAVAILABLE, naming the count, when any payment on the device has no fee yet — never a zero fee", () => {
    const ps = grounded();
    ps[0] = { ...ps[0], feeZar: null };
    ps[5] = { ...ps[5], feeZar: null };
    expect(payoutCheck(34073, ps, "dev-khumo")).toEqual({
      state: "unavailable", deviceId: "dev-khumo", payoutZar: 34073, missingFee: 2, missingCharged: 0, count: 13,
    });
  });

  it("UNAVAILABLE when a payment holds no charged amount (never falls back to the asked amount)", () => {
    const ps = grounded();
    ps[1] = { ...ps[1], chargedAmountZar: null };
    expect(payoutCheck(34073, ps, "dev-khumo")).toMatchObject({ state: "unavailable", missingFee: 0, missingCharged: 1 });
  });

  it("a missing fee on another device does not block this device", () => {
    const mixed = [...grounded(), { paymentId: "other", deviceId: "dev-2", chargedAmountZar: 9000, feeZar: null }];
    expect(payoutCheck(34073, mixed, "dev-khumo")).toMatchObject({ state: "ok" });
  });

  it("no settled payments on the device: the whole payout is the variance", () => {
    expect(payoutCheck(2000, [], "dev-khumo")).toEqual({
      state: "variance", deviceId: "dev-khumo", payoutZar: 2000, expectedZar: 0, differenceZar: 2000, count: 0,
    });
  });
});

// CHANGED (review, DEC-17 read strictly): no tip amount is stored anywhere, so a
// cleared tip can no longer "explain" an exact figure. A positive variance on a
// device with a cleared tip is flagged "may be a cleared tip" and STAYS OPEN;
// only an Admin's confirmPayoutVariance closes a line.
describe("cleared tips and the Admin's confirmation (DEC-17 × REQ-120)", () => {
  const variance = payoutCheck(34573, grounded(), "dev-khumo"); // +500
  const short = payoutCheck(34000, grounded(), "dev-khumo"); // −73
  const ok = payoutCheck(34073, grounded(), "dev-khumo");
  const T0 = "2026-08-17T07:00:00.000Z";
  const T1 = "2026-08-17T08:00:00.000Z";
  const confirm = { reason: "Two cleared tips, per the slips", payoutZar: 34573, expectedZar: 34073, at: T1 };

  it("a positive variance on a device with ≥ 1 cleared tip may be a cleared tip — and stays open", () => {
    const line = payoutLine(T0, variance, 1, null);
    expect(line).toEqual({ recordedAt: T0, check: variance, clearedTipCount: 1, mayBeClearedTip: true, confirmation: null, open: true });
    expect(openPayoutCount([line])).toBe(1);
  });

  it("a negative variance (the opposite of a tip) or no cleared tip is not flagged as a possible tip", () => {
    expect(payoutLine(T0, short, 2, null).mayBeClearedTip).toBe(false);
    expect(payoutLine(T0, variance, 0, null).mayBeClearedTip).toBe(false);
  });

  it("an Admin's confirmation of exactly these figures, after the payout was entered, closes the line", () => {
    const line = payoutLine(T0, variance, 1, confirm);
    expect(line).toMatchObject({ confirmation: confirm, open: false });
    expect(openPayoutCount([line])).toBe(0);
  });

  it("a stale confirmation (the figures moved, or a newer payout was entered) does not close it", () => {
    expect(payoutLine(T0, variance, 1, { ...confirm, expectedZar: 34000 })).toMatchObject({ confirmation: null, open: true });
    expect(payoutLine(T0, variance, 1, { ...confirm, payoutZar: 34600 })).toMatchObject({ confirmation: null, open: true });
    expect(payoutLine(T1, variance, 1, { ...confirm, at: T0 })).toMatchObject({ confirmation: null, open: true });
  });

  it("OK is never open; UNAVAILABLE is open and cannot be confirmed closed", () => {
    expect(payoutLine(T0, ok, 0, null).open).toBe(false);
    const ps = grounded();
    ps[0] = { ...ps[0], feeZar: null };
    const un = payoutCheck(34573, ps, "dev-khumo");
    expect(payoutLine(T0, un, 1, confirm)).toMatchObject({ confirmation: null, open: true, mayBeClearedTip: false });
  });

  it("cleared tips are COUNTED per device (no amounts), only for payments settled that day", () => {
    const settled = [...grounded(), { paymentId: "x", deviceId: "dev-2", chargedAmountZar: 2000, feeZar: 53 }];
    const counts = clearedTipCountsByDevice(["p0", "p1", "x", "not-today", "p0"], settled);
    expect(counts.get("dev-khumo")).toBe(2);
    expect(counts.get("dev-2")).toBe(1);
  });
});

describe("the audit entity id is day + device", () => {
  it("round-trips, and a device id may itself hold a colon", () => {
    expect(payoutEntityId("2026-08-16", "dev-khumo")).toBe("2026-08-16:dev-khumo");
    expect(parsePayoutEntityId("2026-08-16:dev:1")).toEqual({ revenueDay: "2026-08-16", deviceId: "dev:1" });
    expect(parsePayoutEntityId("nonsense")).toBeNull();
  });
});
