# CLAUDE.md — FAVO Café

Repo: `github.com/Heritage-Of-Faith/Favo-WebApp` · Stack: Next.js 16 / React 19 / TS strict / Drizzle / Postgres / Bun
**This file replaces the previous one.** PR #238 already repointed it from `FAVO_PRD_v3.md` to `docs/FAVO_PRD_v7.md` — that change is kept and carried forward here. What this version adds is the verified trap list, the live defects with line numbers, the invariants and the standing prohibitions. It also drops the old `favo.hofmi.org` deploy target, which never existed.

Every factual claim below was verified against `main @ 7ec038c` on 22 Sep 2026. Line references are real. If a claim here contradicts what you find in the code, **the code wins and this file is stale — say so rather than working around it.**

---

## 1. The specification of record

**`docs/FAVO_PRD_v7.md` is the spec. Nothing else is.**

Superseded, and present in the repo as traps: `docs/FAVO_PRD_v3.md`, `docs/FAVO_PRD_v4.md`, `FAVO_PRD_v5.md` (repo root — Mia's 19 Aug upload, commit `9aefc2c`), `docs/PRD_REVISION_TRUE_NORTH.md`, `docs/FAVO_Phase2_Build_Plan.md`, `docs/FAVO_Phase3_Build_Plan.md`. Several source files cite v3 in their header comments (e.g. `src/server/cogs/compute.ts:1`). Those comments are wrong; do not treat them as authority.

**Appendix C of `docs/FAVO_PRD_v7.md` is the register of record** — 148 normative Given/When/Then rows: REQ-001…071 (till/payments), REQ-101…135 (cost), REQ-136…177 (new in v7.0). Every ticket cites its REQ IDs. If work does not map to a REQ ID, ask before building it.

> **Counting the rows:** all **148** are present in `docs/FAVO_PRD_v7.md`. Note that **REQ-118** is the one row whose ID is written in bold (`| **REQ-118** |`) while every other row is plain, so a naive `grep '^| REQ-'` returns 147 and looks like a gap. It is not one. Use `grep -oE '^\| \*{0,2}REQ-[0-9]+'` when counting.

**Where v7.0 reverses an earlier draft, v7.0 wins.** The six reversals are listed in the build plan's §1.4; the two that bite in code are called out in §3 below.

### Current conformance, measured 22 Sep 2026
**DONE 12 · PARTIAL 25 · ABSENT 110 · DELETE 1**, of 148. The repo is a working café app built to v3, not a v7 app. Assume a requirement is absent until you have grepped for it.

---

## 2. Stop and ask — do not proceed on your own judgement

1. **Any change to how money is computed, rounded, stored or displayed.** Cite the REQ and the PRD line, and wait.
2. **Any migration touching `payments`, `orders` or `order_items`.**
3. **Anything that would create or delete a scheduled job**, or change when one runs.
4. **The `customers.name` / surname question** (REQ-142). `customers` has one `name` column; the PRD wants a surname beside the given name and does not add a column. This is an owner decision and it sits inside a migration.
5. **Anything that assumes a deploy target other than Transformate**, or that treats `infra/coolify/` as current. §9 is the plan of record.
6. **Anything you were about to describe as "missing", "unspecified" or "not in the PRD.”** Read the raw PRD section first. A previous analysis reported §7.0.2's cost formulas as unspecified because it read a truncated summary; the claim was escalated and had to be retracted. **The ingredient-costing question is CLOSED. Do not reopen it.**

---

## 3. Traps — verified things that look like work and are not

| Do not | Because |
|---|---|
| **Do not create an `order_items.qty` column** | `quantity` already exists as `integer NOT NULL DEFAULT 1` (`db/schema.ts:264`). Only `CHECK (quantity >= 1)` is outstanding. |
| **Do not re-implement modification-awareness in `deductForOrder()`** | Shipped in `0027_at145_customisation_inventory_effects.sql`; live in `src/server/orders/deduction.ts` under the AT-145 block, resolving `substitutesInventoryItemId` and `addsInventoryItemId + addsQuantity`. |
| **Do not narrow `opening_sessions` to one session per day** | `0029_at134_opening_sessions.sql:11` has `UNIQUE(session_date, opens_at)` and **v7.0 keeps it.** A v6.0 draft proposed narrowing to `UNIQUE(session_date)`; v7.0 reverses that. The only new object is a partial unique index over `closed_at IS NULL`. |
| **Do not migrate `inventory_lots.unit_cost_zar` to integer cents** | `numeric(10,4)` at `db/schema.ts:170` is the one deliberate exception to integer-cents, and it is correct. Sub-cent costs are real (`db/seed/lots.ts:96` = `0.1800`). |
| **Do not multiply by 100 in `recordTenderResult`** | Yoco's Web POS amounts are already cents. |
| **Do not add `voided` to `payments.status`** | Yoco documents refunds and documents no void. §10.6 forbids reports defaulting on an unknown value, and a state FAVO can never observe is a state FAVO would guess at. |
| **Refunds are live code, not stubs** | `refunds` table (`db/schema.ts:285-294`), `refundStatus` enum (`db/enums.ts:71-75`), `paymentStatus` value `"refunded"`, a real `POST https://payments.yoco.com/api/refunds` in `src/server/yoco/client.ts:72`, and a `refund.succeeded` webhook branch (`src/app/api/payments/yoco/webhook/route.ts:131-137`). L02 says no refunds ever — **all of it comes out.** Do not report it as already absent. |
| **`retry-deferred` is two files** | `src/server/crons/retry-deferred-payments.ts` (127 lines) **and** `src/app/api/crons/retry-deferred/route.ts` (18 lines). Removing only the first leaves a route importing nothing. |
| **Only TWO files write `sync_conflicts`, not four** | Writers: `src/server/sync/apply-outbox.ts:93,120` and `src/server/crons/retry-deferred-payments.ts:94`. `src/app/api/sync/orders/route.ts:55` breaks at typecheck only because the `ApplyOutboxResult` union loses its `conflict` variant. `src/hooks/useOfflineOutbox.ts:73` breaks nothing — it needs editing solely to satisfy the PRD's literal grep gate. |
| **Do not "keep" `0023_rls_customer_isolation.sql` re-runnable** | It GRANTs and policies `wallet_transactions` (`:64,:80,:125-129`), which `0026` drops, plus `loyalty_transactions` and `coffee_packs`, which v7 drops. It is **not** idempotent against a post-drop database despite its own comment at `:23`. |
| **The wallet is already gone** | `0026_at141_remove_wallet.sql` dropped the table, the CHECK, `customers.wallet_zar` and the enum. `src/` and `db/` contain **zero** occurrences of "wallet". What remains is comments and test fixtures — a docs sweep, not code. |
| **`applyStaffDiscount`'s signature is NOT buggy** | It really is `applyStaffDiscount(orderId, beneficiaryStaffId)` (`src/server/actions/orders.ts:566-569`), and the beneficiary is correctly separate from `appliedByStaffId` (`:606`) and the audit `actorId` (`:635`). The daily limit is race-safe via the DB UNIQUE + `onConflictDoNothing`. **The live defect is the table it writes to (§4), not the signature.** |
| **`rbac.ts:20`'s unused `role` is cosmetic** | `canProcessOrders(role)` returns `true` unconditionally and is called only from tests. Real POS gating is `authorize(...POS_ROLES)` via `src/server/auth/guard.ts:17`. Delete or inline it; it is not a security finding. |
| **`prepare: false` stays — *until the move, and not after*** | `db/index.ts:10`. Required today for Supabase's PgBouncer transaction pooler; removing it now breaks every query. But §9.2 targets a **direct connection to a co-located Postgres on Transformate**, where the workaround is **removed and prepared statements re-enabled**. So: do not delete it early, and do not preserve it through the migration. It goes in the same change that switches the connection. |
| **If FIXTURE-A computes R144.36 instead of R144.37 — STOP** | Do not adjust the test. The fixture is the spec. Report the discrepancy and wait. |

---

## 4. Live defects — real, verified, and on the critical path

These are not traps. They are things that are wrong in production behaviour today.

1. **`next.config.ts:13` — `typescript: { ignoreBuildErrors: true }`.** The production build does not typecheck. **Remove this before any deletion work.** Until it is gone, `bun typecheck` in CI is the only thing between a half-deleted codebase and production, and CI does not deploy.
2. **The free weekday cup cannot be given to office staff.** `staff_entitlement_log.staff_id → staff.id` (`db/schema.ts:333`) points at the 3-row barista table; the ~63 office staff are `customers` rows. The FK rejects them. It is driven from a free-text input (`src/components/pos/ActiveOrder.tsx:193-198`, placeholder `e.g. staff_barista_sam`) with no eligibility lookup. Needs `customers.status` (`office_staff | church_member`) and a re-keyed table.
3. **The entitlement zeroes the whole order.** `src/server/actions/orders.ts:619` sets `totalZar: 0`. L03/REQ-115: exactly one unit of one eligible line. Today a staff member's second paid drink is also free.
4. **`createOrder` mints a payment for every order regardless of total.** `orders.ts:193` creates the Yoco checkout, `:203` inserts `payments` — unconditionally. REQ-153: a net-R0 order writes no payment row and sends nothing to a terminal.
5. **Payment-send ordering is reversed.** `orders.ts:180-201` runs the Yoco create *concurrently with* the order transaction and inserts `payments` afterwards. REQ-026: "never the reverse order." The comment at `:176-179` treats this as a latency win; it is the failure v7 names.
6. **All Yoco send errors collapse to one.** `orders.ts:195-201` catches everything to `null`. REQ-010 forbids conflating `GATEWAY_UNAVAILABLE` (retryable) with `PAYMENT_UNKNOWN` (never retried), in code or in copy.
7. **A declined card cancels the order.** The webhook's `payment.failed` branch sets `orders.state='cancelled'`. REQ-004/S3 exists precisely to stop this: the order stays `ordered`, keeping its queue position and bound target.
8. **Two route gates coexist; only one runs.** `proxy.ts:13-38` checks the role; `src/middleware.ts:5-73` checks only `if (!session?.user)` and also carries the Supabase refresh. Either any barista reaches `/admin`, or customer sessions expire mid-visit. Resolve to one file.
9. **`loginWithPin` has no rate limit and no identity claim.** `src/server/actions/auth.ts:22-80` takes a bare 4–6 digit PIN and bcrypt-loops every active staff row (`:31-38`). `checkRateLimit` exists (`src/server/rate-limit.ts:14`), is tested, and is used on the customer path at `customer-auth.ts:61,185,279` — but not here.
10. **No session `maxAge`.** `auth.ts:100` is `session: { strategy: "jwt" }`. NextAuth's 30-day default applies to a tablet on a café counter.
11. **`NEXT_PUBLIC_YOCO_PUBLIC_KEY` is in the client bundle.** `POSWorkspace.tsx:111`, `YocoPayment.tsx:30,74`, `YocoOrderForm.tsx:77`. REQ-071 permits no Yoco key of any kind client-side.
12. **COGS rounds per period, not per order.** `drizzle/0004_cogs_views.sql:25` is `ROUND(SUM(...))` grouped by day; `monthly-pnl.ts:140` per month; `export-csv.ts:51` per day; `generate-weekly-pnl.ts:74` per week. REQ-106: one rounding point, half-up, at `order_cogs`, per order. There is no `order_cogs` anywhere.
13. **Absent cost inputs are silently dropped.** `0004_cogs_views.sql:29` — `AND il.unit_cost_zar IS NOT NULL`, replicated in three report files. §7.0.2 calls the refusal rule "NOT OPTIONAL". Today a missing input makes profit look *better*.
14. **Net renders green on estimated costs.** `CogsDashboard.tsx:248` keys tone off `netZar >= 0` alone; `generate-weekly-pnl.ts:115` prints "✅ Profitable". The seed data is entirely estimates, so this is the default state. §7.0.1b: `--status-warn`, never `--status-success`.
15. **Cups and lids deduct on weekdays.** `deduction.ts:146-194` iterates every recipe ingredient unconditionally. REQ-125: weekday `stock_movements` contain no cup or lid row — people bring their own mugs.
16. **`customers.email` and the full phone leave the server.** `src/server/actions/customers.ts:29-31` selects both and `:45-47` returns them. REQ-142 forbids it.
17. **There is no scheduler of any kind.** Four cron routes exist; nothing calls them. No `vercel.json` crons, no Coolify cron, no Actions `schedule:`, no cron dependency.
18. **There is no `Dockerfile`, and no `output: "standalone"`.** `infra/coolify/favo-app.yml:10` pulls an image nothing in this repo builds.
19. **The healthcheck restart-loops a working café.** `/api/healthz:41-49,99` ANDs Yoco and Loki reachability into the verdict, and `favo-app.yml:17` fails the container on it. Leave `LOKI_URL` unset; make Yoco advisory.
20. **`/api/admin/audit-coverage` is a test endpoint in the production app.** `route.ts:9-18` — no session check, access purely via a `?secret=` query param (so it lands in access logs). Keep `TEST_AUDIT_SECRET` unset in production, or delete the route.

---

## 5. Invariants — never violate, in any commit

- **Money is integer cents** in `_zar` columns. The single exception is `inventory_lots.unit_cost_zar` (`numeric(10,4)`).
- **Rounding happens exactly once**, half-up, at `order_cogs`. Every day, week and month figure is a sum of those integers.
- **Three render states stay distinct and are never conflated:** zeroes (a genuinely empty day) ≠ **UNAVAILABLE** (an input is absent — name the offending item) ≠ **provisional** (an input is estimated — never render it green).
- **No refunds.** L02. The remedy for a wrong charge is a comped drink next time.
- **No customer-initiated money-in.** The blessing fund is a named, non-refundable balance opened by staff against externally-proven money. No customer top-up path exists — not in the app, not by link, not by QR. **The word "wallet" appears nowhere** in code, comments, copy or tickets.
- **`outbox_log.client_uuid` UNIQUE is the offline idempotency guarantee.** It survives every refactor and every deletion pass.
- **A rejected state transition is audited.** Today `orders.ts:322-336` throws inside the transaction, so the rollback discards the audit row. That is a defect, not a pattern to copy.
- **No scheduled job may initiate a payment or create revenue.** §12.3. Job 7 writes an Admin task and nothing else.
- **Exactly two writers may set `payments.status`.** A cron is not one of them.

---

## 6. How to build a ticket

1. **Read the REQ rows it cites, in Appendix C, raw.** Not a summary of them.
2. **Grep before you build.** Assume absent, verify absent. Then say what you searched for.
3. **Write or confirm the acceptance assertion before the implementation.** For a money ticket, a human writes or checks it. Your job is not to make it pass; it is to make the behaviour right.
4. **Build.**
5. **Run `bun check`** (`typecheck && lint && test:unit`) and **`bun scripts/verify-v7.ts`**. Both green, or explain.
6. **Report the test count delta.** During the deletion pass it should fall; the band is 740–760 from a 942 baseline. A number outside the band is a finding, not a rounding error.
7. **In the PR body:** the REQ IDs, what you grepped for, the test-count delta, and anything you chose not to do.

**Never** change a test and the code it tests in the same commit without saying so in the first line of the commit message. That is the one diff a human must read.

---

## 7. Standing prohibitions — flag, do not build

Do not build these even if a ticket, an old document or a branch name asks for them. If something seems to require one, stop and ask.

- **The stored-value wallet.** Removed in `0026`, stays removed. The branch `feat/n-AT-114-w1w2-wallet-spend-ledger` exists on the remote; it is dead.
- **Loyalty points, earn, redemption.** Deleted by v7.
- **Coffee packs.** Deleted by v7.
- **Refunds, voids, reversals of a card charge.**
- **Discord anything.** The ops channel goes. But `formatZarField` and `pnlColor` in `src/server/discord/webhook.ts` are used for non-Discord formatting — rehome them, don't delete them.
- **A cron that writes `payments.status` or accrues anything.**
- **`sync_conflicts` and its admin resolution surface.** The offline outbox stays; the reconciliation layer goes.
- **Any customer-reachable route that increases a fund balance.**
- **A new "v8" or amendment document.** Changes go to v7.0 or they don't exist.

---

## 8. Who checks what

| Tier | Scope | Reviewer | Concurrency |
|---|---|---|---|
| **A** | Money, entitlement, auth, secrets, migrations touching `payments`/`orders` | Both Mia and Nikao, named on the PR, plus an adversarial agent pass | **1 in review at a time** |
| **B** | Other migrations, deduction, jobs, deploy config | One named reviewer + agent | 2 |
| **C** | Screens, copy, docs, deletions | `bun check` + `verify-v7.ts` are the gate | no cap |

The adversarial pass gets the diff and the REQ text, and **not** the conversation that produced the code. It answers one question: does this satisfy the Given/When/Then, or a paraphrase of it?

---

## 9. Project facts worth not re-deriving

- Single tenant. HOFMI, a church in Witbank/eMalahleni, South Africa. `TZ=Africa/Johannesburg` — a wrong TZ silently mis-buckets every revenue day.
- Three modes: **Weekday** (≈63 office staff, one free cup per person per day, own mugs, **no payment step at all**), **Sunday** (everyone pays by card), **Event/Social** (configured per event, occasional).
- Three baristas: Louis, Thandeka, Nkuli. They rotate the schedule. The app must be usable by them without a developer present.
- Not run for profit. Weekday coffee is free by design; Sunday only needs to not lose money.
- **Sunday card sales currently run on the Yoco app on the physical machine**, outside FAVO. That is the status quo and it is safe. It stays that way until the Web POS chain is built and drilled.
- The repo is **public**. Reads need no token; pushes need `gh auth login`.
- **The deploy target is decided and documented: §9 of the PRD.** An always-on VM on **Transformate** infrastructure with the Next.js server running continuously, **Postgres co-located on the same host** on a direct connection (no pooler), secrets in **Infisical**, public URL **`favo.hofmi.net`** via Cloudflare for SaaS custom hostnames — the `hofmi.net` zone stays at Xneelo and Google Workspace MX is never touched. `favo.hofmi.org` appears in the repo and **has never existed**. What is missing is the build artefact, not the decision: there is no `Dockerfile`, no `output: "standalone"`, no deploy workflow and no scheduler. `infra/coolify/` predates this and is not the plan of record.
- **OPEN-08 is open and it is gate zero.** Four questions are with Matt on the Transformate terms; the gate is the fourth — who is contractually on the hook if the server dies at 08:00 on a Sunday. §9.4 sets RTO ≤ 4 hours and RPO ≤ 5 minutes via continuous WAL archiving, and the PRD notes that RTO **has no contractually responsible party until OPEN-08 is answered**. Nikao ↔ Matt. Do not treat go-live as cleared while it is open.
- Two database URLs: `DATABASE_URL` (transaction pooler, :6543, used by `db/index.ts`) and `DATABASE_URL_SESSION` (session pooler, :5432, read only by `src/server/queue/broker.ts:28`). **Without the second, SSE degrades to heartbeats, the POS queue silently goes stale, and the container still reports healthy.**
- `AUTH_SECRET` signs both the Auth.js JWT and the PIN attestation HMAC (`auth.ts:33-34,:52`). Unset, `mintLoginAttestation` throws at boot.
- `CRON_SECRET` unset means every cron route 401s forever, silently.
- RLS (`0023`) is **not** `FORCE`, and protects only five customer reads in `src/server/actions/customer.ts` that opt in via `withCustomerScope`. Everything else runs as owner. Do not cite "RLS" as a system-wide POPIA control.
- v7.0 has two known internal defects; neither is yours to fix: §9.6.1 and §16.1 say "six" scheduled jobs where §9.6.2 (the register of record) lists **seven**; and Appendix D says the fund's counter top-up inherits R18 while R18's own row doesn't mention it.
