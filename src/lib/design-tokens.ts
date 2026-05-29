// Design tokens — owner: Nikao (task N1)
// These map to CSS variables defined in src/app/globals.css via Tailwind v4 @theme.
// Import this file to reference token names in TypeScript; use CSS vars in Tailwind classes.

export const colors = {
  espresso: "var(--color-espresso)",   // Primary dark / strong text
  cream: "var(--color-cream)",         // Surface / background
  copper: "var(--color-copper)",       // Accent / CTA
  oat: "var(--color-oat)",             // Subtle surface
  charcoal: "var(--color-charcoal)",   // Body text

  // Semantic aliases
  surface: "var(--color-surface)",
  elevated: "var(--color-elevated)",
  textStrong: "var(--color-text-strong)",
  textMuted: "var(--color-text-muted)",
  borderSubtle: "var(--color-border-subtle)",

  // Status
  success: "var(--color-success)",
  warning: "var(--color-warning)",
  error: "var(--color-error)",
  info: "var(--color-info)",
} as const;

export const typeScale = {
  xs: "var(--text-xs)",
  sm: "var(--text-sm)",
  base: "var(--text-base)",
  lg: "var(--text-lg)",
  xl: "var(--text-xl)",
  "2xl": "var(--text-2xl)",
  "3xl": "var(--text-3xl)",
  display: "var(--text-display)",
} as const;

export const spacing = {
  touchTarget: "44px",   // Minimum touch target size (POS)
  adminTouch: "40px",    // Minimum touch target size (admin)
} as const;

export type ColorToken = keyof typeof colors;
export type TypeToken = keyof typeof typeScale;
