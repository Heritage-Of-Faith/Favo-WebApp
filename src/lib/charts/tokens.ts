// Chart palette + geometry tokens — task N7.
// Colours reference FAVO's semantic CSS custom properties so charts stay in
// sync with the design system (and any future dark mode) automatically.
// Docs: docs/DESIGN.md → data viz

/** Semantic colour roles for chart series, as CSS var references. */
export const chartColor = {
  /** Primary brand series (revenue, totals). */
  brand: "var(--color-dark-teal)",
  /** Accent series (highlights, current value). */
  accent: "var(--color-accent)",
  /** Positive / profit. */
  positive: "var(--color-success)",
  /** Neutral / secondary series. */
  neutral: "var(--color-cool-steel)",
  /** Warning / elevated. */
  warning: "var(--color-warning)",
  /** Negative / loss. */
  negative: "var(--color-error)",
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
  "var(--color-accent)",
  "var(--color-cool-steel)",
  "var(--color-warning)",
  "var(--color-coffee-bean)",
  "var(--color-info)",
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
