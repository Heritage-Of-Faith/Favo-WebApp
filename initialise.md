# FAVO Café — Claude Code Agent Initialisation Prompt

**Copy everything below this line and paste it as your first message to Claude Code.**

---

You are a Claude Code agent helping build the FAVO Café web app. This is a real production project for a physical coffee shop. Your job right now is to set up this developer's environment completely so they can start building immediately. Do not wait for the developer to run commands themselves — you run everything for them and only pause to ask questions or get approval when truly needed.

## Your first action

Ask the developer exactly this question before doing anything else:

> "Which vertical are you working on? Reply with a number:
> 1. Gian — Backend and Server (database, API, auth, payments)
> 2. Mine — POS Frontend (point-of-sale screen, order builder, queue board)
> 3. Mia — Admin Frontend (dashboard, staff management, menu, audit log)
> 4. Nikao — Design and Landing (customer loyalty portal, landing page, design tokens)"

Wait for their answer. Then proceed with the full setup below.

---

## What you are setting up

FAVO Café is a coffee shop management platform. Four Claude Code agents — each supervised by a human — are building it in parallel. Each agent owns one vertical (area of the codebase) and never touches another agent's area. You are one of those four agents.

Stack: Next.js 16 · React 19 · TypeScript 5.6 strict · Tailwind v4 · PostgreSQL 16 + Drizzle ORM · Auth.js v5 · Yoco payments · Web Push · Bun runtime.

---

## Setup sequence — run all of this automatically

Work through every step below. Run the commands yourself using your Bash tool. Explain to the developer in plain language what you are doing at each step. If a step fails, diagnose and fix it before moving on.

### Step 1 — Check Bun is installed

```bash
bun --version
```

If Bun is not installed, install it:
```bash
curl -fsSL https://bun.sh/install | bash
```

Then ask the developer to restart their terminal and re-paste this prompt.

While you are here, explain Bun to the developer in plain language: "Bun is the tool this project uses instead of Node.js and npm. It installs packages 10 to 25 times faster and runs TypeScript directly without any extra compilation step. Think of it as a faster, all-in-one replacement for the tools most web projects use."

### Step 2 — Check GitHub CLI is installed

```bash
gh --version
```

If not installed:
```bash
brew install gh
gh auth login
```

Walk the developer through the login flow if it opens a browser window.

### Step 3 — Set up .env.local

The app reads secrets from a `.env.local` file in the project root. This file is gitignored and never committed.

```bash
cp .env.example .env.local
```

Then tell the developer: "Open `.env.local` and fill in the values. Ask Gian for the `DATABASE_URL` and `AUTH_SECRET` — these connect to the Supabase database and are required before you can run the app."

The `.env.example` file lists every required variable. The most critical ones are:
- `DATABASE_URL` — Supabase Transaction pooler connection string (port 6543)
- `DATABASE_URL_SESSION` — Supabase Session pooler (port 5432, needed for SSE)
- `AUTH_SECRET` — Auth.js signing secret

### Step 4 — Clone the repo if not already inside it

Check whether we are already in the repo:
```bash
git remote -v 2>/dev/null | head -2
```

If we are not inside the repo:
```bash
git clone https://github.com/Heritage-Of-Faith/Favo-WebApp.git
cd Favo-WebApp
```

### Step 5 — Install all dependencies

```bash
bun install
```

This installs everything the project needs — Next.js, React, Drizzle, Auth.js, Tailwind, Vitest, Playwright, and all other packages. It takes a few seconds.

### Step 6 — Set the developer's vertical in their shell profile

Based on the developer's answer to your first question, set their `FAVO_VERTICAL` environment variable. This tells the project's safety hooks which files belong to them.

First, find out which shell they use:
```bash
echo $SHELL
```

- If the output contains `zsh` use `~/.zshrc`
- If the output contains `bash` use `~/.bash_profile`

Add the correct line based on their vertical:
- Gian (Backend) → `export FAVO_VERTICAL=backend`
- Mine (POS) → `export FAVO_VERTICAL=pos`
- Mia (Admin) → `export FAVO_VERTICAL=admin`
- Nikao (Design) → `export FAVO_VERTICAL=design`

Run these commands, replacing the values for their vertical and shell profile:
```bash
echo 'export FAVO_VERTICAL=<their-vertical>' >> ~/.zshrc
source ~/.zshrc
echo "FAVO_VERTICAL is now set to: $FAVO_VERTICAL"
```

Explain to the developer: "I have set your vertical to [vertical name]. This activates a safety check that runs automatically every time I edit a file. If I ever accidentally try to touch a file that belongs to another developer's area, Claude Code will block me and warn you before anything is changed."

### Step 7 — Start the local database with Docker

Check if Docker is running:
```bash
docker --version
```

If Docker is available, start a local PostgreSQL database:
```bash
docker run --name favo-pg \
  -e POSTGRES_USER=favo \
  -e POSTGRES_PASSWORD=favo \
  -e POSTGRES_DB=favo \
  -p 5432:5432 \
  -d postgres:16
```

If that container already exists from a previous setup:
```bash
docker start favo-pg
```

Confirm it is running:
```bash
docker ps | grep favo-pg
```

If Docker is not installed, tell the developer: "You need Docker to run the local database. Download it from https://docker.com/get-started, install it, and then come back to this step."

### Step 8 — Run database migrations and seed data

```bash
bun db:migrate
bun db:seed
```

If this fails with a database connection error, tell the developer: "Check that `DATABASE_URL` is correctly set in `.env.local`. Ask Gian for the Supabase connection string."

When this succeeds, tell the developer what just happened: "The database now has all 24 tables created and filled with test data — including a test customer called Louis and a test barista account you can use to log in."

### Step 9 — Verify the dev server starts correctly

Start the server briefly to confirm everything is wired up:
```bash
bun dev &
sleep 6
curl -s http://localhost:3000/api/healthz
kill %1 2>/dev/null
```

If the health check returns `{"ok":true,"service":"favo-webapp"}`, everything is working.

Tell the developer their three URLs:
- `http://localhost:3000` — customer landing page and loyalty portal
- `http://localhost:3000/pos` — POS screen where baristas log in with a PIN
- `http://localhost:3000/admin` — admin dashboard for managers

### Step 10 — Run CI checks to confirm the codebase is clean

```bash
bun typecheck
bun lint
bun test:unit
```

All three must pass before setup is considered complete. If any fail, investigate and fix the issue first.

---

## How this project works — explain this to the developer in plain language

Once all ten steps are done and passing, walk the developer through how the project works day to day.

### The worktree system

Explain it like this: "Every task gets its own private working folder called a worktree. Think of the main repo as a shared office building. For every task I start, I open a separate private office just for that work. When the task is done and a human has reviewed it, that work moves into the shared building. This means all four developers can work at the same time without any risk of our changes clashing."

For every new task, I will automatically run:
```bash
# Open a private office for this task
git fetch origin
git worktree add ../favo-<task-id> -b feat/<initial>-<task-id>-<name> origin/main
cd ../favo-<task-id>
bun install

# After finishing, push and open a pull request
git push -u origin feat/<initial>-<task-id>-<name>
gh pr create --title "[HOFMI-FAVO-P1] <TASK-ID> — <task title>"

# After the PR is approved and merged, clean up
cd ../Favo-WebApp
git worktree remove ../favo-<task-id>
```

You never need to run any of those commands yourself. I handle all of it.

### The hook system

Explain it like this: "Two automatic checks run silently every time I edit a file. The first one checks I am not accidentally touching another developer's files — if I try, I get blocked immediately and you are warned before anything changes. The second one automatically tidies up code style issues the moment I save a file, so they never build up into a mess."

### The docs

Before starting any task, I will always read the relevant docs in the `docs/` folder:

| Doc | I read this when |
|---|---|
| `docs/PLANNING.md` | Always — to find the task, branch name, and what done looks like |
| `docs/DATA_MODEL.md` | Touching any database table |
| `docs/API.md` | Writing or calling any server action |
| `docs/DESIGN.md` | Building any UI component |
| `docs/BUSINESS_RULES.md` | Anything involving orders, payments, discounts, or refunds |
| `docs/FAVO_CAFE_Project_Brief.md` | Anything unclear — this is the final source of truth |

---

## Rules I will never break

These apply to every line of code I write, no exceptions:

| Rule | Why |
|---|---|
| Money is always stored as whole cents in `_zar` columns — `4500` means R45.00, never `45.00` | One decimal mistake means the wrong amount charged to a customer |
| Every database change must call `writeAudit()` from `src/server/audit.ts` | Every change must be permanently logged — this is a legal requirement |
| Never store, log, or display card numbers or card details | Yoco handles all card data — we never see or touch it |
| RBAC (who can access what) is enforced on the server — UI checks are just decoration | A customer must never be able to see staff or admin data |
| Never commit `.env` files — secrets live in `.env.local` locally and Vercel env vars in production | One leaked key compromises the whole production system |
| Timezone is always Africa/Johannesburg — use `formatDate()` from `src/lib/format.ts` | Wrong timezone means wrong timestamps on every transaction |

---

## Setup complete

Once all ten steps pass, tell the developer:

> "You are fully set up. The app runs, your vertical is locked in, and the safety hooks are active. Tell your supervisor you are ready and ask for your first task. From here I handle the branch, the code, the tests, and the pull request — you review and approve each step."

Then wait for the supervisor to assign the first task.
