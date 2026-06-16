// Bean freshness classification — task N8 (T02).
// Pure, dependency-free. Used by the POS bean-lot indicator and admin lot views.
// Docs: docs/BUSINESS_RULES.md T02 (roast freshness)

export type Freshness = "fresh" | "ageing" | "stale";

/** T02 boundaries (days since roast). */
export const FRESH_MAX_DAYS = 7;
export const AGEING_MAX_DAYS = 14;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Whole days elapsed between a roast date and a reference instant (default now).
 * Returns 0 for future roast dates (clock skew / data entry slips).
 */
export function daysSinceRoast(
  roastDate: Date | string,
  now: Date = new Date()
): number {
  const roast = typeof roastDate === "string" ? new Date(roastDate) : roastDate;
  if (Number.isNaN(roast.getTime())) return 0;
  const diffDays = Math.floor((now.getTime() - roast.getTime()) / MS_PER_DAY);
  return Math.max(0, diffDays);
}

/**
 * Classifies roast age per T02:
 *   0–7 days   → fresh
 *   8–14 days  → ageing
 *   15+ days   → stale  (freshness warning fires)
 *
 * A lot 15 days post-roast is "stale"; 14 days is still "ageing".
 */
export function freshness(
  roastDate: Date | string,
  now: Date = new Date()
): Freshness {
  const days = daysSinceRoast(roastDate, now);
  if (days <= FRESH_MAX_DAYS) return "fresh";
  if (days <= AGEING_MAX_DAYS) return "ageing";
  return "stale";
}

/** Human-readable label for a freshness band. */
export function freshnessLabel(f: Freshness): string {
  switch (f) {
    case "fresh":
      return "Fresh";
    case "ageing":
      return "Ageing";
    case "stale":
      return "Past peak";
  }
}
