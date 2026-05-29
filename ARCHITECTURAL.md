# Architecture

## Stack
| Layer | Choice |
|---|---|
| Framework | Next.js 16 App Router + React 19 |
| Language | TypeScript 5.6 strict (`tsc --noEmit` in CI) |
| Styling | Tailwind v4 + shadcn/ui |
| DB | PostgreSQL 16 (self-hosted on `hofmi-eu-open`) |
| ORM | Drizzle ORM |
| Auth | Auth.js v6 — PIN provider (staff) + HOFMI SSO (admin/finance/owner) + email magic link (customers, Phase 3) |
| Payments | Yoco Online API (hosted fields, tokenisation) |
| Real-time | Postgres LISTEN/NOTIFY → SSE |
| Push | Web Push API + VAPID (`web-push`) |
| Offline | IndexedDB (`idb`) + Service Worker (Phase 3) |
| Storage | Cloudflare R2 (`hofmi-favo`) |
| Hosting | Coolify on `hofmi-eu-open` |
| CDN | Cloudflare (`favo.hofmi.org`); Cloudflare Access gates `/admin/*` + `/finance/*` |
| Secrets | Infisical (`hofmi/favo`) |
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
middleware.ts            # route gating by role
```

## Environment (canonical names — never commit)
Pulled from Infisical via Coolify at deploy:
```
DATABASE_URL
NEXTAUTH_SECRET · NEXTAUTH_URL
YOCO_SECRET_KEY · YOCO_WEBHOOK_SECRET
VAPID_PUBLIC_KEY · VAPID_PRIVATE_KEY · NEXT_PUBLIC_VAPID_PUBLIC_KEY
R2_ACCESS_KEY_ID · R2_SECRET_ACCESS_KEY · R2_BUCKET · R2_ENDPOINT
DISCORD_WEBHOOK_FAVO_OPS
RAINDROP_TOKEN · LOKI_URL
PUBLIC_BASE_URL · TZ=Africa/Johannesburg
HOFMI_SSO_CLIENT_ID · HOFMI_SSO_CLIENT_SECRET · HOFMI_SSO_ISSUER
NEXT_PUBLIC_STAGING                  # gates staging-only stubs
```

## Deploy pipeline
GitHub Actions → CI on every PR (`bun typecheck`, `bun lint`, `bun test:unit`, `bun test:e2e:ci`) → squash-merge to `main` → Coolify webhook → rebuild → `favo.hofmi.org`.

## Local dev
```
bun install
infisical run -- bun db:migrate
infisical run -- bun db:seed
infisical run -- bun dev
```
Requires Postgres 16. Use Infisical CLI to inject env at runtime.

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
