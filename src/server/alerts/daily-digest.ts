// DEC-23 (Mia, 9 Nov 2026): the §9.6.3 daily digest is an Admin-home card,
// computed when the page renders — not a scheduled job and not a task table.
// Pure rules only; the reads are in src/server/actions/admin-digest.ts.
//
// What FAVO can compute today: the voucher line (§9.6.3 "one line, not two":
// the slip-count variance and T11's per-session count, REQ-159), the total
// live fund balance against the ~R5,000 line (R24), and the last daily close.
// Storage and queue-stream disconnects have no measurement yet, so they are
// "not measured yet" — never zero.

/** §9.6.3 / R24 / §6.10.6: "Above ~R5,000 across all active funds". Integer cents. */
export const FUND_LIABILITY_LINE_ZAR = 500_000;

/** "Above" the line: R5,000.00 itself is not above it. */
export function liabilityAboveLine(totalZar: number): boolean {
  return totalZar > FUND_LIABILITY_LINE_ZAR;
}

/** T11, config.voucher_expected_max_per_session (§12.2): default 25. Alert only, never a block. */
export const VOUCHER_EXPECTED_MAX_KEY = "voucher_expected_max_per_session";
export const DEFAULT_VOUCHER_EXPECTED_MAX = 25;

/** REQ-159: a session has crossed T11 once it records more vouchers than the expected maximum. */
export function crossesExpectedMax(recorded: number, expectedMax: number): boolean {
  return recorded > expectedMax;
}

export type VoucherSessionInput = {
  opensAt: string;
  /** opening_sessions.voucher_redemptions_recorded */
  recorded: number;
  /** opening_sessions.voucher_slips_counted — null means nobody counted (L43). */
  slipsCounted: number | null;
  /** Σ discount_zar of the session's live (unreversed) redemptions, integer cents. */
  liveZar: number;
};

export type VoucherSessionLine = {
  opensAt: string;
  recorded: number;
  slipsCounted: number | null;
  /** counted − recorded; null when nobody counted. */
  slipVariance: number | null;
  /** null when T11 is not a valid setting. */
  aboveExpected: boolean | null;
};

export type VoucherDigest = {
  voucherCount: number;
  voucherZar: number;
  expectedMax: number | null;
  sessions: VoucherSessionLine[];
  /** True when any session has a slip variance or crossed T11 — the line needs a look. */
  flagged: boolean;
};

export function voucherDigest(sessions: VoucherSessionInput[], expectedMax: number | null): VoucherDigest {
  const lines = sessions.map((s) => ({
    opensAt: s.opensAt,
    recorded: s.recorded,
    slipsCounted: s.slipsCounted,
    slipVariance: s.slipsCounted === null ? null : s.slipsCounted - s.recorded,
    aboveExpected: expectedMax === null ? null : crossesExpectedMax(s.recorded, expectedMax),
  }));
  return {
    voucherCount: sessions.reduce((n, s) => n + s.recorded, 0),
    voucherZar: sessions.reduce((n, s) => n + s.liveZar, 0),
    expectedMax,
    sessions: lines,
    flagged: lines.some((l) => (l.slipVariance !== null && l.slipVariance !== 0) || l.aboveExpected === true),
  };
}

export type LastClose = {
  revenueDay: string;
  reconciliationStatus: "payments_matched" | "blocked";
  blockedReason: string | null;
  writtenOffCount: number;
  writtenOffZar: number;
  wasCatchUp: boolean;
};

export type AdminDigest = {
  /** The revenue day the digest reports on: yesterday, SAST. */
  day: string;
  vouchers: VoucherDigest;
  /** Σ live balance across active funds, integer cents (open card top-ups count zero, REQ-173). */
  fundLiabilityZar: number;
  fundLiabilityAboveLine: boolean;
  activeFundCount: number;
  /** The most recent daily_closes row, or null when no day has ever been closed. */
  lastClose: LastClose | null;
  /** True when yesterday has no close record yet. */
  yesterdayUnclosed: boolean;
  /**
   * §9.6.2 job 6 / §6.8.3: the latest Yoco export import for `day` (T10), or
   * null when none has been uploaded — that day's fees stay UNAVAILABLE.
   */
  yocoImport: { unmatchedRows: number; totalRows: number; toCheck: number } | null;
};
