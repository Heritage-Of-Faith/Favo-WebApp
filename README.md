# FAVO Café Web App

Single-tenant café POS + loyalty platform for FAVO Café.

**Deploy:** `favo.hofmi.org` · **Repo:** `github.com/Heritage-Of-Faith/Favo-WebApp`

---

## What is Bun?

This project uses **Bun** — an all-in-one JavaScript/TypeScript toolkit that replaces Node.js, npm, webpack, and Jest with a single fast binary.

- `bun install` is 10–25× faster than `npm install`
- Runs TypeScript natively — no compilation step needed
- One command for install, run, test, and build

[Install Bun](https://bun.sh) if you don't have it: `curl -fsSL https://bun.sh/install | bash`

---

## Quick Start

```bash
git clone https://github.com/Heritage-Of-Faith/Favo-WebApp.git
cd Favo-WebApp
bun install
infisical run -- bun db:migrate
infisical run -- bun db:seed
infisical run -- bun dev
```

App runs at `http://localhost:3000`

> **Secrets:** pulled from Infisical. Never commit `.env` files. Run `infisical login` first.

---

## Team and Verticals

| Developer | Vertical | Folder | Phase 1 Tasks |
|---|---|---|---|
| Gian | Backend + Server | `src/server/`, `src/app/api/`, `db/` | G1–G7 |
| Mine | POS Frontend | `src/app/pos/`, `src/components/pos/` | M1–M7 |
| Mia | Admin Frontend | `src/app/admin/`, `src/components/admin/` | A1–A6 |
| Nikao | Design + Landing | `src/app/(customer)/`, `src/lib/` | N1–N6 |

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 16.2.2 (App Router) |
| Language | TypeScript 5.6 strict |
| Styling | Tailwind v4 |
| Components | shadcn/ui |
| Database | PostgreSQL 16 + Drizzle ORM |
| Auth | Auth.js v5 (PIN + HOFMI SSO) |
| Payments | Yoco Online API |
| Runtime | Bun |
| Secrets | Infisical |

---

## Commands

```bash
bun dev              # Start dev server
bun typecheck        # TypeScript check
bun lint             # ESLint
bun test:unit        # Vitest unit tests
bun test:e2e         # Playwright E2E tests
bun db:migrate       # Run migrations
bun db:seed          # Seed test data
bun db:studio        # Drizzle Studio (DB browser)
```

---

## CI Gates (must pass before merge)

```bash
bun typecheck && bun lint && bun test:unit
```

GitHub Actions runs these automatically on every PR.

---

## Branch and PR Conventions

- Branch: `feat/<initial>-<task-id>-<kebab-name>` e.g. `feat/g-g1-db-schema`
- Squash-merge to `main` with: `[HOFMI-FAVO-P{n}] {ID} — {title}`
- One task per PR. CI must be green.

---

## Onboarding

New developer or Claude Code agent? Open `initialise.md` and follow the steps.

---

## Docs

| File | Purpose |
|---|---|
| `docs/PLANNING.md` | Task breakdown, phases, acceptance criteria |
| `docs/DATA_MODEL.md` | 24 DB tables, RLS, audit rules |
| `docs/API.md` | Server actions + route handlers |
| `docs/DESIGN.md` | Tailwind tokens, shadcn/ui, component rules |
| `docs/BUSINESS_RULES.md` | Locked rules — never break these |
| `docs/ARCHITECTURAL.md` | Stack, folders, env vars, deploy |
| `docs/FAVO_CAFE_Project_Brief.md` | PRD — source of truth |
