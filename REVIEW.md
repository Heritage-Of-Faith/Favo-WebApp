# Claude Code Review Rules — FAVO Café

These rules are injected into every Claude PR review agent as highest priority.

## Severity levels
- **error** — must be fixed before merge. Block the PR.
- **warning** — should be fixed. Leave a comment but don't block.
- **nit** — optional polish. Prefix with `Nit:`. Max 3 nits per review.

## Non-negotiable errors (always block)

- Any hardcoded hex colour value (`#F5560C`, `#1C0501`, etc.) outside `globals.css` or `design-tokens.ts` — **error**
- Any `style={{ color: '...' }}` or `style={{ background: '...' }}` with a raw colour value — **error**
- Any mutation (INSERT, UPDATE, DELETE) that does not call `writeAudit()` from `src/server/audit.ts` — **error**
- Any logging or echoing of card numbers, CVV, expiry, or PAN — **error**
- Any money value stored or computed as a float or decimal — **error** (must be integer cents, `_zar` suffix)
- Any direct database query outside `src/server/` — **error**
- Any `.env` file committed or any secret hardcoded in source — **error**

## Design system rules (warning)

- Tailwind arbitrary values like `bg-[#F5560C]` or `text-[22px]` that bypass the token system — **warning**
- Font families referenced directly in className or style instead of via `var(--font-display)` / `var(--font-sans)` — **warning**
- Inline `style={{ borderRadius: '12px' }}` or similar — use `--radius-*` tokens — **warning**
- `@theme` variables overridden inside `.dark {}` or any selector — **error** (breaks Tailwind v4; use `@theme inline` pattern — see `docs/DESIGN.md`)

## Component quality (warning)

- Interactive element with no visible focus state — **warning**
- Touch target smaller than 44×44px on POS surface or 40×40px on admin — **warning**
- `<img>` used instead of Next.js `<Image>` for any content image — **warning**
- Missing `alt` attribute on any image — **error** (accessibility + Lighthouse)
- Form `<input>` without a `<label htmlFor>` — **warning**

## What to skip

- `bun.lock` and generated files in `drizzle/` — skip entirely
- `tests/` — check test logic only if a business rule is being tested (loyalty calc, discount, pricing)
- Comments and formatting — ESLint handles these; don't nit style

## Architecture notes for the reviewer

- Server Actions return `{ ok: true, data } | { ok: false, code, message }` — always check `res.ok` on the caller side
- Timezone is always `Africa/Johannesburg` — `formatDate()` from `src/lib/format.ts` handles this
- RBAC is enforced server-side via `getSession()` — UI role checks are advisory only
- Real-time queue uses PG `LISTEN/NOTIFY` → SSE → `useOrderStream` hook — don't add WebSocket alternatives
