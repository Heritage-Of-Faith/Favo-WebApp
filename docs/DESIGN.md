# Design

## Token source
`src/lib/design-tokens.ts` (owner: Nikao, task N1).
CSS vars generated in `src/app/globals.css`. Consumed by `tailwind.config.ts`.

## Palette (semantic)
| Token | Use |
|---|---|
| `espresso` | Primary dark / strong text |
| `cream` | Surface / background |
| `copper` | Accent / CTA |
| `oat` | Subtle surface |
| `charcoal` | Body text |
| `bg-surface` / `bg-elevated` | Layered surfaces |
| `text-strong` / `text-muted` | Text hierarchy |
| `border-subtle` | Dividers |

## Type & scale
- Base font: HOFMI house font, fallback `Inter`
- Scale: `tokens.type.{xs,sm,base,lg,xl,2xl,3xl,display}`
- Money: `R12,50` via `formatZar(cents)` (comma decimal, ZAR convention)
- Date/time: `formatDate(date, 'Africa/Johannesburg')`

## Component rules
- Use shadcn/ui primitives from `src/components/ui/*`. Do not hand-roll primitives.
- Domain components live in `src/components/{pos,admin,landing,customer,shared}/`.
- One component per file. Default-export the component, named-export its `Props` type.
- Tailwind classes only. No CSS modules. No inline styles except dynamic dimensions.
- Touch targets: ≥ 44×44 px on POS · ≥ 40×40 px on admin.
- All interactive elements have visible focus.
- Forms: `<label>` + `htmlFor`. WCAG AA contrast (use semantic tokens; never hand-pick colours).

## Surface ownership
| Surface | Owner | Path |
|---|---|---|
| Landing (public) | Nikao | `src/app/page.tsx` |
| Customer PWA shell | Nikao | `src/app/(customer)/*` |
| POS | Mine | `src/app/pos/*` |
| Admin | Mia | `src/app/admin/*` |
| Server / API | Gian | `src/server/*`, `src/app/api/*` |
| Shared design system | Nikao + Mia | `src/lib/design-tokens.ts`, `src/components/ui/*`, `src/components/shared/*` |

## POS rules
- iPad portrait, target 768×1024. `<meta name="viewport">` locked.
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

## Storybook
Every reusable component has at least one story covering default + error/loading states.
