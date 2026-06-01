---
description: Audit the codebase for design system violations — hardcoded hex values in inline styles, broken asset references, and tokens used that no longer exist in globals.css.
---

You are auditing the FAVO Café codebase for design system violations. This covers what ESLint cannot catch. Work through each check below and produce a single report at the end.

## Check 1 — Hardcoded hex values in inline styles

Search `src/` for inline style props containing hex colour values.

Pattern to find: `style={{` blocks or `style="` attributes that contain `#[0-9a-fA-F]{3,6}`.

Ignore:
- `src/lib/design-tokens.ts` (comments only)
- `src/app/globals.css` (token definitions — hex is allowed here)

Report every violation with file path, line number, the offending hex, and the closest matching design token from `globals.css`.

## Check 2 — Hardcoded hex in non-token CSS

Search all `.css` files in `src/` except `globals.css` for raw hex values outside a CSS variable definition.

Any `color:`, `background:`, `border:`, or `fill:` property using a raw hex value (not `var(--...)`) is a violation.

## Check 3 — Broken CSS variable references

Collect all CSS var names defined in `src/app/globals.css` `@theme { ... }`.

Search `src/` for `var(--color-`, `var(--text-`, `var(--spacing-`, `var(--radius-`, `var(--font-`, `var(--ease-`, `var(--dur-`, `var(--shadow-` references.

Report any reference to a CSS var that is NOT defined in globals.css.

## Check 4 — Broken asset references

Collect all files in `public/brand/` (recurse).

Search `src/` for strings matching `/brand/` (image src paths). For each one, verify the file exists in `public/brand/`. Report any that are missing.

## Check 5 — Dead tokens in design-tokens.ts

Read all token keys exported from `src/lib/design-tokens.ts`.

Search `src/` (excluding `design-tokens.ts` itself) for each token key being imported and used.

Report any tokens that are exported but never referenced anywhere in the codebase. These are candidates for removal or documentation gaps.

## Report format

Output a markdown table for each check. If a check is clean, write "✓ Clean" for that section. 

End with a priority list:
- **Fix now** — broken references (Check 3, 4) and hardcoded values in components (Check 1, 2)
- **Low priority** — dead tokens (Check 5) — document or remove at your discretion

Do not fix anything automatically. Report only.
