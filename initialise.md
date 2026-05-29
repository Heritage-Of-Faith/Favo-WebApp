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

| Developer | Vertical | Your main folder | Your tasks | FAVO_VERTICAL value |
|---|---|---|---|---|
| **Gian (G)** | Backend + Server | `src/server/`, `src/app/api/`, `db/` | G1–G7 | `backend` |
| **Mine (M)** | POS Frontend | `src/app/pos/`, `src/components/pos/` | M1–M7 | `pos` |
| **Mia (A)** | Admin Frontend | `src/app/admin/`, `src/components/admin/` | A1–A6 | `admin` |
| **Nikao (N)** | Design + Landing | `src/app/(customer)/`, `src/lib/design-tokens.ts` | N1–N6 | `design` |

Once you know your vertical, add this line to your shell profile (`~/.zshrc` or `~/.bashrc`) and restart your terminal:

```bash
# Replace 'backend' with your vertical value from the table above
export FAVO_VERTICAL=backend
```

This activates the Claude Code hooks that protect vertical boundaries — they will warn you if you accidentally try to edit a file that belongs to another developer's area.

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

## Step 6 — Understand git worktrees (important — read this)

Before starting any task, you need to understand **git worktrees**. This is how four developers can work in parallel without breaking each other's work.

### What is a worktree? (simple version)

Think of the main repo folder as the main office. Normally, only one person can rearrange the desks at a time — if two people try to rearrange simultaneously, things get messy. A **git worktree** is like opening a separate office on the same floor. It has its own copy of the files to work on, but it is connected to the same building (the same git history). Four developers can each have their own office and work simultaneously without getting in each other's way.

When you finish your task, you close that office (delete the worktree) and your finished work gets reviewed before it is moved into the main office (merged to main).

### How to use worktrees for every task

**Do this at the start of every new task instead of `git checkout -b`:**

```bash
# 1. Make sure you have the latest main
git fetch origin

# 2. Create a worktree for your task (this creates a new folder AND a new branch at once)
git worktree add ../favo-<task-id> -b feat/<your-initial>-<task-id>-<kebab-name> origin/main

# Example for task G1:
git worktree add ../favo-g1 -b feat/g-g1-db-schema origin/main

# 3. Move into your worktree folder to start working
cd ../favo-g1

# 4. Install dependencies in this worktree
bun install
```

Your worktree is now a completely separate working folder. You can have multiple worktrees open at once — one per task — and they never interfere with each other.

**When your task is done and the PR is merged:**

```bash
# Go back to the main repo folder
cd ../Favo-WebApp

# Remove the worktree (safe — your branch is already on GitHub)
git worktree remove ../favo-g1
```

### Quick reference: task start-to-finish with worktrees

```bash
# START a task
git fetch origin
git worktree add ../favo-<task-id> -b feat/<initial>-<task-id>-<name> origin/main
cd ../favo-<task-id>
bun install

# WORK on the task (build, test, commit normally)
git add src/server/actions/orders.ts
git commit -m "feat: implement createOrder action"

# FINISH — push and open PR
git push -u origin feat/<initial>-<task-id>-<name>
gh pr create --title "[HOFMI-FAVO-P1] G5 — Order actions"

# CLEAN UP after PR is merged
cd ../Favo-WebApp
git worktree remove ../favo-<task-id>
```

## Step 7 — Start your first task

1. Read your task card in `docs/PLANNING.md`
2. Create a worktree for the task (see Step 6 above)
3. Read the specialist docs listed in your task card
4. Implement the task to its acceptance criteria
5. Write or extend the tests
6. Run CI checks: `bun typecheck && bun lint && bun test:unit`
7. Push and open a PR with the title: `[HOFMI-FAVO-P1] {TASK-ID} — {task title}`
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
# CI checks (must all pass before opening a PR)
bun typecheck          # TypeScript check
bun lint               # ESLint
bun test:unit          # Vitest unit tests
bun test:unit:watch    # Watch mode during development

# Database
bun db:studio          # Browse the DB in a web UI (http://localhost:4983)
bun db:migrate         # Run pending migrations
bun db:seed            # Re-seed test data

# Git worktrees
git worktree list                          # See all open worktrees
git worktree add ../favo-<id> -b <branch> origin/main   # Start a task
git worktree remove ../favo-<id>           # Clean up after PR merged

# GitHub CLI
gh pr create           # Open a pull request
gh pr list             # See open PRs
gh pr status           # See status of your PRs

# General
git log --oneline -10  # See recent commits
git fetch origin       # Get latest changes from GitHub
```

## Asking for help

If you are unsure about a business rule, check `docs/BUSINESS_RULES.md`. If still unclear, ask your supervisor before implementing. Never guess on money, auth, or audit logic.

---

**You are ready. Tell your supervisor you have completed setup and ask them for your first task.**
