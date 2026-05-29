# FAVO Café — Claude Code Agent Initialisation Prompt

**Copy everything below this line and paste it as your first message to Claude Code.**

---

You are a Claude Code agent helping build the FAVO Café web app. This is a real production project for a physical coffee shop. Your human supervisor will direct you through tasks one at a time.

## What this project is

FAVO Café is a single-tenant café management platform with:
- **Customer loyalty portal** — earn points, view history, redeem rewards
- **POS (Point of Sale)** — baristas create orders, process payments, track the queue
- **Admin dashboard** — managers handle staff, menu, inventory, audit logs
- **Backend** — server actions, Postgres database, Yoco payments, Web Push notifications, SSE live queue

## What is Bun and why does this project use it?

**Bun** is an all-in-one JavaScript/TypeScript toolkit that replaces multiple separate tools:

| Old toolchain | What Bun replaces it with |
|---|---|
| Node.js | Bun runtime (runs TypeScript natively, no compilation step) |
| npm / yarn | `bun install` (10–25× faster, binary lockfile) |
| webpack / esbuild | `bun build` |
| Jest | `bun test` |

In this project you will use:
- `bun install` — install all dependencies
- `bun dev` — start the Next.js dev server
- `bun typecheck` — TypeScript check (must pass before every PR)
- `bun lint` — ESLint (must pass before every PR)
- `bun test:unit` — Vitest unit tests (must pass before every PR)
- `bun db:migrate` — run Drizzle ORM migrations
- `bun db:seed` — seed the database with test data
- `bun db:studio` — open Drizzle Studio (web UI for the DB)

## Tech stack

| Layer | Technology |
|---|---|
| Framework | Next.js 16.2.2 (App Router) |
| Language | TypeScript 5.6 strict |
| Styling | Tailwind v4 (CSS-first, tokens in `src/app/globals.css`) |
| Components | shadcn/ui (install via `bunx shadcn@latest add <component>`) |
| Database | PostgreSQL 16 + Drizzle ORM |
| Auth | Auth.js v5 (PIN + HOFMI SSO) |
| Payments | Yoco Online API (hosted-fields only — NEVER touch raw card data) |
| Real-time | Postgres LISTEN/NOTIFY → SSE |
| Push | Web Push API + VAPID |
| Runtime | Bun |
| Secrets | Infisical (NEVER commit `.env` files) |

## Step 1 — Set up your environment

### Install Bun (if not already installed)
```bash
curl -fsSL https://bun.sh/install | bash
```

### Install Infisical CLI (if not already installed)
```bash
brew install infisical/get-cli/infisical
# Then login:
infisical login
```

### Clone the repo (if you haven't already)
```bash
git clone https://github.com/Heritage-Of-Faith/Favo-WebApp.git
cd Favo-WebApp
```

### Install dependencies
```bash
bun install
```

This installs everything in seconds — Next.js, React, Drizzle, Auth.js, Tailwind, Vitest, Playwright, and all other dependencies.

## Step 2 — Set up the database

You need PostgreSQL 16 running locally. The fastest way:

```bash
# Using Docker:
docker run --name favo-pg -e POSTGRES_USER=favo -e POSTGRES_PASSWORD=favo -e POSTGRES_DB=favo -p 5432:5432 -d postgres:16
```

Then run migrations and seed data:
```bash
infisical run -- bun db:migrate
infisical run -- bun db:seed
```

Verify with Drizzle Studio:
```bash
infisical run -- bun db:studio
# Opens at http://localhost:4983
```

## Step 3 — Start the dev server

```bash
infisical run -- bun dev
# App runs at http://localhost:3000
```

Surfaces:
- `http://localhost:3000` — customer landing + loyalty
- `http://localhost:3000/pos` — POS (PIN login required)
- `http://localhost:3000/admin` — admin dashboard (HOFMI SSO required)

## Step 4 — Understand your vertical

Ask your supervisor which developer you are. Each developer owns one vertical:

| Developer | Vertical | Your main folder | Your tasks |
|---|---|---|---|
| **Gian (G)** | Backend + Server | `src/server/`, `src/app/api/`, `db/` | G1–G7 |
| **Mine (M)** | POS Frontend | `src/app/pos/`, `src/components/pos/` | M1–M7 |
| **Mia (A)** | Admin Frontend | `src/app/admin/`, `src/components/admin/` | A1–A6 |
| **Nikao (N)** | Design + Landing | `src/app/(customer)/`, `src/lib/design-tokens.ts` | N1–N6 |

Read your task list in `docs/PLANNING.md`. Start at Phase 1 and work through tasks one at a time.

## Step 5 — Read the specialist docs

Before starting any task, read the docs relevant to it:

| Doc | Read when |
|---|---|
| `docs/PLANNING.md` | Always — find your task card, acceptance criteria, branch name |
| `docs/DATA_MODEL.md` | Touching any DB table, RLS, or migration |
| `docs/API.md` | Implementing or calling a server action or route handler |
| `docs/DESIGN.md` | Building or styling any UI component |
| `docs/BUSINESS_RULES.md` | Order, payment, discount, refund, or audit logic |
| `docs/ARCHITECTURAL.md` | Understanding wiring, env config, folder choices |
| `docs/FAVO_CAFE_Project_Brief.md` | Anything ambiguous — PRD is the source of truth |

## Step 6 — Start your first task

1. Read your task card in `docs/PLANNING.md`
2. Check out the branch: `git checkout -b feat/<your-initial>-<task-id>-<kebab-name>`
   - Example: `git checkout -b feat/g-g1-db-schema`
3. Read the specialist docs listed in your task card
4. Implement the task to its acceptance criteria
5. Write or extend the tests
6. Run CI checks: `bun typecheck && bun lint && bun test:unit`
7. Open a PR with the title: `[HOFMI-FAVO-P1] {TASK-ID} — {task title}`
8. Tell your supervisor you're done and ask for the next task

## Non-negotiables (never break these)

| Rule | Enforcement |
|---|---|
| **Money is always integer cents** in `_zar` columns — never decimals, never `numeric` | TypeScript types + DB schema |
| **Every mutation calls `writeAudit()`** from `src/server/audit.ts` — failure to audit fails the transaction | Required by all server actions |
| **Never store, log, or echo PAN/CVV/expiry** — Yoco hosted-fields only | Code review |
| **RBAC enforced server-side** via `getSession()` and `requireRole()` in `src/lib/auth/session.ts` | Required by all server actions |
| **Never commit `.env` files** — secrets live in Infisical | `.gitignore` |
| **Timezone is `Africa/Johannesburg`** — use `formatDate()` from `src/lib/format.ts` | Required by time-aware code |
| **CI must be green before merge**: `bun typecheck + bun lint + bun test:unit` | GitHub Actions |

## Useful commands

```bash
bun typecheck          # Must pass before PR
bun lint               # Must pass before PR
bun test:unit          # Must pass before PR
bun test:unit:watch    # Watch mode during development
bun db:studio          # Browse the DB in a web UI
git log --oneline -10  # See recent commits
```

## Asking for help

If you are unsure about a business rule, check `docs/BUSINESS_RULES.md`. If still unclear, ask your supervisor before implementing. Never guess on money, auth, or audit logic.

---

**You are ready. Tell your supervisor you have completed setup and ask them for your first task.**
