# FAVO Café — Build Plan · 05 · The two-week plan

**Rewritten 22 September 2026 against the real repo.** Every number below comes from reading `main @ 3902e61` and running its test suite — not from the PRD's account of itself. Where the 21 September version guessed, it guessed optimistically, and this version says where.

Claude writes all the code. Mia and Nikao review, decide and run the drills.

---

## 1. The honest answer, up front

**Full PRD v7.0 in two weeks is not possible. It is not close.**

All 148 Appendix C requirements, measured against the code:

| | Count | Share |
|---|---|---|
| **DONE** | 12 | 8% |
| **PARTIAL** | 25 | 17% |
| **ABSENT** | 110 | 74% |
| **DELETE** (exists; v7 removes it) | 1 | 1% |

| Range | Covers | DONE | PARTIAL | ABSENT |
|---|---|---|---|---|
| REQ-001…071 | Till, orders, queue, payments, Yoco | 5 | 17 | 48 (+1 DELETE) |
| REQ-101…135 | Cost, COGS, rollup, reporting | 6 | 6 | 23 |
| REQ-136…177 | New in v7.0 | 1 | 2 | 39 |

The repo is a *working café app*. It is not a v7 café app. What exists is real infrastructure — a live order queue, SSE, Web Push, a container-based inventory model, 942 green tests — built against **PRD v3**, whose money rules, mode rules and payment architecture v7 replaces.

**What two weeks can deliver: weekday service, live, on always-on infrastructure, done properly.** The 63 office staff ordering their free cup, order-ready push landing on the right phone, honest cost figures, dead features gone. Worth doing — and it is the half that never touches a card machine.

**What two weeks cannot deliver: Sunday card sales.** The repo's Yoco integration is the *online checkout* API with a webhook. v7 specifies the **Web POS** device API — poll and lookup, no webhook at all. That is a replacement of `src/server/yoco/`, and beneath it sits a terminal-linking step Yoco does not document (FACT-1). Sunday keeps running on the Yoco app on the machine, exactly as it does today.

Two weeks is achievable for weekdays **if** the deploy target is already decided and review keeps pace. Tight, not comfortable. §7 says what breaks it.

---

## 2. Where FAVO is right now

Verified 22 Sep 2026 on a fresh clone. `bun install` → `bun typecheck` → `bun lint` → `bun test:unit` all run clean: **942 tests in 101 files, 0 type errors, 0 lint errors, 6 unused-variable warnings, ~130 s.** That green baseline is real and worth protecting.

### The repo
| | |
|---|---|
| `origin/main` | `3902e61`, Thu 3 Sep 2026 — *"chore(sec): supply-chain hygiene"* |
| Commits since | none; `main` has been still for 19 days |
| Total commits / PRs | 269 / 237 |
| Migrations | 32, `0000` → `0031` |
| `9aefc2c` | Mia's 19 Aug upload of `FAVO_PRD_v5.md`. **Docs only.** So v7's technical chapters are one security commit out of date — nothing in them is stale. |

The repo **is public**, so Claude Code, CI and any reviewer can read it without a token. Write access still needs `gh auth login`.

### What genuinely exists and carries forward
Order queue with SSE over `LISTEN/NOTIFY`; Web Push with VAPID; the offline outbox with its `client_uuid` UNIQUE (the idempotency guarantee — protect this); the real container-purchase inventory model (`0030`, `0031`); modification-aware deduction (`0027`, `src/server/orders/deduction.ts`); stock takes; the `favos` saved-order table (`0028`); multi-session opening hours (`0029` — keep `UNIQUE(session_date, opens_at)`); RBAC guards; an append-only audit log (`0021`, `0025`); and a set of idioms the new work leans on — partial unique indexes, `SELECT … FOR UPDATE`, compensating-row cancellation.

`order_items.quantity` already exists as `integer NOT NULL DEFAULT 1`. `inventory_lots.unit_cost_zar` is already `numeric(10,4)` — the one sanctioned exception. `deductForOrder()` is already modification-aware. **Do not rebuild any of these.**

### The five findings that change the plan

**(a) The deploy target is decided; the artefact that would land on it does not exist.** §9 of the PRD — the hosting chapter contributed by Transformate, adopted 7 Aug, and the one chapter that came through two review runs without a correction — specifies an **always-on VM on Transformate**, **Postgres co-located on the same host on a direct connection**, secrets in **Infisical**, and **`favo.hofmi.net`** via Cloudflare for SaaS. That is settled and it is not a decision anyone needs to re-take.

What is missing is everything that would produce something to deploy: **no `Dockerfile` anywhere in the tree**, no `output: "standalone"` in `next.config.ts`, no deploy workflow, no production migration step, and no scheduler of any kind — four cron routes waiting for a caller that does not exist. `infra/coolify/favo-app.yml:10` pulls `ghcr.io/heritage-of-faith/favo-webapp:latest`, an image nothing in this repo builds; it predates §9 and is not the plan of record. Its healthcheck also **ANDs in Yoco and Loki reachability** (`favo-app.yml:17` → `/api/healthz:99`), so a Yoco blip would restart-loop a working café — worth not carrying forward.

One migration detail that must not be missed: `db/index.ts:10` sets `prepare: false` for Supabase's PgBouncer. On a direct connection that workaround is **removed and prepared statements re-enabled**. It goes in the same change that switches the connection — not before, not after.

**(b) `next.config.ts:13` sets `typescript: { ignoreBuildErrors: true }`.** The production build does not typecheck. With ~4,700 lines of deletions coming, this is the most dangerous line in the repo: a half-finished deletion builds green with live type errors in it, including in the offline path. **Removing it is task one of day one.**

**(c) The product's core promise is broken at the data model.** The free weekday cup writes to `staff_entitlement_log.staff_id → staff.id` (`db/schema.ts:333`) — the *barista* table, 3 rows. The 63 office staff are `customers` rows with no `staff.id`, so the insert cannot succeed for them. It is driven from a free-text box (`ActiveOrder.tsx:193-198`, placeholder `e.g. staff_barista_sam`) with no eligibility lookup at all. The fix needs a new `customers.status` enum (`office_staff | church_member`), a re-keyed entitlement table and a real picker. Net-new work, not a patch — and it is the reason the café exists.

**(d) Two route gates coexist and only one runs.** `proxy.ts:13-38` gates `/admin/*` on `canAccessAdmin(role)`; `src/middleware.ts:5-73` gates it on `if (!session?.user)` with **no role check** — and also carries the Supabase session refresh. If `middleware.ts` wins, any barista reaches admin. If `proxy.ts` wins, customer sessions expire mid-visit. Alongside it: `loginWithPin` (`src/server/actions/auth.ts:22-80`) takes a bare 4–6 digit PIN with no identity claim, loops bcrypt over every active staff row, and calls **no rate limiter** — while `checkRateLimit` exists, is tested with 8 passing tests, and is wired into the customer path in three places. Sessions have no `maxAge`, so NextAuth's 30-day default applies. Ten thousand unauthenticated POSTs get an admin session that lasts a month.

**(e) The money reporting is wrong in the direction that flatters.** All three verified:

- `drizzle/0004_cogs_views.sql:25` computes `ROUND(SUM(...))` **grouped by day**. v7 requires rounding exactly once, half-up, **per order**, at `order_cogs`, so every day/week/month figure is a sum of the same integers. Today `monthly-pnl.ts:140` rounds per month, `export-csv.ts:51` per day, `generate-weekly-pnl.ts:74` per week — over the same rows. Three reports that can disagree by cents on identical data.
- `0004_cogs_views.sql:29` carries `AND il.unit_cost_zar IS NOT NULL`. A missing cost input is **silently dropped**, making COGS smaller and profit larger, with no ingredient named. §7.0.2 calls the refusal rule "NOT OPTIONAL".
- `CogsDashboard.tsx:248` renders Net green whenever `netZar >= 0`, ignoring the estimate flag; `generate-weekly-pnl.ts:115` prints "✅ Profitable". The seeded database is entirely estimated costs, so **a green profit flag on guessed numbers is the shipping default** — the one thing §7.0.1b calls worse than no flag at all.

`UNAVAILABLE` and `provisional` do not exist in the codebase: zero matches. Of the three render states that must stay distinct, one is implemented, one is absent, and one is an unrelated `LIKE '%cost_estimated%'` scan of the audit log that fails to suppress green.

### The deletion inventory, measured
| Feature | Whole files | Lines | Tests removed |
|---|---|---|---|
| Loyalty | 14 (+~27 edited) | 2,746 | 119 |
| Coffee packs (+ `pending_charges`) | 6 | 822 | 29 |
| Refunds | 2 (+edits) | ~500 | ~16 |
| Discord | 2 (+4 edited) | 162 | 9 |
| `sync_conflicts` | 3 (+edits) | ~340 | 9 |
| `retry-deferred` | 2 | 145 | 8 |
| **Total** | **~29** | **≈4,700** | **≈190** |

**Expect 942 → ~750 tests.** Write that number down: a falling test count during a deletion pass is correct. Below ~740 means collateral damage; above ~760 means a deletion was skipped. An AI reviewer checks that in one second; two humans would argue about it for twenty minutes.

Two corrections to earlier drafts, both from reading source: the wallet is genuinely gone (`0026`) — only comments and test fixtures still contain the word. And of the four files said to write `sync_conflicts`, only **two** actually do (`apply-outbox.ts`, `retry-deferred-payments.ts`); `api/sync/orders/route.ts` breaks at typecheck via a lost union variant, and `useOfflineOutbox.ts` breaks nothing and needs editing only to satisfy the PRD's literal grep gate.

---

## 3. How AI changes the shape of the two weeks

Claude writes all the code. That does not make the work small — it moves the bottleneck. The constraint is no longer typing; it is **how fast two people can be confident something is right.** So the plan's job is to make confidence cheap, by converting review from *reading* into *running*.

### The failure mode to design against
Claude writes the code, Claude writes the test, Claude reviews the PR: one misunderstanding certified three times with a green tick on it. The guard is one rule.

> **A human writes or checks the acceptance assertion. On a money ticket, the reviewer's only job is to confirm the assertion was not weakened.**

If a test changed in the same commit as the code it tests, that is the diff to read. Almost everything else can be delegated.

### Six places AI buys real time here
1. **Grep gates instead of deletion review.** v7 specifies its own completion gates as literal greps (`grep -rIn 'sync_conflicts\|syncConflicts' src/ db/` → zero). Those become a script. Nobody reads 4,700 deleted lines; the gate passes or names the file.
2. **Invariant scripts instead of schema review.** "No float money outside `unit_cost_zar`", "no `NEXT_PUBLIC_` Yoco key", "no `wallet` in `src/`", "`payments` has its partial unique index" — all machine-checkable, all in `scripts/verify-v7.ts`, run on every commit.
3. **Fixtures as the acceptance bar.** FIXTURE-A and FIXTURE-B (REQ-117, REQ-118) do not exist in the repo. Written first, by hand, from the PRD's worked example, they turn the whole COGS rewrite into pass/fail. **If FIXTURE-A computes R144.36 instead of R144.37 — stop. Do not adjust the test.**
4. **Parallel agents for reading.** The gap analysis behind this document was four agents on four scopes, ~11 minutes wall clock, for work that would have taken days by hand. Use the same pattern for the deletion sweep and the pre-go-live audit.
5. **An adversarial second pass.** A separate agent that sees the diff and the requirement text but *not* the implementing conversation. It looks for one thing: does this diff satisfy the Given/When/Then, or a paraphrase of it?
6. **The typecheck becomes the deletion gate** — but only once `ignoreBuildErrors` is gone. Until then it gates nothing at all.

### What still costs calendar time, whatever AI does
Getting the infrastructure decision made. Baristas learning a new screen. A real till drill with real people. Two actual weekdays of trading to see whether the numbers are sane. Human review throughput on money tickets. None of these compress.

### Review tiers
| Tier | What | Who | Cap |
|---|---|---|---|
| **A** | Money, entitlement, auth, secrets, migrations touching `payments` or `orders` | Both humans + the adversarial agent | **1 in review at a time** |
| **B** | Other migrations, deduction, jobs, deploy config | One named reviewer + agent | 2 |
| **C** | Screens, copy, docs, deletions | The gates are the reviewer | none |

Deletions are Tier C **because** the gates exist. That is the entire return on spending a day writing them.

---

## 4. Day by day

Working days. The two Sundays stay on the Yoco app, untouched.

### Week 1 — make it safe, make it deployable, make it smaller

**Day 1 — Stop the bleeding, then decide where it lives.**
- Delete `typescript: { ignoreBuildErrors: true }` from `next.config.ts`. Fix whatever it was hiding. *Nothing else in this plan is trustworthy until this is done.*
- Drop the new `CLAUDE.md` into the repo root. The current one names `FAVO_PRD_v3.md` as source of truth and `favo.hofmi.org` as the deploy target.
- Resolve `proxy.ts` vs `src/middleware.ts`: one file, role-checked, Supabase refresh kept.
- `maxAge` on the staff session. `checkRateLimit` on `loginWithPin`. An identity claim on the PIN form so it stops bcrypt-looping every staff row.
- **Human thread, starts today: chase OPEN-08.** Not a server choice — §9 settled that — but Matt's fourth answer, on who carries a Sunday-morning outage, is gate zero for going live. Start it on day 1 so it has a fortnight to land.
- Gate: `bun check` green with `ignoreBuildErrors` gone.

**Day 2 — Build the deploy path.**
- `Dockerfile` + `output: "standalone"`. A workflow that builds and pushes the image. Target shape is §9's: always-on VM, **Postgres co-located on the same host, direct connection** — so `prepare: false` comes out of `db/index.ts` in the same change, and `DATABASE_URL` / `DATABASE_URL_SESSION` collapse to one URL. Secrets via Infisical. `favo.hofmi.net`, never `favo.hofmi.org`.
- Fix the healthcheck so Yoco and Loki cannot restart-loop a working café. Leave `LOKI_URL` unset.
- A scheduler. There is none of any kind today — four cron routes waiting for a caller that does not exist. (`retry-deferred` is `GET`+Bearer while the others are `POST`+`x-cron-secret`; that inconsistency dies with the route.)
- A production migration step in the release, and a startup check for `DATABASE_URL_SESSION` — without it SSE degrades to heartbeats, the POS board goes stale, and the container still reports healthy.
- Gate: the app is up on a URL, `/api/healthz` honest, migrations run against production.

**Day 3–4 — The deletion pass.**
- Write `scripts/verify-v7.ts` **first**: every grep gate from §10.1 of the PRD, the invariants in §3, and the test-count band 740–760.
- Then delete: loyalty, packs, refunds (including the live `createRefund` at `client.ts:63` and the webhook's `refund.succeeded` branch), Discord, `sync_conflicts`, `retry-deferred`, `pending_charges`, `magic_link_tokens`.
- Rehome `formatZarField` and `pnlColor` out of `src/server/discord/webhook.ts` — they are used for non-Discord formatting.
- **Ordering hazard:** `close-daily.ts:98`'s Discord ping is currently the *only* channel for the L09 stock-variance alert. Build the Web Push replacement before deleting it, or the alert vanishes silently.
- `0023_rls_customer_isolation.sql` references tables that later migrations drop; it is not re-runnable against a post-drop database. Do not re-run it.
- Gate: all greps zero, typecheck clean, test count in band, `outbox_log.client_uuid` UNIQUE still present.

**Day 5 — The substrate migration.**
One migration, Tier A, carrying everything the weekday rows need: `customers.status` (`office_staff | church_member`), the re-keyed entitlement table, `order_items.shots` + `discount_zar` + `comp_reason`, `opening_sessions.mode` + `closed_at` + the one-open-session partial index, `orders.revenue_day`, a **config store** (there is none — T09/T11–T15 are hardcoded today and eight requirements read from them), and `payments`' partial unique index on `(order_id) WHERE status='successful'`.
- Gate: migration up **and** down on a copy. FIXTURE-A and FIXTURE-B written by hand, failing for the right reason.

### Week 2 — make it correct, then let it trade

**Day 6–7 — The entitlement, properly.**
Office staff become `customers` with `status='office_staff'`. Entitlement re-keyed to `customer_id`, `UNIQUE(customer_id, day)`. Automatic on a matched customer — no tap, no free-text box. It zeroes **exactly one unit of one eligible line**, never a line and never an order: today `orders.ts:619` sets `totalZar: 0` on the whole order, so a staff member's second paid drink is free too. `ENTITLEMENT_USED` / `NOT_ELIGIBLE` as real codes. `searchCustomer` to the DEF-F contract: prefix match, last-4 phone, and **stop returning `email` and full `phone`** (`customers.ts:29-31` returns both today).
- **Open question for a human:** `customers` has one `name` column and REQ-142 wants a surname beside the given name. Column, split, or trailing token — somebody decides, before day 5's migration is written.
- Gate: a barista gives a named office-staff member their cup in ≤3 taps; a second cup the same day is refused; a second *paid* drink on that order is still charged.

**Day 8 — R0 orders and the weekday deduction.**
`createOrder` today mints a Yoco checkout and inserts a `payments` row **unconditionally**, whatever the total (`orders.ts:193, 203`). A weekday cup is net R0: no payment row, nothing to a terminal, `payment_mode='free'`. And `deductForOrder` writes cup and lid movements on weekdays (`deduction.ts:146-194`, unconditional) — weekday `stock_movements` must contain neither, because people bring their own mugs.
- Gate: a weekday order produces zero rows in `payments` and no cup or lid movement.

**Day 9–10 — Honest money.**
Persist `order_cogs` as an integer, written in the same transaction as the deduction. Rewrite the four period queries to sum those integers. Replace the `IS NOT NULL` filter with a refusal that **names the offending ingredient**. Add `cost_source`, and make `provisional` suppress green everywhere — dashboard, weekly summary, exports. Implement `UNAVAILABLE` as a real render state, distinct from both zeroes and provisional.
- Gate: **FIXTURE-A and FIXTURE-B pass.** Day, week and month figures agree to the cent over the same data. A lot with a null cost makes the dashboard name the ingredient, not show a smaller number.

**Day 11 — Jobs, and the drill.**
Jobs 1 (`checkLowStock`, 15 min), 2 (`closeDaily` at **00:05** — not the 23:59 the route comment claims) and 5 (the collected sweep, absent entirely) on the real scheduler, with the catch-up and audit rules. Jobs 4, 6 and 7 are Sunday/fund work: deferred.
- Then a real drill: three baristas, the actual tablet, twenty orders, the till never touched by a developer. Watch which taps they hesitate on.

**Day 12–14 — Trade, watch, fix.**
Two real weekdays of service. Nobody ships a money change during them. Fix what the drill and the trading surface, in that order. Go/no-go on the Friday against §6.

---

## 5. What is deferred, explicitly

Named, not euphemised. Sunday keeps working the way it works today throughout.

- **The whole Web POS tender chain** (`beginTender` / `sendToTerminal` / `pollTenderResult` / `recordTenderResult` / `resolveTenderByLookup`). The largest single item in the PRD, and `src/server/yoco/` is the wrong API surface — plan on replacing it, not editing it. FACT-1 sits underneath.
- **Sunday card sales**, the extra-shot surcharge, mixed paid/free orders.
- **The blessing fund** — 18 requirements, four new tables, eight new actions, a new admin surface. Money-*out* is independent and cheap; money-*in* rides entirely on the tender chain above, which is why v7 §13.9 sequences it last. DEC-15 also needs HOFMI's bookkeeper to read it before go-live.
- **Vouchers** and the Untracked Church event mode — 9 requirements, mid-sized *provided* `discount_zar` and `opening_sessions.mode` land in day 5's migration, which they do.
- **The ministry rollup** (`ministry_cost` / `ministry_income` / `ministry_net`) and the netted rollup view — the PRD's own "most important unbuilt Priority-2 item", entirely greenfield.
- **The weekly ops summary rewrite** — Monday 06:00 push, in-app screen, mode split, per-barista write-down block. Blocked on comps and write-offs being attributable.
- **The Yoco transaction import** (job 6) and the write-off/reconciliation close, `daily_closes` included.
- **Margin by shot count** (REQ-139) — the PRD calls it "one GROUP BY", true only once a margin pipeline exists. None does: no margin figure is computed server-side anywhere today.
- **Comps, cancels past `ordered`, abandoned drinks, walk-ins.**

---

## 6. What cannot be cut, at any deadline

1. **`ignoreBuildErrors` goes on day 1.** Everything else assumes it.
2. **The PIN login gets a rate limit and a session `maxAge`.** An open admin console on a café counter is not a deferrable item.
3. **One route gate, role-checked.**
4. **FIXTURE-A and FIXTURE-B pass before any money figure is shown to anyone.** Written by a human, from the PRD's worked example. If the code disagrees with the fixture, the code is wrong.
5. **No silent zeros.** A missing cost input names its ingredient, or the figure reads UNAVAILABLE. Never a smaller number.
6. **Never green on estimates.**
7. **The entitlement zeroes one unit, not an order.**
8. **`outbox_log.client_uuid` UNIQUE survives the deletion pass.** It is the offline idempotency guarantee.
9. **No refunds.** L02 is absolute; the remedy for a wrong charge is a free drink next time. Table, enum value, stub actions, the live `createRefund` and the webhook branch all go.
10. **`NEXT_PUBLIC_YOCO_PUBLIC_KEY` comes out of the client bundle** (`POSWorkspace.tsx:111`, `YocoPayment.tsx:30,74`, `YocoOrderForm.tsx:77`). REQ-071 permits no Yoco key of any kind client-side.
11. **A production migration step in the release.** The drizzle journal has already needed hand-repair once (`scripts/repair-drizzle-journal-0027.ts`).

---

## 7. What decides whether this works

**The binding constraint is human review throughput, not build speed.** Claude can produce day 9's COGS rewrite in an afternoon; whether it ships depends on two people being confident about rounding at 5pm on a Thursday. That is why Tier A is capped at one ticket in review at a time, and why the gates in `scripts/verify-v7.ts` are worth a whole day of week 1.

**Three slips break the two weeks:**
- **OPEN-08 (day 1).** The build can proceed against §9's shape, but go-live can't clear while nobody is contractually responsible for a Sunday-morning outage. It is a conversation, not a task, which is exactly the kind of thing that slips.
- **The surname question (day 6).** Small — but it is in a migration, and migrations are expensive to redo.
- **Review latency on the money tickets (days 9–10).** One 48-hour turnaround eats the trading buffer.

**Odds, honestly:** weekday service live and correct inside two weeks — likely, if days 1 and 2 land clean. Sunday card sales inside two weeks — no. That is not a scheduling opinion: a replacement tender chain plus an undocumented vendor step is not a two-week item on top of everything above.

---

## 8. Before day 1

1. **Matt's answer on the Transformate terms (OPEN-08).** *Not* a choice of server — §9 settled that. Four questions are with Matt and the gate is the fourth: who is contractually on the hook if the server dies at 08:00 on a Sunday. §9.4 promises RTO ≤ 4 hours and RPO ≤ 5 minutes, and the PRD is explicit that **the RTO has no contractually responsible party until OPEN-08 is answered**. §13.0 calls this gate zero. Nikao ↔ Matt. Day 2 can be built against Transformate's shape regardless; what OPEN-08 gates is going live on it.
2. **`gh auth login`** on the machine Claude Code runs on, so it can push branches and open PRs rather than only read.
3. **The deferred list in §5, agreed by both of you.** If Nikao wants vouchers or the fund inside the fortnight, one of them is possible — and then weekdays go live in week three. That is a real trade, not a soft one.
4. **Two review blocks in the calendar as appointments** — Thursday week 1, Thursday–Friday week 2. Unbooked review time does not happen.
5. **The surname decision** (§4, day 6), before the day-5 migration is written.
