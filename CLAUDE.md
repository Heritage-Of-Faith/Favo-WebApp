# FAVO Café — Claude Context

Project: FAVO Café Web App · single-tenant café POS + admin
Repo: `github.com/hofmi-ai/favo` · Deploy: `favo.hofmi.org`

## Stack snapshot
Next.js 16 (App Router) · React 19 · TS 5.6 strict · Tailwind v4 + shadcn/ui · PG 16 + Drizzle ORM · Auth.js v6 · Yoco Online API · Web Push + VAPID · SSE via PG LISTEN/NOTIFY · Bun · Infisical · Coolify · Cloudflare

## Repo map
- `src/app/(customer)` — landing + customer PWA (Nikao)
- `src/app/pos` — POS surface (Mine)
- `src/app/admin` — admin surface (Mia + Gian)
- `src/server/actions` — Server Actions (Gian)
- `src/server/audit.ts` — `writeAudit()` helper
- `db/schema.ts` · `db/seed/*` · `drizzle/*` — schema, seed, migrations
- `tests/{unit,e2e,db,components}` — Vitest + Playwright

## Backend status — LIVE on `main` (G1–G7, as of 2026-05-30)
Gian's backend vertical is merged and green (89 unit tests). Other verticals can call these now.
All Server Actions return `{ ok: true, data } | { ok: false, code, message }` — **always check `res.ok`** (they never throw for auth/validation).

**Server Actions** (`import { … } from "@/server/actions/…"`):
- `loginWithPin(pin)` → `{ staffId, name }` · `signOut()` — `actions/auth.ts`
- `searchCustomer(query)` → `Customer[]` (ILIKE name + exact phone) — `actions/customers.ts`
- `createOrder({ customerId?, items:[{ menuItemId, quantity, modifications:string[] }] })` → `{ orderId, yocoClientSecret }` — `actions/orders.ts`
- `transitionOrder(orderId, toState)` → `Order` · `cancelOrder(orderId, reason)` · `applyStaffDiscount(orderId, beneficiaryStaffId)` — `actions/orders.ts`

**Route handlers:** `POST /api/payments/yoco/webhook` · `GET /api/queue/stream` (SSE, authed, `QueueEvent` frames + 30s heartbeat) · `POST /api/push/subscribe` (`{ customerId, subscription }`) · `GET /api/healthz`

**Importable helpers:** `@/lib/format` (`formatZar`, `formatDate`, `revenueDay`) · `@/server/orders/pricing` (`computeOrderTotalZar`) · `@/server/loyalty/calc` (`earnPoints`, `canRedeem`) · `@/lib/auth/session` (`getSession`, `requireRole`) · `@/server/auth/rbac` (`canAccessAdmin`, …)

**Seed for local testing:** test barista PIN `1234`; customer "Louis" (search `Lou`).

**Not built yet (don't assume these exist):** admin-support actions `listStaff` / `createStaff` / `setStaffPin` / `setMenuItemPrice` / `listAudit`; loyalty `redeem`/wallet/packs (Phase 3). End-to-end run needs a DB + Yoco/VAPID env — pure logic is fully testable without them.

## Branches & PRs
- Branch: `feat/<initial>-<task-id>-<kebab-name>` (e.g. `feat/g-g1-db-schema`)
- Squash-merge to `main` with WI key in commit: `[HOFMI-FAVO-P{n}] {ID} — {title}`
- One task per PR. No mixed verticals.

## CI gate (must be green before merge)
`bun typecheck` · `bun lint` · `bun test:unit`

## Non-negotiables
- **Secrets:** never committed. Read from Infisical via env. No `.env` in git.
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
