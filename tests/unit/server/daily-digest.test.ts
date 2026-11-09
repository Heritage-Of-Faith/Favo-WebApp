// DEC-23 / PRD §9.6.3 daily digest. Literal values from the PRD:
//   "Total live fund balance — Above ~R5,000 across all active funds" (R24)
//   T11 voucher_expected_max_per_session, default 25; REQ-159 "a session
//   crossing voucher_expected_max_per_session … appears on the Admin's daily digest"
//   "Vouchers — one line, not two": slip-count variance and T11 together.

import { describe, it, expect } from "vitest";
import {
  DEFAULT_VOUCHER_EXPECTED_MAX,
  FUND_LIABILITY_LINE_ZAR,
  crossesExpectedMax,
  liabilityAboveLine,
  voucherDigest,
} from "@/server/alerts/daily-digest";

describe("fund liability line — R5,000", () => {
  it("the line is R5,000.00 in integer cents", () => expect(FUND_LIABILITY_LINE_ZAR).toBe(500_000));
  it("R4,999.99 is not above the line", () => expect(liabilityAboveLine(499_999)).toBe(false));
  it("R5,000.00 is not above the line (\"above\")", () => expect(liabilityAboveLine(500_000)).toBe(false));
  it("R5,000.01 is above the line", () => expect(liabilityAboveLine(500_001)).toBe(true));
  it("R0 is not above the line", () => expect(liabilityAboveLine(0)).toBe(false));
});

describe("T11 — 25 vouchers per session (REQ-159)", () => {
  it("the default is 25", () => expect(DEFAULT_VOUCHER_EXPECTED_MAX).toBe(25));
  it("25 recorded has not crossed", () => expect(crossesExpectedMax(25, 25)).toBe(false));
  it("26 recorded has crossed", () => expect(crossesExpectedMax(26, 25)).toBe(true));
});

describe("voucherDigest — one line per day", () => {
  it("sums count and value across sessions and flags a slip variance and a T11 crossing", () => {
    const d = voucherDigest(
      [
        { opensAt: "07:30", recorded: 3, slipsCounted: 3, liveZar: 6000 },
        { opensAt: "18:30", recorded: 26, slipsCounted: 24, liveZar: 59_500 },
      ],
      25
    );
    expect(d.voucherCount).toBe(29);
    expect(d.voucherZar).toBe(65_500); // R655.00
    expect(d.sessions).toEqual([
      { opensAt: "07:30", recorded: 3, slipsCounted: 3, slipVariance: 0, aboveExpected: false },
      { opensAt: "18:30", recorded: 26, slipsCounted: 24, slipVariance: -2, aboveExpected: true },
    ]);
    expect(d.flagged).toBe(true);
  });

  it("matching slips under T11 are not flagged; an uncounted tin is null, never zero", () => {
    const d = voucherDigest([{ opensAt: "07:30", recorded: 5, slipsCounted: null, liveZar: 10_000 }], 25);
    expect(d.sessions[0].slipVariance).toBeNull();
    expect(d.flagged).toBe(false);
  });

  it("an invalid T11 reads null for the crossing, not false", () => {
    const d = voucherDigest([{ opensAt: "07:30", recorded: 30, slipsCounted: 30, liveZar: 60_000 }], null);
    expect(d.sessions[0].aboveExpected).toBeNull();
  });

  it("no session that day: zero vouchers, nothing flagged", () => {
    expect(voucherDigest([], 25)).toEqual({ voucherCount: 0, voucherZar: 0, expectedMax: 25, sessions: [], flagged: false });
  });
});
