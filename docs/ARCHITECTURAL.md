# Architecture

## Stack
| Layer | Choice |
|---|---|
| Framework | Next.js 16 App Router + React 19 |
| Language | TypeScript 5.6 strict (`tsc --noEmit` in CI) |
| Styling | Tailwind v4 + shadcn/ui |
| DB | PostgreSQL 17 (Supabase, project `Flavo-Real`, eu-west-1) |
| ORM | Drizzle ORM (`prepare: false` in `db/index.ts` — required for PgBouncer Transaction pooler) |
| Auth | Auth.js v5 — PIN provider (staff) + email magic link (customers, Phase 3) |
| Payments | Yoco Online API (hosted fields, tokenisation) |
| Real-time | Postgres LISTEN/NOTIFY → SSE |
| Push | Web Push API + VAPID (`web-push`) |
| Offline | IndexedDB (`idb`) + Service Worker (Phase 3) |
| Storage | Cloudflare R2 (`hofmi-favo`) |
| Hosting | TBD — app hosting not yet set up; DB on Supabase |
| CDN | Cloudflare (`favo.hofmi.net`); Cloudflare Access gates `/admin/*` |
| Secrets | `.env.local` (local) · production: Infisical (target, PRD v7 §9.7 — not set up yet) |
| Logs | Pino → Loki |
| Tracing | Raindrop |
| Tests | Vitest + Playwright + Storybook |
| Runtime | Bun |

## Folder layout
```
src/
  app/
    (customer)/          # landing + customer PWA (Nikao)
    pos/                 # POS surface (Mine)
    admin/               # admin surface (Mia, Gian)
    api/
      payments/yoco/webhook/route.ts
      queue/stream/route.ts
      push/subscribe/route.ts
      reports/export/route.ts
      cogs/live/route.ts
      healthz/route.ts
  server/
    actions/             # Server Actions (one file per domain)
    audit.ts             # writeAudit helper — required by every mutation
    orders/state-machine.ts
    yoco/                # client + intent + webhook helpers
    push/                # VAPID + send helpers
    queue/notify.ts      # pg_notify wrapper
  components/
    ui/                  # shadcn primitives
    pos/ admin/ landing/ customer/ shared/
  lib/
    types.ts             # shared types (Order, OrderState, …)
    design-tokens.ts
    format.ts            # formatZar, formatDate
    db.ts                # re-export Drizzle client
    auth/session.ts      # getSession()
  hooks/                 # useOrderStream, etc.
  state/                 # Zustand stores (order draft, etc.)
db/
  schema.ts
  enums.ts
  index.ts               # Drizzle singleton (postgres-js)
  seed/                  # menu, customisations, staff, customers, hours
  sql/                   # raw SQL — audit triggers, RLS policies
drizzle/                 # generated migrations
tests/
  unit/ e2e/ db/ components/ hooks/ lib/ server/ auth/
proxy.ts                 # route gating by role (Next.js 16 — replaces middleware.ts)
```

## Environment (canonical names — never commit)
Set in `.env.local` (local). Production target: Infisical (PRD v7 §9.7, not set up yet):
```
DATABASE_URL              # Supabase Transaction pooler (port 6543)
DATABASE_URL_SESSION      # Supabase Session pooler (port 5432) — SSE/LISTEN only
AUTH_SECRET               # Auth.js signing secret
AUTH_URL                  # https://favo.hofmi.net (production)
YOCO_SECRET_KEY · YOCO_WEBHOOK_SECRET · NEXT_PUBLIC_YOCO_PUBLIC_KEY
VAPID_PUBLIC_KEY · VAPID_PRIVATE_KEY · NEXT_PUBLIC_VAPID_PUBLIC_KEY
PUBLIC_BASE_URL · TZ=Africa/Johannesburg
CRON_SECRET               # secures cron route handlers
```

## Deploy pipeline
GitHub Actions → CI on every PR (`bun typecheck`, `bun lint`, `bun test:unit`; a `next build` job is planned) → squash-merge to `main` → `docker-publish.yml` builds the image and pushes it to GHCR (not working yet, AT-165). Deploying that image is not built yet; the target is the always-on Transformate VM at `favo.hofmi.net` (PRD v7 §9).

## Local dev
```
bun install
cp .env.example .env.local   # fill in values (ask Gian for DB creds)
bun dev
```
DB is on Supabase (PG 17) — no local Postgres needed. `DATABASE_URL` must point at the Supabase Transaction pooler (port 6543). The Session pooler (port 5432) is required for PG LISTEN/NOTIFY only (SSE stream).

## Test commands
| Command | Scope |
|---|---|
| `bun typecheck` | `tsc --noEmit` |
| `bun lint` | ESLint |
| `bun test:unit` | Vitest |
| `bun test:e2e:ci` | Playwright headless |
| `bun storybook` | Component states |
| `bun db:migrate` · `bun db:seed` · `bun db:studio` | DB ops |

## Observability
- Logs → Pino → Loki (Sentinel watches)
- Tracing → Raindrop
- Ship + alert pings → Discord `#favo-ops`
