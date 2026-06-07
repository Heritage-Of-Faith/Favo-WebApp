# FAVO Café — Claude Context

Project: FAVO Café Web App · single-tenant café POS + admin
Repo: `github.com/hofmi-ai/favo` · Deploy: `favo.hofmi.org`

## Stack snapshot
Next.js 16 (App Router) · React 19 · TS 5.6 strict · Tailwind v4 + shadcn/ui · PG 17 (Supabase) + Drizzle ORM · Auth.js v5 · Yoco Online API · Web Push + VAPID · SSE via PG LISTEN/NOTIFY · Bun · Cloudflare

## Repo map
- `src/app/(customer)` — landing + customer PWA (Nikao)
- `src/app/pos` — POS surface (Mine)
- `src/app/admin` — admin surface (Mia + Gian)
- `src/server/actions` — Server Actions (Gian)
- `src/server/audit.ts` — `writeAudit()` helper
- `db/schema.ts` · `db/seed/*` · `drizzle/*` — schema, seed, migrations
- `tests/{unit,e2e,db,components}` — Vitest + Playwright

## Branches & PRs
- Branch: `feat/<initial>-<task-id>-<kebab-name>` (e.g. `feat/g-g1-db-schema`)
- Squash-merge to `main` with WI key in commit: `[HOFMI-FAVO-P{n}] {ID} — {title}`
- One task per PR. No mixed verticals.

## CI gate (must be green before merge)
`bun typecheck` · `bun lint` · `bun test:unit`

## Non-negotiables
- **Secrets:** never committed. Use `.env.local` locally; Vercel env vars in production. No `.env` in git.
- **Audit log:** append-only, trigger-enforced. Every mutation calls `writeAudit()` from `src/server/audit.ts`.
- **Money:** integer cents in columns suffixed `_zar`. Never `numeric`. Format with `formatZar()` from `src/lib/format.ts`.
- **Timezone:** `Africa/Johannesburg`. Wall-clock logic uses `formatDate()`.
- **Card data:** never store, log, or echo PAN/CVV/expiry. Yoco hosted-fields only.
- **RBAC:** enforced server-side via `getSession()`. UI checks are advisory.

## Specialist files (load only when task requires)
| File | Read when |
|---|---|
| `ARCHITECTURAL.md` | Wiring layers, env config, deploy, folder choices |
| `DESIGN.md` | Building or styling any UI |
| `DATA_MODEL.md` | Touching any DB table, RLS, or migration |
| `API.md` | Implementing or calling a Server Action / route handler |
| `BUSINESS_RULES.md` | Order, payment, discount, refund, or audit logic |
| `PLANNING.md` | Confirming task scope, owner, phase, acceptance criteria |
| `FAVO_PRD_v3.md` | Anything ambiguous — PRD is the source of truth |

## How to start a task
1. **Read `PLANNING.md`** — find the task card (Task ID, owner, branch, files, acceptance).
2. **Read the specialist files** listed in that card (typically 2–3).
3. **Branch off latest `main`** using `feat/<initial>-<task-id>-<kebab-name>`.
4. **Confirm the DB tables and Server Actions** in scope per the task card.
5. **Build to the acceptance criteria.** Write tests. CI green. PR with WI key.
