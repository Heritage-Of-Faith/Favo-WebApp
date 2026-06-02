# Design

## Token source
All tokens live in `src/app/globals.css` inside `@theme` (Tailwind v4 CSS-first).
TypeScript references live in `src/lib/design-tokens.ts` — it wraps the CSS vars, never duplicates hex values.
**Never hardcode a hex value, font name, or px size outside these two files.**

## Brand palette

| Token | CSS var | Hex | Role |
|---|---|---|---|
| porcelain | `--color-porcelain` | `#F7F6F2` | Light neutral, backgrounds |
| cool-steel | `--color-cool-steel` | `#81A4B1` | Secondary UI, support text |
| crimson-carrot | `--color-crimson-carrot` | `#F5560C` | Accent / CTA — **max one per layout** |
| coffee-bean | `--color-coffee-bean` | `#1C0501` | Warm anchor, body text, near-black |
| dark-teal | `--color-dark-teal` | `#054D61` | Cool anchor, nav, hero backgrounds |

**Rules:**
- Never pair Coffee Bean + Dark Teal as text/background on the same surface.
- Crimson Carrot is scarcity = power. One punch per layout, maximum.
- No gradients. No glassmorphism. No drop shadows except `--shadow-1` on sticky nav.

## Semantic tokens (use these in components, not the brand tokens directly)

| Token | Use |
|---|---|
| `--color-surface` | Page background |
| `--color-elevated` | Cards, modals |
| `--color-text-strong` | Primary headings and body |
| `--color-text-muted` | Secondary / support text |
| `--color-text-faint` | Placeholder, disabled |
| `--color-text-inverse` | Type on dark backgrounds |
| `--color-border-subtle` | Hairline dividers |
| `--color-accent` | CTA buttons, links, focus rings |

## Type families

- **Display: Barlow Condensed** — weights 300 / 700 / 900. Always `uppercase` with wide tracking. Used for all headings.
- **Body / UI: DM Sans** — weights 300 / 400 / 600 / 700. Body copy, labels, buttons, captions.
- Loaded via Google Fonts in `globals.css`. No self-hosting needed.

## Semantic type classes (use these, not arbitrary font/size utilities)

| Class | Use |
|---|---|
| `.favo-hero` | Full-bleed hero headline (clamp 56–144px) |
| `.favo-h1` | Page title (clamp 40–88px) |
| `.favo-h2` | Section heading (clamp 28–56px) |
| `.favo-h3` | Card / sub-section heading (22px) |
| `.favo-subhead` | DM Sans 600, 18px |
| `.favo-body` | Default body copy |
| `.favo-small` | Secondary body (13px) |
| `.favo-label` / `.favo-caption` | 11px uppercase Cool Steel — eyebrows, tags |
| `.favo-cta` | Button / link label — 13px uppercase Crimson Carrot |

## Spacing (4px base)

| Token | Value | Use |
|---|---|---|
| `--spacing-xs` | 4px | Tight gaps |
| `--spacing-s` | 8px | Icon gaps, inline |
| `--spacing-m` | 16px | Component padding |
| `--spacing-l` | 24px | Card padding |
| `--spacing-xl` | 40px | Section internal |
| `--spacing-xxl` | 64px | Between major sections |

## Radii — FAVO prefers crisp corners

| Token | Value | Use |
|---|---|---|
| `--radius-none` | 0px | Default |
| `--radius-card` | 2px | Cards |
| `--radius-btn` | 4px | Buttons, inputs |
| `--radius-pill` | 999px | Tags, status chips only |

Never use 8px+ rounded corners on this brand.

## Assets

Brand assets live in `public/brand/`. Structure:
```
public/brand/
  logos/
    logo-wordmark.svg   ← primary mark
    logo-monogram.svg   ← circular F mark, favicons, cups
  photography/          ← editorial only, full-bleed at hero scale
  icons/                ← brand-specific SVGs not in Lucide
```

**Icon set:** Lucide (already installed). Stroke only, 2.25px, current-color. Sizes: 16px inline · 20px button · 24px nav. Never exceed 24px on screen.

Use the Next.js `<Image>` component for all photography. Always set `sizes` to match your CSS layout. Use `priority` only on the above-the-fold hero image.

## Dark mode / runtime theming — critical pattern

Tailwind v4 `@theme` variables **cannot** be overridden inside `.dark {}` or any selector/media query. A naive `.dark { --color-surface: ... }` inside `@theme` silently breaks. Use this pattern instead:

```css
/* In globals.css — plain CSS vars toggled at runtime */
:root      { --surface: #FBFAF6; }
:root.dark { --surface: #1C0501; }

/* @theme inline resolves the reference so Tailwind utilities pick up the toggled value */
@theme inline {
  --color-surface: var(--surface);
}
```

Do not implement dark mode any other way. Source: [Tailwind v4 theme docs](https://tailwindcss.com/docs/theme).

## Component rules

- Use shadcn/ui primitives from `src/components/ui/*`. Do not hand-roll primitives.
- Domain components live in `src/components/{pos,admin,landing,customer,shared}/`.
- One component per file. Default-export the component, named-export its `Props` type.
- Tailwind classes only. No CSS modules. No inline styles except dynamic dimensions.
- Touch targets: ≥ 44×44 px on POS · ≥ 40×40 px on admin.
- All interactive elements have a visible focus ring (2px Crimson Carrot outline).
- Forms: `<label>` + `htmlFor`. WCAG AA contrast — use semantic tokens, never hand-pick colours.
- Every reusable component has at least one Storybook story covering default + edge states.

## Surface ownership

| Surface | Owner | Path |
|---|---|---|
| Landing + customer PWA | Nikao | `src/app/(customer)/*` |
| POS | Mine | `src/app/pos/*` |
| Admin | Mia | `src/app/admin/*` |
| Server / API | Gian | `src/server/*`, `src/app/api/*` |
| Shared design system | Nikao + Mia | `src/lib/design-tokens.ts`, `src/components/ui/*`, `src/components/shared/*` |

## POS rules
- iPad portrait, target 768×1024.
- The "Done" button on the active-order view must be the visually dominant action (PRD L15).
- PIN pad: numeric, 4–6 digits, masked dots, large keys.

## Admin rules
- Sidebar collapsible below 1024 px.
- shadcn `Table` for lists, `Dialog` for edits, `Sonner` for toasts.
- Finance role hides "Menu" and "Staff" sidebar items.

## Landing rules
- Must render with JavaScript disabled.
- Lighthouse mobile ≥ 90.
- Operating hours are display-only (PRD L04).

## Money and dates

- Money: `formatZar(cents)` from `src/lib/format.ts` — outputs `R45,00` (comma decimal, ZAR convention). Never format money manually.
- Dates: `formatDate(date)` from `src/lib/format.ts` — always `Africa/Johannesburg` timezone.
