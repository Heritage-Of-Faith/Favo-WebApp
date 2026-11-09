# FAVO Café: Go-Live Runbook

**For:** Nikao, Matt (Transformate), Mia.
**Spec of record:** `docs/FAVO_PRD_v7.md`. Section numbers below (§9.2, §13.0 and so on) point into it.
**Written:** 3 Nov 2026, against `main`. Anything this page could not check in the repo is marked **to confirm with <name>**. Nothing here has been run against a live system.

---

## 1. Where we are

**Built and merged:** the web app (till, queue, customer app, admin, cost reports), the money chain against a *fake* terminal, the Docker image (built and published to GHCR by CI), the release migration step, and an in-app job scheduler.

**Not built:** the real Yoco Web POS connection. Today the live port is `unlinkedWebPosPort` (`src/server/tender/unlinked-port.ts`). Every card send fails as "no device linked", so nothing can be charged. The R1.00 test with the real terminal has not been run. The Transformate server, database, secrets, backups and `favo.hofmi.net` do not exist yet. OPEN-08 (who is on the hook if the server dies on a Sunday) is unanswered, and it is gate zero.

**Until all of this is done, Sunday card sales stay on the Yoco app on the physical machine.** That is safe and it is the status quo.

---

## 2. The ordered path

Do the steps in order. A step is done only when its "how to verify" is true.

| # | What | Who | How to verify | Blocker |
|---|---|---|---|---|
| 1 | **OPEN-08 answered.** Four questions to Matt (§16.2): the price against the expected under R500 a month; what the service fee covers; whether the server and database accounts sit in FAVO's or Transformate's name, and whether FAVO can take its data elsewhere; **who is on the hook if the server dies at 08:00 on a Sunday**. The fourth is the gate. | Nikao asks, Matt answers | Written answer to all four, kept in the repo or Jira. §16.2 says: no default, "do not record an assumed figure as a decision". | **This blocks everything below.** PR #262 is held for it. |
| 2 | **Provision the VM and Postgres on Transformate** (§9.2): an always-on VM, Postgres on the same host, empty. One instance, 512 MB working set, 768 MB burst. Timezone `Africa/Johannesburg`. There is no data migration; FAVO starts on a clean database (§13.0). | Matt (Transformate) | Nikao can reach Postgres directly (not through a pooler). `date` on the VM shows SAST. | Step 1. See gap G1 (the `auth` schema) before step 7. |
| 3 | **Secrets into Infisical** (names only, see section 4). Rotate the database password that was exposed in development, and issue new Yoco and VAPID keys (§13.0). The Yoco secret key lives in Infisical only (§9.10.2). | Nikao (Mia holds the Supabase and Yoco logins; to confirm with Nikao who enters which value) | Every "required" name in section 4 is present. No value appears in the repo, in logs or in chat. | Step 2 |
| 4 | **Backups and WAL archiving** (§9.4): continuous WAL archiving to encrypted off-site storage (RPO ≤ 5 minutes), nightly base backups kept per the 5-year rule. | Matt sets it up; Nikao witnesses | See step 5. | Step 2 |
| 5 | **Restore drill.** Restore the backup onto a fresh database and time it. The elapsed time is the first measurement of RTO (target ≤ 4 hours). A failed rehearsal alerts Nikao (§9.6.3). Re-do every quarter (§9.4). | Matt does it, Nikao signs | Restored database opens, row counts match, time written down. | Step 4. Note `docs/backup-restore.md` is stale (see G7). |
| 6 | **`favo.hofmi.net` through Cloudflare for SaaS** (§9.3). Transformate adds the custom hostname on *their* Cloudflare zone. FAVO adds one CNAME for `favo` and one validation record at Xneelo. **The `hofmi.net` zone stays at Xneelo. Google Workspace MX is never touched. No zone move, no nameserver change.** Set `AUTH_URL` and `PUBLIC_BASE_URL` to `https://favo.hofmi.net`. | Matt (their zone) and Nikao or Mia (the Xneelo records; to confirm with Mia who holds the Xneelo login) | Run `dig +short MX hofmi.net && dig +short NS hofmi.net && dig +short favo.hofmi.net` **before and after**. MX unchanged, NS still Xneelo, `favo.hofmi.net` resolves, certificate valid. "Anything else is a stop." (§9.3) | Step 2. DNS change at Xneelo. |
| 7 | **Deploy the GHCR image and run the first migration.** See section 3 for the exact commands and rule. | Nikao | Container logs show `[migrate] done` then the server starts. `/api/healthz` is green (step 9). | Steps 2, 3, 4/5 (a verified backup). Gaps G1 to G4. |
| 7a | **First load** (§13.0). After the first migration, on the empty database: `read -rs FIRST_ADMIN_PIN; export FIRST_ADMIN_PIN`, then `docker run --rm -e DATABASE_URL -e FIRST_ADMIN_PIN <image> bun first-load.js` (see section 3). It loads **no stock**: do a **physical stock-take** at `/admin/stock-takes`. Then verify the seed per §13.0 before trading. | Nikao | Output lists the row counts, the active menu with prices, the lots costed `0.0000`, the placeholder supplier names, the NO OPENING STOCK line and the ESTIMATES line. The admin signs in at `/staff/login` with the PIN. A stock-take is closed. | Step 7 |
| 8 | **Merge PR #262 (AT-168) in the same change that points `DATABASE_URL` at the direct Postgres.** It removes `prepare: false` from `db/index.ts`, makes the queue stream and the migrator use `DATABASE_URL`, and makes the container **refuse to start if `DATABASE_URL_SESSION` is still set**. So delete `DATABASE_URL_SESSION` from Infisical in the same step. Before #262, set both URLs to the same direct URL. Never point either at a port-6543 pooler once #262 is in. | Nikao (Mia reviews, Tier B) | App boots, `/api/healthz` is green, and any page that reads the database loads. | OPEN-08, and PR #261 (AT-170) is the base per the #262 description (to confirm it is merged; the migration step is already on `main`). |
| 9 | **Scheduler and healthz.** See section 5. | Nikao | `[scheduler] started: checkLowStock` appears in the container log after boot. | Step 7 |
| 10 | **Queue stream through the edge for at least 4 hours** (§9.8, §13.0). A local test that bypasses Cloudflare does not count. This is the gate the old host failed. | Nikao with a real tablet | Tablet open on the queue for 4 hours, no stale board. | Steps 6, 8 |
| 11 | **Customer sign-in (Supabase Auth).** Customers still sign in through Supabase Auth (§9.5.2). Needed: the Supabase project URL and anon key, passed to the image build as the public build values (section 4). In the Supabase dashboard, add the `favo.hofmi.net` redirect for password reset (to confirm with Mia). | Mia (Supabase dashboard); Nikao (GitHub repository variables) | A test customer registers, signs in and resets a password on `https://favo.hofmi.net`. | Step 6. Gap G1 (the customer link to Supabase). |
| 12 | **Push notifications (VAPID).** Make one key pair. The public half goes in the image build; both halves go in Infisical. | Nikao | A test device subscribes and receives an "order ready" push. | Step 6 |
| 13 | **The Yoco adapter, then FACT-1 and the R1.00 test.** The real HTTP adapter must be built. The plan puts it with **Nikao** (to confirm with Nikao). It replaces `unlinkedWebPosPort` in `src/server/tender/runtime.ts`. Only the adapter may touch Yoco's raw response and it must drop the masked PAN (§9.10.2). Then, at gate zero (§13.0, §6.8.2): generate the Yoco API key, create the Web POS device `FAVO Till`, link the Khumo, send R1.00, run the five follow-on steps. FACT-1 (how a terminal is linked to a Web POS device) is the one genuine unknown. FACT-2 (the supported model list) is settled by the device lookup. Put the device id in `app_config.webpos_device_id` (§9.10.1), not in an environment variable. | Nikao builds. Mia and Nikao at the counter with the real Khumo. **Claude cannot** (never touches live Yoco). | One R1.00 payment sent from FAVO, taken on the Khumo, status fetched back as successful. The unresolved-payment and error paths exercised (§6.8.4). | Steps 3, 7. A Yoco answer on FACT-1 if self-service linking fails (a delay, not a reversal, per §16.2). |
| 14 | **Offline audit** (§13.0, §13.4): the physical drill, not only the CI test. Also record the four §05.1 timings through the edge. | Mia and Nikao | Drill notes recorded. | Steps 6, 10 |
| 15 | **Barista drill (AT-195).** | Mia with a barista | Per the AT-195 ticket (to confirm with Mia; the ticket is not in this repo). The build plan's training bar is a 20-minute walkthrough, a solo weekday shift, then ten consecutive paid Sunday orders supervised but not helped (`build-plan/00-overview-and-roadmap.md`, Phase GL). | Steps 13, 14 |
| 16 | **Two real trading weekdays (AT-196).** Weekday coffee is free and has no payment step, so this proves the till, stock and day-close without card risk. | Mia, baristas | Both days closed (a `daily_closes` row for each). Stock deductions look right. | Step 15 |
| 17 | **Friday go/no-go (AT-197).** Written down, both names on it. If the training tests have not passed, the 4-hour queue hold has not been shown that week, the card machine is not proven, or the backup restore is not verified, then Sunday runs on the Yoco app (`build-plan/00-overview-and-roadmap.md`, Phase GL). | Mia and Nikao | A signed note. | All of the above |
| 18 | **Sunday-sweep decision.** Pending with Nikao. The repo only says the dormant-fund sweep is an Admin action and never a timed job (`build-plan/02-nikao-tasks.md` N5.4.3, §12.3). The exact decision awaited is **to confirm with Nikao**. | Nikao | Decision recorded. | None. Does not gate the order above unless Nikao says so. |
| 19 | **Sunday card sales move off the Yoco machine** only after steps 13 to 17 pass and the Web POS has been drilled. | Mia and Nikao | First Sunday run supervised, with the Yoco machine kept as fallback. | Step 17 |

---

## 3. The image, the first migration, and the approval rule

**What CI publishes.** On every push to `main`, `.github/workflows/docker-publish.yml` builds the image and pushes it to GHCR as `ghcr.io/heritage-of-faith/favo-webapp:latest` and `:<commit sha>`. It deploys nothing itself. The push fails if the repository variables `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` are empty. On pull requests it builds and smoke-tests that the scheduler starts, but pushes nothing. Pull the **sha tag**, not `latest`, so rollback is exact.

**What the container does on start** (`docker-entrypoint.sh`): runs `bun /app/migrate.js`, and only if that exits 0 starts `bun /app/server.js`. A failed migration means the server never starts.

**Migration ahead of the swap (optional):** `docker run --rm <image> bun migrate.js` (needs the same environment variables).

**First load (on the empty database, after the first migration):** `read -rs FIRST_ADMIN_PIN; export FIRST_ADMIN_PIN` (or take it from Infisical), then `docker run --rm -e DATABASE_URL -e FIRST_ADMIN_PIN <image> bun first-load.js` (`scripts/first-load.ts`). `-e NAME` with no value passes it from the shell, so the PIN is never typed on the command line or kept in history. It loads the menu (the five live items plus legacy items kept inactive, not shown at the till), inventory items, customisations, lot cost rows, recipes, operating hours and event profiles from `db/seed/`, then creates one active admin named `Admin` if `staff` is empty (if not, it lists the existing staff names and roles). It loads **no opening stock** and not the two orphaned lots (`lot_espresso_beans_001`, `lot_whole_milk_001`, §7.0.1b): do a **physical stock-take** at `/admin/stock-takes` before trading. Several lot supplier names are placeholders and the rest are unchecked seed names; the output lists them. It does **not** load the dev staff (known PINs), demo customers, demo transactions or stock alert recipients (that seed names a dev staff row). It refuses, writing nothing, if `DATABASE_URL` is unset, if `orders` has any row (trading has started), or if `FIRST_ADMIN_PIN` is unset, not 4 to 6 digits, one of `1234`, `2345`, `4321`, `1111`, `0000`, `123456`, or one digit repeated. Every step is idempotent, so it is **safe to re-run until the first order**: a run that failed partway is finished by running it again. **Baristas are added afterwards by the admin at `/admin/staff`** (`createStaff`, `src/server/actions/staff.ts`). Low-stock alert recipients are set at `/admin/inventory/recipients` once the baristas exist. Before trading, check against §13.0: the Chai Latte price (the seed has R25, §7.0.1 says R20 unconfirmed), the three alternative milks (seeded at `0.0000`) and the bean cost.

**The exact approval rule** (`scripts/migrate.ts` header and `src/server/deploy/migration-approval.ts`):

- A pending migration is **refused** (before any SQL runs) if its leading comment block holds `-- favo:requires-approval` **and** `FAVO_APPROVE_MIGRATION` does not name its exact tag.
- Also refused, as a backstop, if it is numbered 34 or higher (`GATED_FROM_IDX = 34`) and matches a risky pattern (a DROP, a column type change, DELETE, TRUNCATE, UPDATE ... SET, or anything naming `payments`, `orders` or `order_items`).
- `FAVO_APPROVE_MIGRATION` is a comma-separated list of exact tags, for example `0043_at201_tender_payments`. One approval does not cover a later risky migration.
- The operator takes and **verifies a full backup first** (header of `migration-approval.ts`).
- After it applies, **remove** the variable. The migrator warns if it names a migration that is not pending.
- All pending files apply in one transaction. A failure rolls back and leaves the database as it was.

**Migrations marked `-- favo:requires-approval` right now** (computed with `grep -l 'favo:requires-approval' drizzle/*.sql`):

`0036_at204_event_sessions`, `0042_l28_notification_target`, `0043_at201_tender_payments`, `0044_at201_orders_client_uuid`, `0045_at209_comps_cancel_abandon`, `0046_at203_blessing_fund`, `0047_at202_order_item_surcharge`, `0048_at207_daily_closes_writeoffs`, `0049_at174_drop_refunds`, `0050_at203_fund_abandon_revenue`.

On a brand-new empty database **all ten are pending in one run**, so the first deploy needs `FAVO_APPROVE_MIGRATION` listing all ten tags. CI does the same on its throwaway database. Re-run that `grep` on the release day, because new migrations may have landed. A backup is of an empty database on the first run, so "verified backup" then means the backup tooling works (step 5).

**Emergency only:** `SKIP_MIGRATIONS=<the image's own commit sha>` skips the migrator. Any other value is ignored with a warning, so it expires on the next deploy. Use only against a database repaired by hand.

---

## 4. Environment variables

Names only, never values. Found with `grep -rhoE "process\.env\.[A-Z0-9_]+" src db auth.ts proxy.ts scripts next.config.ts`, then each checked in the source. **Line numbers are from `main` today.**

**Required in production**

| Group | Name | Where it is read |
|---|---|---|
| Database | `DATABASE_URL` | `db/index.ts:5` |
| Database | `DATABASE_URL_SESSION` (until #262; then it must be **unset**) | `scripts/migrate.ts` via `startup-checks.ts:8`; `src/server/queue/broker.ts:28`; `src/app/api/healthz/route.ts:96` |
| Staff login | `AUTH_SECRET` | `auth.ts:33`, `auth.ts:52` (throws if unset) |
| Staff login | `AUTH_URL` | not read in `src/`; Auth.js reads it. Listed in `.env.example` and `docs/production-env-checklist.md`. PRD §13.0 says set it. |
| Public URL | `PUBLIC_BASE_URL` | `src/app/layout.tsx:16` (falls back to `https://favo.hofmi.net`); `src/server/actions/customer-auth.ts:330` (**no fallback**: reset-password link would read `undefined/reset-password`) |
| Customer sign-in | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | **Build-time** values baked into the image (`Dockerfile` build args). `customer-session.ts:11` throws in production if missing. |
| Push | `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | `src/server/push/vapid.ts:12-13` (throws when a push is sent if unset) |
| Card payments | `YOCO_SECRET_KEY` | `src/server/actions/orders.ts:794`, `src/app/pos/queue/page.tsx:32`. See G5: if **unset**, the payment gate is bypassed. |
| Clock | `TZ=Africa/Johannesburg` | Set in the `Dockerfile`; PRD §9.2 |

**Optional**

| Name | Where | Note |
|---|---|---|
| `SCHEDULER_ENABLED` | `src/server/jobs/start.ts:13-15` | Unset means ON in production |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | `Dockerfile` build arg; `vapid.ts:23` | Build-time. Falls back to `VAPID_PUBLIC_KEY` on the server; if empty the browser shows push as "not configured" |
| `FAVO_APPROVE_MIGRATION` | `migration-approval.ts:20` | Per deploy only, see section 3 |
| `FIRST_ADMIN_PIN` | `src/server/first-load/guards.ts` via `scripts/first-load.ts` | First load only (step 7a). Not needed by the running app |
| `SKIP_MIGRATIONS` | `startup-checks.ts:102` | Emergency only |
| `IMAGE_SHA` | `Dockerfile` build arg; `scripts/migrate.ts:143` | Set by CI |
| `MIGRATIONS_FOLDER` | `scripts/migrate.ts:57` | Defaults to `./drizzle` |
| `LOKI_URL` | `src/app/api/healthz/route.ts:63` | Leave **unset**. If set and unreachable, healthz fails (G4) |
| `TRUSTED_PROXY_HOPS` | `src/server/client-ip.ts:34` | Default 1. Right hop count behind Cloudflare plus Transformate's proxy: **to confirm with Matt** |
| `TRUST_CF_CONNECTING_IP` | `src/server/client-ip.ts:62` | Only `1` turns it on. Rate-limit key quality: **to confirm with Matt** |
| `TEST_AUDIT_SECRET` | `src/app/api/admin/audit-coverage/route.ts:10` | Keep **unset** in production (route returns 403) |
| `NODE_ENV`, `NEXT_RUNTIME` | `next.config.ts:28`, `src/instrumentation.ts:7` | Set by Next and the image |

**Dev / one-off only (not needed in production):** `DEMO_SEED_CONFIRM` (`db/seed/demo-transactions.ts:90`), `VERIFY_TEST_COUNT` (`scripts/verify-v7.ts:381`).

**Unclassified** (listed in `.env.example` but **not read by any code** in `src db auth.ts proxy.ts scripts next.config.ts`; to confirm with Nikao whether to delete them): `YOCO_WEBHOOK_SECRET` (PRD §9.6: no webhook is subscribed), `HOFMI_SSO_CLIENT_ID`, `HOFMI_SSO_CLIENT_SECRET`, `HOFMI_SSO_ISSUER`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `R2_ENDPOINT`, `RAINDROP_TOKEN`, `NEXT_PUBLIC_STAGING`. Also `AUTH_TRUST_HOST`, which Auth.js may need behind a proxy; **to confirm with Nikao** (see G6).

---

## 5. Scheduler and healthz

**Scheduler.** It runs inside the app (`src/instrumentation.ts` calls `startScheduler()` at server start). Unset `SCHEDULER_ENABLED` means on in production. It runs on SAST regardless of the container clock. One instance only: a restart inside a job's window means that run simply does not happen (§9.6.2), except jobs that catch up on startup.

PRD §9.6.2 is the register of record and lists **seven** jobs. (§9.6.1's dependency table and §16.1 say "six". That is a known mismatch inside the PRD, not an error to fix here. The register wins.)

| # | Job (§9.6.2) | Schedule | In the code today (`src/server/jobs/registry.ts`) |
|---|---|---|---|
| 1 | checkLowStock | every 15 min | Wired |
| 2 | closeDaily | 00:05, catch-up on startup | Wired, plus a 06:00 missing-close alert |
| 3 | generateWeeklyPnL | Monday 06:00, catch-up | Wired |
| 4 | Unconfirmed-payment reconciliation | every 15 min | **Not wired** (file says deferred) |
| 5 | `collected` sweep | every 5 min | Wired |
| 6 | importYocoTransactions | 06:00, catch-up | **Not wired** |
| 7 | Donor-fund dormancy check | daily 06:30 | **Not wired** |

So **today four of the seven are live**. Jobs 4, 6 and 7 must land before they are relied on; job 4 matters once real card payments exist. **To confirm with Nikao** which are required before the first Sunday on FAVO. No job may start a payment or create revenue (§9.6.2 rule 2).

**Healthz** (`GET /api/healthz`, cached 5 seconds). Returns 200 only if Postgres answers `SELECT 1`, `DATABASE_URL_SESSION` is set (this "sse_config" check proves only that it is set, not that the queue stream connected), and Loki is reachable *or not configured*. **Yoco is shown but advisory**, so a Yoco blip will not fail the check. Expect `{"ok":true,...}` with `checks.loki.reason: "not configured"`. After #262, `sse_config` keys off `DATABASE_URL` instead. Transformate's monitoring should poll this URL (§9.8); who wires that: **to confirm with Matt**.

---

## 6. What Claude can and cannot do

| Claude can | Claude cannot |
|---|---|
| Write and review code, tests, migrations (down files), and docs. Draft PRs for Nikao and Mia to review. | Touch production, the Transformate server or database. |
| Read the repo and CI results. | Change DNS, Cloudflare, Xneelo, or Google Workspace. |
| Compute lists from the repo (for example the migrations needing approval). | See, enter or rotate any secret (Infisical, Supabase, Yoco, VAPID). |
| | Call the live Yoco API or run the R1.00 test. |
| | Approve a migration, merge a Tier A PR, or sign the go/no-go. |

---

## 7. If it goes wrong

| Problem | What to do |
|---|---|
| **Bad image** | Start the previous image by its **sha tag** (see the GHCR package list). If the database is ahead of that image the migrator allows it with a warning and applies nothing; that older image's code must tolerate the newer schema (`scripts/migrate.ts`). |
| **A migration needs undoing** | Each migration from `0033` to `0050` has a hand-run down file in `drizzle/down/` (`0040` is absent from the journal and has none; to confirm with Nikao that this is intended). Run it by hand, in a transaction, against a database at that migration. Down files for migrations that drop data cannot bring the data back. Restore from backup for that. Migrations before `0033` have **no** down file in the repo. |
| **Migration refused at boot** | Read the `[migrate] FATAL` line. If it asks for approval, check the backup, then set `FAVO_APPROVE_MIGRATION` to the named tag(s) for this deploy only. |
| **Database lost or corrupt** | Restore from the WAL archive to a point in time (RPO ≤ 5 min, RTO ≤ 4 hours, §9.4). The café runs on paper meanwhile. The exact restore commands depend on what Matt builds in step 4: **to confirm with Matt**. |
| **Card machine or Yoco down on a Sunday** | Sunday card sales stay on the Yoco machine until step 19, so this cannot hurt them before then. After step 19: deferred mode (§9.6.1). |
| **Server dies on a Sunday** | Paper for the day (§9.6.1). Who fixes it and how fast is exactly what OPEN-08 question 4 must answer. |

---

## 8. Gaps found that could stop the image starting, or break the first day

These were found by reading the repo. **Reported, not fixed.**

| # | Gap | Evidence | Owner to confirm |
|---|---|---|---|
| G1 | **Migration `0013` needs a Supabase-style `auth.users` table.** On a clean Postgres without an `auth` schema, the first migration run fails at 0013 and the container never starts. CI creates a stub for this ("Supabase auth schema stub (CI only)", `ci.yml`). Customers also link to it by foreign key (`customers.auth_id`), but customer sign-in lives in Supabase (§9.5.2), so a stub in the Transformate database would not contain real customer ids. **Fixed (fix/m-migrations-clean-postgres):** 0013 now adds the FK only when `auth.users` exists, and CI step "Migrate a clean database with no Supabase auth schema" proves a clean run. | `drizzle/0013_loving_gamma_corps.sql:6`; `.github/workflows/ci.yml` | Nikao |
| G2 | **`0023` creates a role `favo_customer` and grants it to the connecting role.** The connecting role needs permission to create roles on Transformate's Postgres. | `drizzle/0023_rls_customer_isolation.sql:34,46` | Matt |
| G3 | **Nothing in the image seeds the database.** The menu, prices, recipes and ingredient costs (§13.0) come from `bun db/seed/index.ts`, which needs source and node_modules that the image does not carry. `package.json` has `db:seed` only. **Fixed (feat/m-image-first-load):** the image now carries `first-load.js` (`scripts/first-load.ts`); see step 7a and section 3. | `Dockerfile`; `package.json:24` | Nikao |
| G4 | **While #262 is unmerged, boot needs both `DATABASE_URL` and `DATABASE_URL_SESSION`** or the migrator exits. After #262 the opposite: leaving `DATABASE_URL_SESSION` set stops the container. Healthz also fails if `LOKI_URL` is set but unreachable. | `scripts/migrate.ts:64`; #262 diff; `healthz/route.ts:99` | Nikao |
| G5 | **`YOCO_SECRET_KEY` unset turns the payment gate off.** The order-state change skips the payment check when it is missing ("dev/simulation mode"). If production were started without it, paid orders could advance with no payment. If it is set while the port is `unlinkedWebPosPort`, card sends fail as "no device". Either way Sunday cards stay on the Yoco machine until step 13. | `src/server/actions/orders.ts:786-794` | Nikao |
| G6 | **No `trustHost` / `AUTH_TRUST_HOST` anywhere in the repo.** Auth.js v5 generally needs one of these (or `AUTH_URL`) when running behind a proxy outside Vercel. Not tested. | grep of `*.ts`, `*.md`, `*.yml` found none | Nikao |
| G7 | **`docs/backup-restore.md` is out of date.** It describes Supabase point-in-time recovery, RPO 24 h and RTO 2 h. PRD §9.4 says RPO ≤ 5 min, RTO ≤ 4 hours, WAL archiving on Transformate. `docs/deploy-runbook.md` also still describes the older Coolify and Vercel-era flow. Use this page and the PRD instead. | `docs/backup-restore.md`; `docs/deploy-runbook.md` | Nikao |
| G8 | **The Dockerfile has no `HEALTHCHECK`.** Not a start blocker. Whether Transformate's monitoring polls `/api/healthz` is unconfirmed. | `Dockerfile` | Matt |
| G9 | **Push subject is hard-coded to `mailto:ops@hofmi.org`.** PRD §9.3 says `hofmi.org` has never existed. Some push services may reject or ignore an undeliverable contact. | `src/server/push/vapid.ts:8` | Nikao |
| G10 | **Jobs 4, 6 and 7 are not wired** (section 5). | `src/server/jobs/registry.ts:6-9` | Nikao |
| G11 | `docker-entrypoint.sh`, the `migrate.js` bundle and the standalone `server.js` are all copied into the runner stage and the entrypoint is executable. No missing step found there. | `Dockerfile`, `docker-entrypoint.sh` | none |
