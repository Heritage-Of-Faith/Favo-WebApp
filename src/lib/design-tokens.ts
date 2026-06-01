// Design tokens — owner: Nikao
// Mirrors the CSS variables defined in src/app/globals.css via Tailwind v4 @theme.
// Use these in TypeScript; use the CSS vars directly in Tailwind utility classes.

export const colors = {
  // Brand palette
  porcelain:       "var(--color-porcelain)",       // #F7F6F2 — light neutral, backgrounds
  coolSteel:       "var(--color-cool-steel)",       // #81A4B1 — secondary UI, support text
  crimsonCarrot:   "var(--color-crimson-carrot)",   // #F5560C — accent/CTA, max one per layout
  coffeeBean:      "var(--color-coffee-bean)",      // #1C0501 — warm anchor, body text
  darkTeal:        "var(--color-dark-teal)",        // #054D61 — cool anchor, nav, hero

  // Derived
  paper:           "var(--color-paper)",            // #FBFAF6 — long-form bg
  porcelainSoft:   "var(--color-porcelain-soft)",   // #E5E4DE — hairlines / dividers
  darkTealDeep:    "var(--color-dark-teal-deep)",   // hover/press on dark teal
  coffeeBeanDeep:  "var(--color-coffee-bean-deep)", // hover/press on coffee bean

  // Semantic
  surface:         "var(--color-surface)",
  elevated:        "var(--color-elevated)",
  textStrong:      "var(--color-text-strong)",
  textMuted:       "var(--color-text-muted)",
  textFaint:       "var(--color-text-faint)",
  textInverse:     "var(--color-text-inverse)",
  borderSubtle:    "var(--color-border-subtle)",
  accent:          "var(--color-accent)",

  // Status
  success: "var(--color-success)",
  warning: "var(--color-warning)",
  error:   "var(--color-error)",
  info:    "var(--color-info)",
} as const;

export const typeScale = {
  caption: "var(--text-caption)", // 11px
  small:   "var(--text-small)",   // 13px
  base:    "var(--text-base)",    // 16px
  sub:     "var(--text-sub)",     // 18px
  h3:      "var(--text-h3)",      // 22px
  h2:      "var(--text-h2)",      // clamp 28–56px
  h1:      "var(--text-h1)",      // clamp 40–88px
  hero:    "var(--text-hero)",    // clamp 56–144px
} as const;

export const spacing = {
  xs:  "var(--spacing-xs)",   // 4px
  s:   "var(--spacing-s)",    // 8px
  m:   "var(--spacing-m)",    // 16px
  l:   "var(--spacing-l)",    // 24px
  xl:  "var(--spacing-xl)",   // 40px
  xxl: "var(--spacing-xxl)",  // 64px
  touchTarget: "44px",        // POS minimum touch target
  adminTouch:  "40px",        // admin minimum touch target
} as const;

export const radii = {
  none: "var(--radius-none)", // 0px — default, crisp corners
  card: "var(--radius-card)", // 2px
  btn:  "var(--radius-btn)",  // 4px
  pill: "var(--radius-pill)", // 999px — tags/badges only
} as const;

export const motion = {
  easeOut: "var(--ease-out)",
  easeIn:  "var(--ease-in)",
  fast:    "var(--dur-fast)", // 120ms
  base:    "var(--dur-base)", // 220ms
  slow:    "var(--dur-slow)", // 420ms
} as const;

export type ColorToken   = keyof typeof colors;
export type TypeToken    = keyof typeof typeScale;
export type SpacingToken = keyof typeof spacing;
export type RadiusToken  = keyof typeof radii;
