// Variance band classification — task N8 (single source of truth for T01).
// Pure, dependency-free, importable from both client and server code.
// Docs: docs/BUSINESS_RULES.md T01 (variance bands)

export type VarianceBand = "ok" | "investigate" | "critical";

/** T01 band boundaries (absolute variance %). */
export const VARIANCE_INVESTIGATE_PCT = 5;
export const VARIANCE_CRITICAL_PCT = 10;

/**
 * Classifies an absolute variance percentage into a display band per T01.
 *
 *   0–5%   → ok          (within acceptable shrinkage)
 *   5–10%  → investigate  (elevated — admin should review)
 *   10%+   → critical     (significant loss or counting error)
 *
 * `pct` is the absolute percentage (always ≥ 0).
 * Exact boundary of 5% is "investigate" (≥ 5, < 10); 10% is "critical".
 */
export function varianceBand(pct: number): VarianceBand {
  const abs = Math.abs(pct);
  if (abs < VARIANCE_INVESTIGATE_PCT) return "ok";
  if (abs < VARIANCE_CRITICAL_PCT) return "investigate";
  return "critical";
}

/** Human-readable label for a variance band. */
export function varianceBandLabel(band: VarianceBand): string {
  switch (band) {
    case "ok":
      return "Within tolerance";
    case "investigate":
      return "Investigate";
    case "critical":
      return "Critical";
  }
}
