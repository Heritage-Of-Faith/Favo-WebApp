// Inventory variance helpers — task G11
// Pure functions for stock-take variance computation and band classification.
// All three are unit-testable without a DB connection.
//
// Docs: docs/BUSINESS_RULES.md T01 (variance bands)

// ─── Types ────────────────────────────────────────────────────────────────────

export type VarianceBand = "ok" | "investigate" | "critical";

// ─── varianceBand ─────────────────────────────────────────────────────────────

/**
 * Classifies an absolute variance percentage into a display band per T01.
 *
 * T01 defaults:
 *   0–5%   → ok          (within acceptable shrinkage)
 *   5–10%  → investigate  (elevated — admin should review)
 *   10%+   → critical     (significant loss or counting error)
 *
 * `pct` is the absolute percentage (always ≥ 0).
 * Exact boundary of 5% is "investigate" (≥ 5, < 10).
 */
export function varianceBand(pct: number): VarianceBand {
  if (pct < 5) return "ok";
  if (pct < 10) return "investigate";
  return "critical";
}

// ─── computeLinePct ───────────────────────────────────────────────────────────

/**
 * Returns the absolute variance percentage for a single stock-take line.
 * Returns 0 when expected is 0 (avoids divide-by-zero; lot with no history
 * has 0 expected and 0 counted = 0% variance).
 *
 * pct = |counted − expected| / max(expected, 1) × 100
 */
export function computeLinePct(expected: number, counted: number): number {
  if (expected <= 0) return counted === 0 ? 0 : 100; // 100% discrepancy
  return (Math.abs(counted - expected) / expected) * 100;
}

// ─── computeWeightedVariancePct ───────────────────────────────────────────────

/**
 * Computes a value-weighted overall variance percentage across all lines.
 * Weight = expected (proxy for lot size when unit_cost is unknown / estimated).
 *
 * Returns 0 when total expected is 0 (all lots empty).
 * Result is rounded to the nearest integer for storage in stock_takes.variance_pct.
 */
export function computeWeightedVariancePct(
  lines: { expected: number; counted: number }[]
): number {
  if (lines.length === 0) return 0;
  const totalExpected = lines.reduce((s, l) => s + Math.max(l.expected, 0), 0);
  if (totalExpected === 0) return 0;

  const weightedSum = lines.reduce((s, l) => {
    const linePct = computeLinePct(l.expected, l.counted);
    return s + linePct * Math.max(l.expected, 0);
  }, 0);

  return Math.round(weightedSum / totalExpected);
}
