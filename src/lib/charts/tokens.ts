// Chart palette + geometry tokens — task N7.
// Colours reference FAVO's semantic CSS custom properties so charts stay in
// sync with the design system (and any future dark mode) automatically.
// Docs: docs/DESIGN.md → data viz

/** Semantic colour roles for chart series, as CSS var references. */
// FAVO brand palette only — no green/gold/red/blue status hues anywhere.
export const chartColor = {
  /** Primary brand series (revenue, totals). */
  brand: "var(--color-dark-teal)",
  /** Accent series (highlights, current value). */
  accent: "var(--color-accent)",
  /** Positive / profit — coffee bean (distinct from the teal brand series). */
  positive: "var(--color-coffee-bean)",
  /** Neutral / secondary series. */
  neutral: "var(--color-cool-steel)",
  /** Warning / elevated. */
  warning: "var(--color-crimson-carrot)",
  /** Negative / loss. */
  negative: "var(--color-crimson-carrot)",
  /** Grid lines and axes. */
  grid: "var(--color-border-subtle)",
  /** Muted text for labels. */
  label: "var(--color-text-muted)",
} as const;

export type ChartColorRole = keyof typeof chartColor;

/**
 * Ordered palette for multi-series charts (e.g. donut segments).
 * Chosen for contrast against FAVO's paper background.
 */
export const chartSeries: string[] = [
  "var(--color-dark-teal)",
  "var(--color-crimson-carrot)",
  "var(--color-cool-steel)",
  "var(--color-coffee-bean)",
  "var(--color-dark-teal-deep)",
  "var(--color-coffee-bean-deep)",
];

/** Default geometry shared across the bespoke SVG charts. */
export const chartGeometry = {
  /** Stroke width for line/area paths. */
  strokeWidth: 2,
  /** Corner radius for bars (FAVO prefers crisp 2px). */
  barRadius: 2,
  /** Dot radius for highlighted data points. */
  dotRadius: 3,
} as const;
