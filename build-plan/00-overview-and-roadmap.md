# FAVO Café — Build Plan · 00 · Overview and Roadmap

**Status:** Draft for Nikao to review. The spec question is settled; the task split and the review load are not.
**Written:** 19 September 2026 · **Revised:** 21 September 2026 — v7.0 confirmed as the spec, go-live moved from the end of the plan to after Phase 3, the six superseded AT tickets closed, and the whole plan re-derived for **Claude writing the code**.

> ⚠ **Read `04-how-claude-builds-this.md` before this document's estimates.** Claude writes the code; Mia and Nikao specify, review, decide and verify. Every duration below is bound by vendors, physical drills, Sundays and review throughput — **not** by how long anything takes to type. The first draft of this plan assumed two people typing it all by hand and was wrong by months.
**Built from:** FAVO Café PRD v7.0 (18 Sep 2026), read in full from the raw snapshot saved in this project.

---

## 1. Source of truth — resolved, with the ambiguity left visible

### 1.1 What this plan treats as authoritative

**FAVO Café PRD v7.0, dated 18 September 2026, is the authoritative specification for this plan.** Every task below traces to a clause or an Appendix C requirement row in it.

The reasoning, in plain terms: each PRD in this family declares in its own header what it replaces. v7.0's header says "full replacement, superseding v6.0". v6.0 superseded v5.2. v5.2 (per `claude/prd-v5.2-summary.md`) superseded v5.1, v5.0, v4.0 and the v4 direction paper. So v5 → v5.1 → v5.2 → v6.0 → v7.0 is an unbroken chain of self-declared replacements, and v7.0 is the end of it. v7.0 also carries an internal changelog (Appendix B) that names, clause by clause, what it changed from v6.0 and what v6.0 changed from v5.2 — which is the closest thing to a signed diff that exists.

### 1.2 The version confusion — resolved 21 Sep 2026

✅ **Decided: the build runs on PRD v7.0.** Confirmed by Mia, 21 September 2026. This is no longer an open item — it is a dated decision, and the rest of this section is the record of why, kept so the argument is not re-run.

Four documents claim or imply authority and they do not agree:

| Document | What it claims | Where it lives | Status in this plan |
|---|---|---|---|
| `FAVO_PRD_v5.md` | Named authoritative by **this Claude project's own description** | GitHub repo root | **Superseded.** Not read (see 1.3) |
| `FAVO_PRD_v5.2.md` | "Authoritative but NOT build-ready" (2026-08-31) | GitHub repo root | **Superseded** by v6.0 |
| v6.0 | Authoritative, build-ready with one gate | Never seen in this project | **Superseded** by v7.0 |
| **PRD v7.0** | "Authoritative and buildable", full replacement of v6.0 | `claude/FAVO-PRD-v7.0-snapshot.html` in this project; also the doc "PRD V7" | **Adopted** |

The project description that names v5 was written before v5.2 existed and was never updated through three versions. It is stale, not authoritative.

**One loose end remains, and it is small:** nobody has confirmed whether a v6.0 document exists anywhere. If it does, it should be archived alongside the others in Phase 7. If it does not, the chain runs v5.2 → v7.0 in the repo and nothing is missing.

### 1.3 What could not be checked, stated rather than glossed

- **`FAVO_PRD_v5.md` was not read.** The repo is private and this session has no GitHub access (no `gh`, no credentials). So the v5 → v7 comparison below is built from v7.0's own Appendix B and from `claude/prd-v5.2-summary.md`, not from the v5 text itself.
- **`FAVO-PRD-v5.2-briefing_1.html` is not in this project.** The project holds five docs: `PRD V7`, `claude/opus-build-plan-prompt.md`, `claude/open-item-ingredient-costing-gap.md`, `claude/FAVO-PRD-v7.0-snapshot.html`, `claude/prd-v5.2-summary.md`. The briefing HTML is not among them. If it matters, re-attach it.
- Neither gap changes the conclusion, because v7.0 supersedes both documents by its own terms and documents its own departures from them. But if anyone needs the v5 → v7 diff to be *verified* rather than *reported*, that needs repo access.

### 1.4 Is v7.0 a strict superset of v5 / v5.2? **No.** It reverses things.

This matters more than the version numbering, because it means **a task written from v5 or v5.2 builds the wrong product in at least six named places.** Anything still open on the board from an earlier PRD must be re-checked against this list:

| What v5 / v5.2 said | What v7.0 says | Where |
|---|---|---|
| Card tender in two phases: Phase 0 rings every Sunday sale twice on two devices (≈7–9 taps); Phase 1 is a native Capacitor/iOS wrapper on Yoco's in-person SDK | **Phase 0 is deleted, Phase 1 never happens.** One route: Yoco's Web POS API, server-to-server, 3–4 taps from day one. No native app on any platform | §6.8.0, §8.9, DEC / OPEN-12 |
| A **double shot** carries the R10 extra-shot surcharge (DEC-08) | **One and two shots are both the listed price. R10 starts at the third shot** (DEC-16 supersedes DEC-08). `order_items.shot` (enum) becomes `shots` (integer 1–4) | §6.2.3, L31, T09 |
| `§8.2` bans every stored balance, permanently, as a standing prohibition | **§8.2 is narrowed, not deleted** (DEC-14). A named, non-refundable **blessing fund** is now in scope. What stays banned is a *customer-held, self-service, refundable* balance | §8.2, §6.10.1, L44–L47 |
| One session per revenue day — `UNIQUE (session_date)`, reopening dropped | **As many sessions a day as it needs, at most one open at a time.** v6.0's narrowing migration is **struck, not resequenced — do not run it** | §6.11.1, §13.2, COL-14 |
| Appendix E = **92** requirements | **Appendix C = 148** requirements (REQ-001…071, REQ-101…135, REQ-136…177 — the arithmetic checks out: 71 + 35 + 42 = 148) | Appendix C |
| No mechanism for a free drink outside the weekday entitlement and the comp | **The Untracked hot drink voucher** (§6.9) — one tap, one unit, paper slip counted at the close | §6.9, L41–L43 |

Also worth knowing: v7.0 fixes **seven defects (DEF-A … DEF-G)** that were live in v6.0 and reachable with none of the new work built. Six of the seven land in Phase 1 with the payment work, because they live in the discount and tender arithmetic that phase builds.

### 1.5 The repo will drift from this plan unless someone fixes it — separate flag

⚠ **The PRD file in the GitHub repo is very likely still v5.x, and `CLAUDE.md` points at `FAVO_PRD_v3.md`.**

v7.0 already commissions the fix (§13.6) and this plan schedules it as **Phase 7**, but it is worth stating separately because of the failure it prevents: a future session (human or AI) opening the repo and picking up a stale answer. v7.0 says so itself — "v5.2 is now the most confusable of them, because it is recent, long, and *wrong about the payment chapter*."

The repo work §13.6 requires:
- Move `FAVO_PRD_v5.2.md`, `FAVO_PRD_v5.1.md`, `FAVO_PRD_v5.md` (repo root), `docs/FAVO_PRD_v3.md` and the three phase build plans into `docs/archive/`.
- Land v7.0 itself in the repo as the PRD of record (the PRD does not say this in so many words — it assumes it. **Add it as a task:** a spec that only exists as a Claude artefact is a spec the repo cannot be checked against.)
- Point `CLAUDE.md`'s "PRD is the source of truth" line at it.
- Delete the nine root-level duplicate docs (`API.md`, `BUSINESS_RULES.md`, `ARCHITECTURAL.md`, `DESIGN.md`, `DATA_MODEL.md`, `PLANNING.md`, `DATABASE_SETUP_GUIDE.md`, `FAVO_CAFE_Project_Brief.md`, `CLAUDE.md`), keeping the `docs/` copies — root and `docs/DESIGN.md` differ by 137 lines.

**Do not wait for Phase 7 to do one thing:** put v7.0 in the repo and repoint `CLAUDE.md` in week one. It costs an hour and it stops the whole problem recurring for the rest of the build.

### 1.6 Two small defects found in v7.0 itself while reading it

Neither blocks anything. Both are worth filing as a PRD amendment so a future reader does not treat them as decisions.

- **"Six jobs" vs "seven jobs."** §9.6 and §9.6.2 both say **seven** scheduled jobs, §9.6.2 lists seven and says "three rules hold for all seven" — but §9.6.1's dependency register row still reads "Scheduled jobs **(six)**" and §16.1's closed-decision row still says the register closed OPEN-02 with "**six** jobs". The seventh is the donor-fund dormancy check, added in v7.0. **§9.6.2 is the register of record and says seven; build seven.** The two stale references are leftovers from v6.0.
- **The blessing fund's counter top-up inherits R18 without being named in it.** Appendix D says so itself: the top-up "has never been run against the Khumo, and it rides the same unproven device-link step §6.8.2 gates on." R18's own row does not mention it. Practically this means: **if the R1.00 gate fails, Phase 5's money-in path is blocked too**, not only Phase 1's. Worth adding to R18's text.

---

## 2. Assumptions — confirm these, they change the shape of the roadmap

| # | Assumption | Why it is an assumption | If it is wrong |
|---|---|---|---|
| A0 | **Claude writes the code. The humans specify, review, decide and verify** | Confirmed by Mia, 21 Sep 2026 | This is the load-bearing assumption. If any of it were hand-written the estimates roughly quadruple |
| A1 | **Mia ≈ 15–20 hrs/week**, around Bible Institute study — now mostly **review and specification**, not build | Confirmed as a reasonable default in conversation, not measured | Review is the binding constraint on Tier-A work, so this scales the payment phases directly |
| A2 | **Nikao's capacity is unknown.** Planned at ≈10–15 hrs/week effective | Nikao is not in this conversation. He also owns two vendor conversations with their own clocks | Nikao is on the critical path for P0 and P1. If he has less than this, the roadmap stretches — it does not compress by moving work to Mia, because most of it is money-path work |
| A3 | The task split below is a **proposal**, not a decision | Same reason — Nikao has not seen it | Adjust it together in the first board review. The **ownership rule in §5 is not adjustable**; who owns which epic is |
| A4 | Durations are **estimates, not commitments**, and are now bound by drills, vendors, Sundays and review — not by build time | v7.0 says the same about its own §13 figures. And no Tier-A review has ever been timed on this team | Track actuals from Phase 0 and re-derive. **The second estimate is the one worth reporting** |
| A5 | The ~909 (PRD §01 says "~900") unit tests are green **on `main`**, not necessarily in the new environment | Nobody has run them against the new host | P0 exit criteria cover exactly this |
| A6 | The café keeps trading on Yoco's own app throughout | It is what it is doing now — production has been down since the Vercel 402 | If FAVO's go-live slips, nothing breaks. This is why there is no deadline pressure on any phase but P0 |

---

## 3. The roadmap

Ten phases. The sequence is v7.0 §13's own, which is dependency-driven and reasoned clause by clause; the two places this plan departs from it are marked **[deviation]** with the reason.

### Phase 0 — Recovery and audit (gate zero)
**Goal.** Get FAVO running on always-on infrastructure with a verified, seeded database and a restored-from-backup proof, and find out — before any feature work — which of the 148 requirements the existing code actually satisfies. Nothing else starts until this is done, because an unverified test suite and unstable hosting make every later phase untrustworthy.

**Contents:** §13.0 in full, plus two additions this plan makes (marked ⊕).

- Always-on host + co-located Postgres; migrations to the §10 shape; seed menu, prices (§7.0.1), recipes, ingredient costs
- Seed verification — five menu items priced per §7.0.1; **the three alternative milks seeded with real costs** (§7.0.2's refusal rule blocks every margin figure while any consumed ingredient costs 0.0000); the bean cost reconciled; every lot explicitly `cost_source = 'estimate'`; profit flag confirmed rendering `provisional`
- Confirm the **Chai Latte price** (§7.0.1 marks R20 "unconfirmed" — the dev seed carries a different figure)
- Yoco: API key, create the Web POS device, link the Khumo, **run the R1.00 test and all six steps** (§6.8.2)
- Submit the Yoco SDK application (insurance only)
- Rotate the exposed DB password; re-issue Yoco and VAPID keys into Infisical; move ~15 secrets
- Attach `favo.hofmi.net` via Cloudflare for SaaS; `dig` check before and after
- Retire `POST /api/payments/yoco/webhook` (404, not re-pointed)
- PITR / continuous WAL archiving, RPO ≤ 5 min; **restore the backup and record the elapsed time as the first RTO measurement**
- Validate the live queue through the edge for ≥ 4 h; measure and record the four §05.1 figures
- Enable connection-drop logging on the tablet
- Settle OPEN-08 (Transformate terms) — gate zero is the point of commitment
- ⊕ **Requirement → code → test traceability audit.** Map all 148 Appendix C rows to existing code and existing tests; produce a three-column register (`REQ id | code exists? | passing test exists?`) and flag every row with no passing test. *This is not a PRD requirement — it is standard brownfield-recovery practice, and it is what turns "909 tests are green" into "we know what is covered."*
- ⊕ **Layer 2 design foundation** (§17.6) — the semantic status tokens, size tokens and viewports. Layer 1 (the FAVO brand system) has **no** status colour and **no** size or touch-target token of any kind, so §17.3's "touch targets verified in CI against the tokens" has nothing to verify against until this exists, and Phase 1's UI cannot be built to spec. *Placing it in P0 also gives Mia a full, useful workstream while Nikao is on infrastructure — which is the practical scheduling problem a two-person team has in a recovery phase.*

**Exit criteria — all must be true and each is testable:**
1. `tests/e2e/prod-smoke.spec.ts` green against the new host; `bun typecheck`, `bun lint`, `bun test:unit` all green **in the new environment**, not only locally.
2. Live-queue SSE connection held **≥ 4 hours end-to-end through Cloudflare** (§9.8, REQ-069). A local test that bypasses the edge does not satisfy this.
3. A backup has been **restored**, and the elapsed time is written down.
4. `dig +short MX hofmi.net && dig +short NS hofmi.net && dig +short favo.hofmi.net` shows MX unchanged, NS still Xneelo, `favo.hofmi.net` resolving with a valid cert.
5. `POST /api/payments/yoco/webhook` returns 404.
6. Seed verified: **REQ-132** passes — no ingredient consumed by a live recipe costs 0.0000, the bean cost is reconciled, and every lot's `cost_source` is recorded honestly. The profit flag renders `provisional`.
7. The four §05.1 figures are **recorded** (tap < 100 ms, commit < 1.5 s p95, cold load < 5 s, 3G-grade usable). The commit figure is the EU-vs-SA residency revisit trigger — this is the one moment changing region is nearly free.
8. The R1.00 Web POS test has **run** against the real Khumo and its six steps are written up, including the tap count at step 5 (§05's Sunday budget is amended by that measurement, not by an argument). *Note: "has run" is the exit criterion, not "has passed" — see the risk register.*
9. OPEN-08 answered — specifically question 4: who is contractually on the hook if the server dies at 08:00 on a Sunday.
10. The traceability register exists and every uncovered REQ row is in the backlog as a test-writing task.
11. Layer 2 tokens exist and CI enforces §17.3's contrast floors and D1's target sizes.

**Estimate: 1½–3 weeks.** Almost entirely waiting — Matt's answer, scheduling the Khumo outside trading hours, DNS, and the four-hour queue hold. The 148-rule audit drops from weeks to about a day.

---

### Phase 1 — The flow fix and card payments, together (§13.1)
**Goal.** The barista can ring up an order in the tap budgets of §05, walk away from it, come back and make it, and take a card payment that FAVO can account for — including when it goes wrong. This is the highest-value functional change and a prerequisite for everything else in Priority 1.

**Contents.** The flow fix (L28 target binding · ring-up/make separation · recents grid · quantity stepper · segmented shot picker and `order_items.shots` · L37's one-line-per-distinct-configuration rule · PWA install step with iOS instructions · The Favo wired into the POS row). Card payments (`beginTender` → `sendToTerminal` → `pollTenderResult` → `recordTenderResult` → `resolveTenderByLookup`; the `payments` target shape; the payment adapter and its field allow-list; **all ten error paths of §6.8.4**; the 180 s ceiling and its progress state; the one-successful-payment-per-order index; the polymorphic-subject CHECK and its second partial unique index). Deferred settlement. Alerting (§9.6.3) including the card-machine alert to the barista's own device, with de-duplication built in, not bolted on. DEF-A, DEF-B and DEF-C.

**Why the defects land here:** all three are in the discount and tender arithmetic being built in this phase, all three were live in v6.0, and they are cheaper to fix before the code they affect is written than after.

**Exit criteria:**
1. §15.1's **payment chapter** row passes in full — unit (four Web POS calls mocked at every status; the 180 s ceiling writes `unresolved` and does not cancel; a fetch error never resolves a payment; a masked PAN produces no stored or logged copy) and E2E against **Yoco's test credentials on staging** (success, decline, walk-away, machine off the network mid-payment, timed-out send, two successful payments on one order refused by the DB index).
2. REQ-001…REQ-012, REQ-026…REQ-034, REQ-046, REQ-047, REQ-048, REQ-053, REQ-060, REQ-070, REQ-071 each have a passing test.
3. REQ-143, REQ-152, REQ-153 pass (DEF-A, DEF-B, DEF-C).
4. §05 ring-up budgets drilled on the real tablet: ≤ 4 taps Sunday unregistered at quantity 1, ≤ 3 taps weekday known office staff single shot / ≤ 4 double. **Timed, recorded, and compared against the number the R1.00 gate measured** — if the Web POS confirm step requires a merchant tap in FAVO's browser, the budget becomes 5 and §05's row is amended by the measurement.
5. Order-ready push ≤ 10 s from "Done" on a real device through the edge (REQ-047).
6. The de-duplication drill passes: card machine off the wifi for an hour = **one alert plus one resolution notice, not sixty**, and the barista's own device was alerted, not only Nikao.
7. Full suite green. Audit coverage returns 0 orphans (REQ-064).

**Estimate: 2–3 weeks**, set by exercising the ten failure paths on staging and by Tier-A review — not by build time.

---

### Phase 2 — Modes, sessions, identity, vouchers (§13.2)
**Goal.** The app knows what kind of day it is, who the customer is, and which free drinks are legitimate — and the cost numbers underneath become trustworthy enough that Priority 2 can be built on them.

**Contents.** `opening_sessions.mode` + `setDayMode` + one-tap confirm, computed against **the session's own window** (L18, COL-8) · `closeSession`, `closed_at`, the **one-open-session partial unique index** (the only genuinely new object here) · per-session voucher columns · `barista_shifts` keyed to the session · `customers.status` + registration change + computed broadcast audience · **repoint the free-coffee entitlement to `customers` and rename `applyStaffDiscount` → `applyFreeCoffee`** · barista rota, shift-start push, **Hand over** · `walk_ins` with `quantity` · **mode-aware and shot-aware deduction in one pass, with the `Extra Shot` deletion in the same migration** · the Untracked hot drink voucher (§6.9) · `app_config` store, T06, T11, T12 · session lifetime, out-of-window idle lock, customer-side rate limits.

⛔ **Do not run v6.0's session-narrowing migration.** §13.2 as v6.0 wrote it commissions a migration from `unique(session_date, opens_at)` down to `UNIQUE (session_date)` that §6.11 reverses. A builder who works that step does the work twice and writes a migration and a down-script for nothing. The shipped constraint at `9aefc2c` is retained (COL-14).

**Exit criteria:**
1. REQ-024, REQ-025, REQ-052 pass — and **R15 is closed**: an office-staff member (not a FAVO staff member) receives the free weekday cup, one per day, DB-enforced on `UNIQUE(customer_id, day)`.
2. REQ-054, REQ-137, REQ-138, REQ-144 pass — a line at *n* shots deducts *n* × coffee and exactly 1 × everything else, asserted **per ingredient, not on the total**; the weekday picker renders two segments and a direct write of 3 is rejected. `Extra Shot` is absent from `menu_customisations`.
3. REQ-154…REQ-159 pass (the voucher), including the offline replay drill — three vouchered orders rung offline replay with redemptions intact, none charged, none flagged.
4. REQ-155 / L48: on a weekday no voucher control exists **in the rendered tree**, not merely disabled.
5. Sessions: open a session, attempt a second on the same date → `STALE_STATE` from the partial unique index; close, open the second, assert it carries its own mode, deferred state and voucher kinds; `daily_seq` continues across sessions (the evening's first order is #38, not #1).
6. REQ-056 (computed audience), REQ-057 (Saturday offers *Start an event*, not a mode picker), REQ-058 (walk-in), REQ-061/062/063 (session lifetime, rate limits, admin PIN override).
7. Full suite green.

**Estimate: 1½–2½ weeks**, set by review of the entitlement and deduction work, plus one real weekday to sanity-check the free cup.

---

### Phase 3 — Removal: loyalty and coffee packs (§13.3)
**Goal.** Delete two shipped features that serve neither priority, in an order that cannot strand the system half-removed.

**Sequence is normative:** verified backup → UI surfaces → server actions and the accrual path → tables and columns with a tested down script → update the ~34 loyalty and 24 pack test files → **fix the customer privacy policy page**, which currently describes loyalty data collection (POPIA disclosure has to match what is actually stored).

**Scale, so nobody underestimates it:** 76 source files reference loyalty, 22 reference packs.

**Exit criteria:** both enforcement greps return zero; no loyalty, wallet or pack surface is reachable; the suite is green **after each step**, not only at the end; the privacy page no longer mentions loyalty data.

**Estimate: 4–7 days.** The 76-file sweep is fast; the backup and keeping the suite green after each step are the real work.

---

### Phase 4 — Offline trim and the audit gate (§13.4)
**Goal.** Keep the outbox, delete the conflict-reconciliation layer that solves a problem a one-tablet café cannot have, and — the actual point — **prove the offline path works or ship it disabled.**

**Contents.** Delete `sync_conflicts`, `actions/sync-conflicts.ts`, the admin resolution surface, `outbox_log.conflict_id`. Keep `useOfflineOutbox`, `apply-outbox.ts`, `POST /api/sync/orders`, `outbox_log` **including the `client_uuid` UNIQUE constraint — that is the idempotency guarantee.** Each retained file must be *edited*, not merely kept: all three write `sync_conflicts` and will not compile once the table drops. Remove or internally gate the live `/api/crons/*` endpoints. **Delete `retry-deferred-payments.ts`** — one file violating three rules of the PRD. Add the CI regression test on write/replay. Run the physical drill.

**Exit criteria:** §10.1's grep returns zero; the CI regression test runs on every PR; **the physical drill passes on the real tablet over the real network, and it exercises an entitlement claim, not five plain orders** (L34) — if it does not pass, **offline ships disabled, not unverified**; no Admin can invoke a timer (§10.7).

**Estimate: 3–5 days**, set by the physical drill.

---

### Phase 5 — The blessing fund (§6.10)
**Goal.** Money that is handed over today and given away invisibly becomes a ledger. Placed here because §13.9 says so: after §13.4, as its own step — it is gated on a decision that reopens a locked clause, so it must not sit in front of anything that gets the café trading.

**Contents.** `donor_funds` / `donor_fund_entries` / `donor_fund_members` · the fund code · linked names and the partial unique index · `beginFundTender` (counter card top-up, riding §13.1's payment chain unchanged) · `topUpDonorFund` (cash/EFT, Admin) · `drawFromDonorFund` · the two-chip footer and oldest-unspent-first selection · the freeze on a fund-settled order · the cancel-restores-the-fund path · `/admin/funds` · the dormancy job (proposes, never writes) and the liability digest line.

⚠ **DEC-15 gates go-live for this phase only.** A top-up is money owed in coffee, not income, until the coffee is drawn — and that treatment is marked for a read by **HOFMI's bookkeeper** before the fund goes live. It gates that and nothing else. **Start the bookkeeper conversation in Phase 1**, not in Phase 5; it is a conversation with a person, and those have their own clock.

**Exit criteria:** REQ-160…REQ-177 all pass, and in particular:
1. **A balance never exists before the money does** — ring a R500 top-up, decline the card, assert the balance is zero and the fund is not drawable; repeat with a timeout, assert the entry shows pending, contributes zero, and becomes drawable only after `resolveTenderByLookup` confirms it. *This is the test the whole of §6.10.3 rests on.*
2. A fund **never** writes to `payments` — draw twenty fund orders on staging, assert the table is untouched and T10's exception list is empty.
3. A fund cannot go negative — two simultaneous draws against a fund holding one drink's worth: one succeeds, one returns `FUND_INSUFFICIENT`. *This is the `SELECT … FOR UPDATE` test and it is the only place §6.10 can lose money.*
4. A fund-paid order is **never written off** — draw a fund on ten orders, run `closeDaily()`, assert zero write-offs and an empty unpaid-orders list.
5. T13's ceiling is checked **before the machine** — attempt a R5,000 top-up, assert `VALIDATION`, no payment row, and no call to `sendToTerminal`.
6. No customer-reachable path increases or reads a fund balance (L44, L46), asserted on the payload of every customer-scoped read.
7. The bookkeeper has read DEC-15 and said yes.

**Estimate: 1–2 weeks**, plus whatever the bookkeeper conversation takes.

---

### Phase 6 — Discord removal (§13.5)
**Goal.** Delete a channel nobody reads, without losing the alert riding on it.

**The order is not negotiable.** The §9.6.3 replacement must be **built and verified first** — including the de-duplication assertion — and only then does Discord get deleted. `closeDaily()`'s only current alert is the Discord ping; deleting it first leaves reconciliation computing a variance, writing an audit row and telling nobody.

The replacement is built in Phase 1 (E1.7), so this phase is the deletion plus its verification: force a mismatch on staging, confirm the Admin device receives it, *then* delete.

**Exit criteria:** the completion grep returns zero (excluding this PRD and `docs/archive/`); a forced close mismatch on staging alerts the Admin device. Baseline at `9aefc2c` is 89 matches across code, infra, scripts and docs.

**Estimate: 1–2 days.**

---

### Phase 7 — Domain, doc and duplicate reconciliation (§13.6) — **do not skip**
**Goal.** One infrastructure described in the docs, one domain that exists, one PRD the repo points at.

`favo.hofmi.org` never existed — `hofmi.org` is NXDOMAIN. Its footprint is **37 files**, and a third of it is code, tests and infrastructure, two of which **fail silently**: `src/server/push/vapid.ts` (a wrong VAPID subject is a silent push-delivery failure — R16 territory) and `tests/e2e/prod-smoke.spec.ts` (gate zero's own smoke test asserts against a domain that will never resolve).

⚠ **Pull the two silent-failure files forward into Phase 0.** The prod-smoke spec is a gate-zero exit criterion and the VAPID subject is load-bearing for every notification Phase 1 builds. The remaining 35 files can wait for this phase. **[deviation]** — from §13.6's placement, on the grounds that §13.0 depends on one of the files §13.6 fixes.

**Exit criteria:** `grep -rIn 'hofmi\.org' .` returns zero outside `docs/archive/`; `ARCHITECTURAL.md`, `docs/API.md` (generated from §11, never consulted by it), `docs/BUSINESS_RULES.md`, `docs/DATA_MODEL.md` match v7.0; `CLAUDE.md` points at v7.0; superseded PRDs archived; the nine root duplicates deleted; `grep -rIn 'admin/login' src/` returns zero.

**Estimate: 2–3 days.** The 37-file sweep is minutes; review is the day.

---

### Phase 8 — Priority 2: cost management (§13.7)
**Goal.** The one thing Priority 2 exists to produce — "are we making money" — answerable without downloading a CSV, and never green on a number that isn't trustworthy.

**Contents.** Per-mode split on the live COGS dashboard and `cost_source` labelling wherever a margin surfaces (L39) · **margin broken out by shot count**, which is one `GROUP BY` and the single most actionable number v7.0 produces · ministry rollup + `logExpense` + `/admin/expenses` · weekly ops summary with §7.3.1's **five-row per-barista write-down block** · `/admin/yield` recosting, the only path from `estimate` to `invoice` · **FIXTURE-A and FIXTURE-B**.

**Deliberately after Phase 2:** the weekday and event figures are wrong until mode confirmation, the walk-in log and the corrected deduction all exist. Building the reports first produces numbers that look authoritative and aren't.

**Exit criteria:**
1. **FIXTURE-A** asserts, to the cent: gross R350.00 · fees R9.27 · net settled R340.73 · written off R0.00 · comps R0.00 · `cogs_zar` R196.36 · gross margin R153.64 · contribution R144.37 · 17 drinks · 10 double shots — and the flag renders **provisional, not green**. *A builder who computes R144.36 has found a real disagreement and should stop, not adjust.*
2. **FIXTURE-B** — one fixture, not two — carrying a comp, a write-off, a path-B settlement, an entitlement cup, a walk-in line beside a paid line, a tip, a quantity-2 line, **four voucher redemptions, two fund draws, a settled fund top-up, a four-shot line, and a line that exhausts a bean container mid-deduction**. Every §7.0.2 term asserted individually. `ministry_net` identical with and without §6.9.4's reclassification, while the day still prints `cogs_zar` whole.
3. REQ-101…REQ-135 and REQ-139, REQ-145, REQ-158 pass.
4. REQ-108 / REQ-109 / REQ-110 — the three renderings are visibly distinct: **empty ≠ UNAVAILABLE ≠ provisional**.
5. §05's Priority-2 criteria: COGS increments within 5 s of a test order; the rollup answers the funding question with no assembly; the weekly summary reaches the three baristas and the Admin automatically with **five named per-barista figures** and zeros printed as `0`.

**Estimate: 3–4 weeks — almost all of it waiting, not building.** The stock-variance criterion needs **two weeks of real trading**, and the fee import needs a real Yoco export from a real trading day.

---

### Phase 9 — Event mode (§13.8)
**Goal.** Special weekends, socials and midweek gatherings run on the same system instead of falling back to paper.

`event_profiles` + `event_windows`, the **six** switches (the sixth is which voucher kinds are live), all three activation paths, automatic close on read, the 24-hour backstop. Price overrides written in one transaction to both `price_history` and the window's snapshot.

**Last on sequencing — it depends on modes existing — not on uncertainty.**

**Exit criteria:** the **Discipleship 101 drill** — recurring Wednesday template, confirmed in one tap; place orders and assert **zero payments sent and no card prompt**; assert cups are deducted; assert the window closes itself at 20:30 with no job involved and Thursday defaults to Weekday. Plus REQ-042…REQ-045.

⚠ The **Untracked Church profile** is a Phase 9 object by dependency but a Phase 2 need in practice — §13.2 says it "lands with §13.8's event work, **or earlier as a Path A profile if the evening service starts being served before then**." Decide which in the Phase 2 review.

**Estimate: 3–5 days**, plus a Wednesday to run the Discipleship 101 drill.

---

### Phase GL — Go live *(runs after Phase 3, not at the end)*
**Goal.** The café starts taking real orders on FAVO. Everything before this makes the software correct; this makes it usable by someone who did not build it.

⚠ **This phase moved.** It was originally placed last, after the cost reporting — which would have meant the café trading on Yoco's own app for eight months while a working till sat finished. That was a sequencing mistake. **Nothing in Phases 4 to 9 is needed to take an order and a card payment**, so go-live belongs here and those phases carry on with the café already live.

Added in the final gap check, because four things the PRD requires had no home in the plan:

- **The barista training bar** (§5.3, OPEN-05 closed) — a 20-minute walkthrough that exists and is the same every time, then two tests with a real person: **a weekday shift solo**, and **ten consecutive paid Sunday orders supervised but not helped.** A bar that never tests Sunday does not test the thing most likely to break. *(There is already an old Jira ticket for a training pack and counter signage — close it in favour of this.)*
- **The Sunday throughput drill** — 45 orders in 100 minutes on the real tablet, measured per trading window so an evening service passes on its own figures rather than being averaged into a fast morning.
- **The wet-hands drill** — the accessibility check that cannot be automated.
- **The Friday go/no-go** — written down, both names on it. If the training tests have not passed, the four-hour queue hold has not been demonstrated *that week*, the card machine is not proven, or the backup restore is not verified, then Sunday runs on Yoco's own app. Nothing is lost by waiting: the café is already trading the old way.

**Exit criteria:** both training tests passed with a real barista · the throughput drill timed and recorded · the wet-hands drill clean on the primary order path · the go/no-go written and signed.

**Why Phase 3 and not Phase 2 is the gate.** The loyalty deletion has to land first, because until it does the customer app still shows a points balance for a feature that no longer exists. Everything else — offline verification, the blessing fund, the docs clean-up, the cost dashboards, event mode — can happen with the café live.

**Estimate: 2–3 weeks**, and it is now one of the *longest* phases in the plan — because it needs one real weekday shift and then **ten supervised paid Sunday orders**. There are four or five Sundays in a month and a failed attempt retries a week later. Build slack for one.

---

### Roadmap at a glance

| Phase | Name | Est. | Gate on the phase before? |
|---|---|---|---|
| P0 | Recovery & audit | 1½–3 wk | — |
| P1 | Flow fix + card payments | 2–3 wk | **Yes — hard** |
| P2 | Modes, sessions, identity, vouchers | 1½–2½ wk | Yes |
| P3 | Removal: loyalty & packs | 4–7 d | Yes |
| **GL** | **🟢 Go live — training, drills, go/no-go** | **2–3 wk** | **Needs P0–P3. Everything below runs with the café live** |
| P4 | Offline trim & audit gate | 3–5 d | Yes |
| P5 | Blessing fund | 1–2 wk | After P4, per §13.9 |
| P6 | Discord removal | 1–2 d | Needs P1's alerting only |
| P7 | Domain & doc reconciliation | 2–3 d | No — run alongside P8 |
| P8 | Priority 2: cost management | 3–4 wk | Needs P2 **and two weeks of real trading data** |
| P9 | Event mode | 3–5 d | Needs P2 |

**[deviation]** P6 and P7 are marked *interleavable* rather than serial. Neither blocks P8, both are low-risk, and on a two-person team they are the natural filler for whoever is between money stories. §13 sequences them serially; this plan does not, and the reason is capacity shape rather than dependency.

### When does the café actually start using it?

This is the question that matters, and the phase list above answers it badly on its own. The milestones:

| Milestone | Cumulative | What is true then |
|---|---|---|
| **Back online** (P0) | **1½–3 weeks** | FAVO is running on stable hosting again, with a verified database and a restored backup. Not yet trading |
| **Till and card payments work** (P1) | **3½–6 weeks** | A barista can ring up an order and take a card payment. Ten failure paths exercised on staging |
| **Day types, sessions, vouchers** (P2) | **5–8½ weeks** | Free weekday cups reach the right 63 people, Sunday charges correctly, vouchers work, costs deduct correctly |
| **Loyalty and packs gone** (P3) | **6–9½ weeks** | No dead features left on screen |
| **🟢 LIVE AT THE COUNTER** (GL) | **8–12 weeks ≈ 2–3 months** | **The café is taking real orders on FAVO.** Baristas trained and signed off |
| Everything else (P4–P9) | +6–9 weeks | Offline verified, blessing fund, docs, **cost reporting**, event mode — all with the café already live |

**So: live in roughly 2–3 months. The whole plan finished in 3½–5.**

### What actually drives the length — and it is not writing code

Claude writes the code, so build time is close to free. What is left is the part that was never about typing:

1. **Waiting on people.** Matt's answer gates Phase 0's completion. Yoco's reply, the SDK application's clock, the bookkeeper on the fund.
2. **Physical acts.** Two hours with the real Khumo. Four hours holding the queue open. A backup restored. A plug pulled.
3. **Sundays.** The training bar needs **ten supervised paid Sunday orders**. There are four or five Sundays in a month, and a failed attempt retries a week later. This is why go-live is now one of the longest phases in the plan.
4. **Two weeks of real trading**, before the stock-variance criterion can be met at all.
5. **Tier-A review throughput.** At most one money story in review at a time — deliberately, and that cap should not be raised to go faster. See `04-how-claude-builds-this.md` §3.

**The one place slack is worth adding rather than removing:** a second Sunday, in case the supervised test does not pass first time.

Two figures neither of which is confirmed sit under all of this — see the assumptions table. And every number here is reasoned rather than observed, which is why Phase 0 ends with a re-baseline.

### If we need it faster later — options, not a re-plan

**These are deliberately not built into the roadmap.** The plan stays at its honest estimate: this team has no recorded velocity yet, so the range is wide, and committing to the fast end of an unvalidated figure is how a plan loses credibility with leadership the first time it slips. Beating an honest estimate is a better position than missing an optimistic one.

But the levers are written down here so that if the schedule comes under pressure — a slow Yoco reply, a month where Nikao has no hours, leadership asking for something sooner — the options are already thought through rather than invented in the moment.

**The three that work, in order of effect:**

1. **Go live on weekdays first, Sunday later.** Weekday mode has **no payment step at all** — free coffee, own mugs, no card machine, no cups deducted. So a weekday-only go-live needs Phase 0, the order-flow half of Phase 1, the entitlement fix and mode-aware deduction — and **none** of the card chapter, the ten error paths or the R1.00 gate. That now lands at roughly **4–6 weeks to real daily use with 63 office staff**, with Sunday card sales following a few weeks later. ⚠ It also skips the supervised-Sunday training test, which is the single longest item in the go-live phase.
   *A side benefit worth noting:* §6.2.1 says the recents grid is empty on a clean database and the ≤ 3-tap weekday budget is only measurable **from the second week of trading**. Weekdays running early is what makes that budget measurable at all.
   *The cost:* two go-lives and two training moments instead of one.
2. **Split the loyalty deletion.** Remove the screens before go-live (2–3 days), delete the server code and tables after. §13.3's own sequence already puts screens first, so this is a split rather than a change. **Saves ~1½–2 weeks.**
3. **More review attention on Phase 1 specifically.** The payment work is now paced by Tier-A review, not by build time. Two people clearing one money story a day rather than one every three days is the difference between 2 and 3 weeks. **This is the lever that replaced "more of Nikao's hours"** now that nobody is typing.

**Two things that could be deferred past go-live with no real loss:** event mode (P9) and the blessing fund (P5, which cannot go live until the bookkeeper agrees the accounting anyway). **Takes 4–6 weeks off the tail.**

**What must never be compressed**, however tight it gets:

- The R1.00 test and the ten error paths of §6.8.4. Six of the ten describe a failure nobody at FAVO has ever seen, and L02 means a wrong charge has no remedy but a free drink next time the person comes in.
- The four-hour live-queue hold through the edge. It is the thing that broke the previous host.
- The backup restore rehearsal. A backup nobody has restored is not a backup.
- The reviewer rule on anything touching money.
- Both training tests, including the supervised Sunday. A bar that never tests Sunday does not test the thing most likely to break.

**And the cheapest speed-up of all: re-baseline after Phase 0.** Phase 0 produces the first real measurements this plan has — actual hours against actual work, the four responsiveness figures, the audit's true coverage. Re-derive the remaining estimates from those actuals rather than from this document's guesses. The estimate that matters is the second one.

---

## 4. Phase → epic → owner map

**This is a map of *primary* ownership, not exclusive ownership.** Nobody's name being absent from a row does not mean they cannot work on it. Every money, auth, entitlement and Yoco row carries a **required reviewer** and that column is not optional.

| Phase | Epic | Primary | Required reviewer | Money/auth? |
|---|---|---|---|---|
| P0 | E0.1 Host, Postgres, migrations, seed verification | Nikao | Mia | — |
| P0 | E0.2 Domain, TLS, secrets, key rotation | Nikao | Mia | **Yes** (secrets) |
| P0 | E0.3 Backup, PITR, restore rehearsal | Nikao | Mia | — |
| P0 | E0.4 Yoco device setup + the R1.00 gate | Nikao | Mia | **Yes** |
| P0 | E0.5 Edge validation + responsiveness baseline | Nikao | Mia | — |
| P0 | E0.6 Requirement → code → test traceability audit | **Mia** | Nikao | — |
| P0 | E0.7 Commercial terms (OPEN-08) | Nikao ↔ Matt | Mia informed | — |
| P0 | E0.8 Layer 2 design foundation (§17.6) | **Mia** | Nikao | — |
| P1 | E1.1 Order flow fix, L28 binding, recents grid | **Mia** | Nikao | **Yes** (entitlement adjacency) |
| P1 | E1.2 Line controls — stepper, shot picker, L37/DEF-E | **Mia** | Nikao | — |
| P1 | E1.3 Card tender happy path | Nikao | **Mia** | **Yes** |
| P1 | E1.4 Payment error paths & recovery (§6.8.4, S4) | Nikao | **Mia** | **Yes** |
| P1 | E1.5 Discount arithmetic — DEF-A/B/C, L41/L42 | Nikao | **Mia** | **Yes** |
| P1 | E1.6 Deferred settlement & close sweep | Nikao | **Mia** | **Yes** |
| P1 | E1.7 Alerting (§9.6.3) + de-duplication | Nikao | Mia | — |
| P1 | E1.8 PWA install onboarding, iOS push honesty | **Mia** | Nikao | — |
| P2 | E2.1 Sessions & opening window | Nikao | Mia | — |
| P2 | E2.2 Identity, entitlement repoint (R15), audience | Nikao | **Mia** | **Yes** (entitlement) |
| P2 | E2.3 Rota, shift-start push, Hand over | **Mia** | Nikao | **Yes** (attribution) |
| P2 | E2.4 Walk-in tracking | **Mia** | Nikao | — |
| P2 | E2.5 Mode- & shot-aware deduction, Extra Shot deletion | Nikao | Mia | — |
| P2 | E2.6 The Untracked hot drink voucher | **Mia** (POS) / Nikao (server) | each other | **Yes** (write-down) |
| P2 | E2.7 `app_config`, T06/T11/T12, session lifetime, rate limits | Nikao | **Mia** | **Yes** (auth) |
| P3 | E3.1 Loyalty & pack removal | **Mia** | Nikao | — |
| P4 | E4.1 Offline trim & audit gate | Nikao | Mia | — |
| P5 | E5.1 Fund entity, code, members, permissions | Nikao | **Mia** | **Yes** |
| P5 | E5.2 Fund money in (`beginFundTender`, cash/EFT) | Nikao | **Mia** | **Yes** |
| P5 | E5.3 Fund money out (draw, chips, freeze, cancel) | **Mia** (POS) / Nikao (server) | each other | **Yes** |
| P5 | E5.4 `/admin/funds`, dormancy job, liability digest | Nikao | **Mia** | **Yes** |
| P6 | E6.1 Discord deletion | Nikao | Mia | — |
| P7 | E7.1 Domain & doc reconciliation | **Mia** | Nikao | — |
| P8 | E8.1 Live COGS dashboard — per-mode, per-shot, labels | **Mia** | Nikao | — |
| P8 | E8.2 Ministry rollup, `logExpense`, `/admin/expenses` | Nikao | **Mia** | **Yes** |
| P8 | E8.3 Weekly ops summary + write-down block | **Mia** | Nikao | **Yes** |
| P8 | E8.4 `/admin/yield` recosting | **Mia** | Nikao | **Yes** |
| P8 | E8.5 FIXTURE-A / FIXTURE-B certification | Nikao | **Mia** | **Yes** |
| P8 | E8.6 POS Day summary and history (§7.5) | **Mia** | Nikao | **Yes** |
| P9 | E9.1 Event mode | Nikao | Mia | — |
| P10 | E10.1 Training pack, training bar and the drills | **Mia** | Nikao | — |
| P10 | E10.2 Friday go/no-go | **Both** | Both sign | — |

---

## 5. The ownership rule — stated here so it is a rule, not an implication

> **No epic or story touching money, authentication, entitlements, the Yoco integration, or a discretionary write-down may be owned by one person with no second reviewer. Every such item names a primary owner *and* a required reviewer — the other person — and it does not merge until that reviewer has approved it, even when that reviewer's primary focus is elsewhere.**

Three reasons this is not ceremony on a two-person team:

1. **The PRD says so about itself.** Appendix D: "The payment chapter is new text and has had no independent review … the same author wrote and swept all of it. **Treat every payment row as needing one independent check.**" And: "No part of the work merged into v7.0 was read by anyone but its author." The specification is unreviewed in exactly the areas the code is riskiest.
2. **L02 leaves no remedy.** FAVO does not process refunds and there is no void. A wrong charge is remedied by a comped drink the next time the person comes in. A payment bug is not a bug you can roll back.
3. **This has already worked here.** Mia's terminology catch surfaced the live R15 entitlement bug (§1.1); her correction on power-vs-network outages changed the offline decision (§8.4); her question about how mode is derived produced the Saturday rule (§4.2). A reviewer who is not the domain owner is exactly how those were found.

**How review works in practice, given one of the two is learning:** the reviewer's job on a money story is not to re-derive the implementation. It is to check four things, all of which are checkable without owning the domain:

- Does every assertion in the story's acceptance criteria trace to a named REQ row or §15.1 gate row?
- Does the test assert the **specific numbers** in the PRD, or a computed expectation? (FIXTURE-A asserts R144.37. A test that recomputes the expected value proves nothing.)
- Is there a path where a failure is **silent** — a `SUM()` skipping NULLs, a zero rendered where UNAVAILABLE belongs, a subscribed state on an iPhone that cannot honour it?
- Does anything **retry** a payment? The only door to a second send is S4 step 3's three-condition test.

---

## 5b. Keeping the split fair, and nobody sitting blocked

Added after Mia raised two fair questions: does one of us get all the interesting work, and does her work wait on his.

> ⚠ **Re-read in the light of Claude writing the code.** Everything below still holds about *ownership* — who specifies a thing, who reviews it, who decides. It no longer describes who types it. The fairness question has changed shape: the scarce resource is now **review attention**, not build hours.

### The fun-versus-boring read is mostly backwards

Worth saying plainly, because the perception matters more than the ticket count. **The single most interesting engineering problem in this plan is Nikao's** — getting a web app to drive a physical card machine over an API whose key step Yoco does not document, and then specifying ten failure paths nobody has ever seen. That is the hard, novel, high-status work.

And **the three genuinely dull jobs in the plan were all Mia's**: auditing 148 rules by hand, deleting loyalty across 76 files, and fixing a wrong web address in 37 files. Those are not the fun work.

So the split is not fun-versus-boring. But it was still unbalanced in a way worth fixing, and there is a second imbalance underneath it: **Mia has more hours available (15–20) than Nikao (10–15 assumed) and fewer tickets (53 against 109).** That is backwards and should be corrected as the plan runs, not defended.

### Four changes

1. **The three dull jobs are split down the middle.**
   - *The 148-rule audit:* **each person audits the half the other will build.** Mia takes the money and reporting rules (REQ-101…177), Nikao takes the till and payment rules (REQ-001…071). It costs nothing extra and it is the cheapest way either of you learns the other's area before it gets written.
   - *The loyalty deletion:* Mia removes the screens, Nikao removes the server code and the tables. The order still matters — screens before data.
   - *The document clean-up:* Nikao takes the ~12 code and infrastructure files, Mia takes the ~25 documents.
2. **Four tickets are paired, not reviewed.** Labelled `pair` on the board: the R1.00 card machine test, the three-condition rule for ever re-charging a card, the fund balance-locking test, and the synthetic money fixture. On those four, reviewing afterwards is not enough — a mistake in any of them costs real money and neither person can catch it alone. Pairing is also the fastest way for an intern to learn a payment path.
3. **Mia writes one server-side thing end to end.** The per-barista weekly giveaway summary (E8.3) — she writes the query, not only the screen. It is read-only, so the worst case is a wrong number on a report rather than a wrong charge, which makes it the right place to learn.
4. **First pick rotates.** At each phase review, whoever carried more of the dull work last phase picks first from the next phase.

### Does Mia's work depend on Nikao's? Yes — more often than the reverse

That is a real structural issue and it is worth managing rather than discovering. Most till screens need a database column or a server action that Nikao writes first.

| Mia's work | Needs from Nikao first |
|---|---|
| Order flow, target binding, recents grid | The `notification_target` column and `createOrder` accepting it |
| Line controls — stepper, shot picker | The `shots` and `quantity` columns |
| Rota and Hand over | The `barista_shifts` table keyed to the session |
| Walk-in logging | The `walk_ins` table |
| Voucher chip | The voucher records and the session's active voucher kinds |
| Fund chips and the top-up screen | The fund tables and the draw action |
| COGS dashboard, weekly summary | The per-mode and per-shot queries |
| PWA install and iOS honesty | The VAPID subject fixed (Phase 0) |

**Two rules make this workable.**

**Rule 1 — schema first.** At the start of every phase, Nikao's first job is to land the database columns and a *stub* of the server action for everything Mia will build that phase, even where the real logic comes later. A stub returning sensible fake data unblocks weeks of screen work and costs him hours.

**Rule 2 — Mia always has an unblocked queue.** These depend on nothing and can be pulled at any time: her half of the 148-rule audit, the whole colour and size system, removing the loyalty and packs screens, her half of the document clean-up, and any test-writing ticket the audit produced. If she is blocked, she pulls from there rather than waiting — and two of those are phase exit criteria, so it is not busy-work.

**The reverse dependency, for completeness:** Nikao waits on Mia only twice — the colour and size system (before any Phase 1 screen can be built to spec) and the audit gap list (which feeds what he builds in Phases 1 and 2). Both are Phase 0, which is the right place for them.

---

## 5c. What Mia does when she finishes and Nikao is behind

The question in plain terms: *if Nikao is short of time, do I take over his tasks, or do I move on to the next phase and leave him behind?*

**Neither, as stated. Both answers have a failure mode.**

**Why "move on to the next phase" does not work.** The phases are ordered by dependency, not preference. Almost everything Mia would build in the next phase needs a database column or a server action from the phase Nikao has not finished — so she would run ahead for a day and then be blocked again, one phase further along, with two phases half-open instead of one. Worse, starting Phase N+1 before Phase N's exit criteria are met is precisely the failure Phase 0 exists to prevent: it means later work sits on top of something unverified.

**Why "take over his tasks" does not work either, on its own.** Three reasons. The ownership rule means a money story she builds still needs *him* to review it, so his involvement does not disappear — it shrinks. She is an intern, and the payment path is the highest-risk code in the product; the PRD's own Appendix D says every payment row needs one independent check. And if she builds it *and* he is too rushed to review properly, the plan has quietly lost its only safety mechanism.

### The rule: triage his backlog into three tiers

**Tier 1 — Mia takes it outright.** Low blast radius, reversible, no money moves. Nikao reviews when he can; it does not wait for him.
- Deletions and clean-up (loyalty server code, Discord, the offline conflict layer, docs)
- Seed data, config values, the settings store
- Admin screens that only read (`/admin/funds`, expenses, reports, recosting)
- Report queries — the ministry rollup, the per-shot margin, the weekly summary
- **Any test the audit found missing** — see the practice below
- Drills and measurements: the throughput drill, the wet-hands drill, the tap-budget timings

**Tier 2 — Mia takes it *with* him, not instead of him.** Real learning, contained risk. He pairs at the start, she carries it, he reviews at the end.
- Database migrations and schema changes
- The session model and mode defaulting
- Stock deduction and the shot multiplier
- The scheduled jobs
- The voucher's server actions

**Tier 3 — stays his, even if the phase waits.** These do not move, however far behind he is:
- Anything that can charge a card or move fund money — `beginTender`, `sendToTerminal`, the recovery lookup, the three-condition rule, `drawFromDonorFund`, `beginFundTender`
- Secrets, keys and the payment adapter
- The four vendor conversations (Yoco, Matt, the bookkeeper)

> **The test for Tier 3, in one line:** if getting it wrong takes money from a customer that FAVO cannot give back, one person does not build it alone and a rushed week is not a reason to change that.

### The practice that helps most, now that Claude writes the code

The original version of this was "Mia writes the test, Nikao makes it pass." With Claude writing both, it becomes something more important:

> **A human writes or checks the acceptance assertion. Claude writes the code and the test. The human's job at review is to confirm the assertion was not weakened.**

This is the guard against the failure the PRD names about itself — *"the same author wrote and swept all of it"* — arriving in a worse form: code written, tested **and** reviewed by the same agent certifies one misunderstanding three times, with three green ticks on it.

It works here because **the PRD already contains the numbers**, arrived at independently of any code: R196.36, R153.64, R144.37, ≤ 4 taps, R20/R20/R30/R40. So the reviewer's question is never *"is this code right?"* — which needs the domain — but **"does this test still assert R144.37?"**, which needs only the spec.

The full protocol, the three review tiers and the in-flight caps are in **`04-how-claude-builds-this.md`**.

### Two more rules

**The slip rule.** If Tier-3 work is more than two weeks behind the rest of a phase, stop adding to the board and re-plan the phase together. Do not let Mia's finished work pile up in `In Review` waiting for a person who has no hours — four items waiting on one rushed reviewer is how a bad approval gets clicked.

**Where to run ahead, if she genuinely has nothing else.** Not the next numbered phase — the two *independent* ones. **Phase 7** (docs and the domain) depends on nothing at all, and **Phase 3** (the loyalty deletion) only needs Phase 2's screens merged. Both are real, both are on the critical path to a release, and neither needs anything from Nikao first. That is what "carry on" should mean.

### And if Nikao's capacity turns out to be genuinely small

Then the plan gets longer, not rearranged — but less so than it used to, because he is no longer typing. What he cannot delegate is **reviewing the money path** and **the four vendor conversations**. At 5 hours a week rather than 10–15, Phase 0 and Phase 1 stretch and nothing else changes shape. **The response is to re-baseline the dates, not to let one person be the only reader of a payment path.**

---

## 6. Risk and open-items register

Every gate named in v7.0, with what it actually blocks. **Most block nothing** — this column is the point of the table.

### 6.1 The two that genuinely gate something

| ID | Item | What it blocks | Owner | Fallback if it resolves badly |
|---|---|---|---|---|
| **OPEN-08** | Transformate commercial terms. Four questions with Matt; **question 4 is the gate — who is contractually on the hook if the server dies at 08:00 on a Sunday** | **Completion of Phase 0.** Gate zero is the migration onto this infrastructure, so it is the point of commitment. It does *not* block starting P0 work | Nikao ↔ Matt | R21 is the one risk in the PRD's table with **no technical mitigation**. If the answer is unacceptable, the decision is a different host — and that decision is far cheaper before gate zero than after. **Also: correct the earlier note to Matt, which flags a future native iOS POS that is no longer the plan** |
| **FACT-1 / the R1.00 test** | How a physical terminal is linked to a Web POS device. Creating the device, sending it a payment and fetching the result are all documented; **this step is not** | **Go-live of card payments** (§15.1 carries it as a gate row). It does **not** block writing payment code — R18 explicitly runs it at gate zero *before* any payment code is written, so the answer arrives at the cheapest moment | Nikao + build | **A delay, not a reversal.** The SDK application is already in the queue; §6.8.0's rejected route is reinstated by a PRD amendment against an approval that already exists. Cost: weeks, and the tap count goes back to 7–9 until it ships |

### 6.2 The ones that block nothing (and must not be inflated into blockers)

| ID | Item | What it actually blocks | Owner | Disposition |
|---|---|---|---|---|
| The Yoco email | Device linking, Khumo Print 2 support, fee retrieval, and whether Yoco's cost figures include the double shot | **Nothing.** Draft is ready. One email answers FACT-1, FACT-2, FEE-1 and §7.0.1b gap 4 | Nikao | Send it in week one. It is free and it has a multi-day clock |
| The SDK application | Insurance only | **Nothing.** "A one-line contingency, not step 0" | Nikao | Submit in P0. It is the only item with an external clock and it is free |
| **FACT-2** | Is the supported-model list Yoco's or a third party's? | **Buying hardware only.** Record the model as "Khumo Print family, pending written confirmation from Yoco" and do not cite the third-party list as a source | Nikao → Yoco | §9.10.1's device lookup returns the terminal's own model and serial number, settling it from Yoco's record the moment the device is created |
| **OPEN-10** | Does a payment send de-duplicate on `client_reference`? | **Nothing.** Narrowed, not closed, and no longer load-bearing | Nikao → Yoco | Default: **assume NOT idempotent.** Safe whichever way Yoco answers — a yes would merely let FAVO relax a rule it does not need to relax |
| **FEE-1** | Does `GET /v1/payments/` return `processing_fees`? | **Nothing.** The daily manual export upload stays the specification in force | Nikao → Yoco | **Must not be built on before it is verified.** If true, it closes §7.5's one regression against the incumbent |
| Double-shot tap count on Yoco today | Validates the §05 speed baseline | **Nothing.** Two minutes with one cappuccino | Whoever is at the counter | Do it on the next Sunday |
| **T11's default of 25** | Vouchers per session before the digest alert fires | **Nothing.** It is a config value, changeable without a deploy | Whoever works the next Untracked Church | One sheet of paper replaces a guess |
| **DEC-15** bookkeeper read | Deferred-income treatment of fund top-ups | **The blessing fund's go-live, and nothing else** | Nikao → HOFMI bookkeeper | Start the conversation in P1. It has a human clock, not a build clock |
| The 45-orders-in-100-minutes figure | Sizes §9.9's infrastructure, T03's windows and two §05 criteria — **and has no recorded source** | Nothing today, but it is an unsourced number two acceptance criteria depend on | Either | Needs provenance or re-derivation. Flag it in P0's audit; do not treat it as measured |

### 6.3 Build risks carried forward from §14, ranked by what they cost

| ID | Risk | L / I | Mitigation in this plan | Rollback |
|---|---|---|---|---|
| **R20** | All ten §6.8.4 error paths ship unobserved — six describe a failure nobody at FAVO has seen | Certain / Med | The R1.00 gate observes three for R1.00; the rest are exercised against Yoco's test credentials on staging **before a real card is presented**. Built in P1 with the happy path, not after it | Deferred mode covers a total outage; S4 covers an individual unresolved payment. **Neither has been drilled** |
| **R18** | The device-link step needs Yoco-side enablement FAVO cannot self-serve | Med / High | Runs at gate zero, before payment code | SDK route, reinstated by PRD amendment |
| **R1** | The live queue fails through the edge, repeating the last failure | Med / Critical | P0 exit criterion 2: ≥ 4 h end-to-end through Cloudflare, not a local test | POS queue polling; the view degrades, the café runs |
| **R16** | Registered iPhone customers silently get no notifications | High if unaddressed / High | E1.8 — install step with explicit iOS instructions; never a subscribed state the device cannot honour. **Plus the VAPID subject fix pulled forward from P7** | Customer collects at the counter; the order is identified by `daily_seq`, the number on the cup |
| **R3** | Loyalty removal breaks unrelated paths — 76 files, shared with orders | Med / High | P3's sequence, suite green at every step, greps as the completion gate | **Restore from the verified pre-removal backup. No partial rollback — which is why the backup is step 1** |
| **R15** | The free-coffee entitlement cannot reach the 63 office staff it exists for | Certain (current behaviour) / High | E2.2, repoint with the `status` column, not after it | None needed — the current state is the broken one, and the database is clean |
| **R13** | COGS inaccurate because ingredient costs are estimates | Certain by decision / Med | `cost_source` on every lot; L39's provisional label. **If the label is dropped during the build the risk comes straight back** | Admin recosts a lot at any time; COGS recalculates forward |
| **R22** | A barista opens a fund against a genuine card payment and draws it down for friends | Low / High | A name on the fund; immediate Admin push on every unnamed one; per-barista fund-draw line; rename/re-link/sweep stay at the desk | The ledger is append-only and names the staff member on every entry |
| **R23** | R5,000 typed where R500 was meant | Low / High | T13 checked **before the send**; the amount confirmed on a screen showing the figure large | Partly self-remedying — the money stays the customer's to drink |
| **R19** | The card machine goes off the wifi mid-Sunday and nobody notices | Med / High | The 2-minute alert to **the barista's own device** — created by the Web POS decision and recorded as such | Deferred mode; settle when it answers; §6.7 path B |
| **R25** | The voucher tin is never counted, so L43's control exists on paper only | Med / Med | NULL is distinguishable from zero; `closeSession` prompts; §7.3.1 shows the count of skipped days | None needed for money — a voucher takes no cash. What is lost is the control |
| ⊕ **New — plan risk** | **Nikao is the single point of failure on the money path.** He owns Yoco, hosting, both vendor conversations, and the primary build of every payment epic | Med / High | The reviewer rule in §5 puts Mia's eyes on every money story, which is the mitigation available. Beyond that: write the R1.00 gate results up **in the repo**, not in a chat | If Nikao is unavailable mid-P1, P2's non-payment work, P0's audit, P3 and P7 are all workable by Mia alone |

**Not in this register, deliberately: the ingredient-costing question.** It is closed. §7.0.2 already specifies `unit_cost = lot.cost_zar / lot.yield_units` and `line_cogs = quantity × (Σ(recipe_qty × unit_cost × shot_factor) + cup_cost + lid_cost)` — recipe quantity and unit cost are stored separately and multiplied, so updating one lot's price recalculates every drink automatically. It needs ordinary implementation in P8 and no task beyond that. See `claude/open-item-ingredient-costing-gap.md` for the full record.

---

## 7. Definition of done

A story is done when **all** of these are true. This is not a generic checklist — every line ties to something the PRD can be checked against.

**Correctness**
1. Every Appendix C requirement row the story cites has a **passing automated test that asserts the PRD's own numbers and enums**, not a recomputed expectation.
2. Where §15.1 carries a gate row covering this story, that row's unit, E2E and manual-drill columns are each satisfied or explicitly marked n/a with a reason.
3. Where §05 carries a success-criterion number covering this story (a tap budget, a latency figure, a percentage), it has been **measured and recorded**, on the real tablet through the edge where §05 says so.
4. **No regression in the existing suite.** `bun typecheck`, `bun lint`, `bun test:unit` green, no exceptions. This is a hard gate on every story in every phase, not a final check.

**Money and data discipline**
5. Every mutation and every refusal writes an `audit_log` row; a failure to audit fails the transaction; `GET /api/admin/audit-coverage` returns 0 orphans.
6. Any migration ships with a **tested down script**, and CI has run `down` + `up` on it.
7. No figure renders as zero where it should render **UNAVAILABLE** (absent input) or **provisional** (estimated input). These are three different states with three renderings, and conflating any two of them is a defect, not a nicety.
8. Nothing in the diff retries a payment, and nothing writes `payments.status='successful'` outside the two paths §10.2.1 names.

**Process**
9. Where the story is a money/auth/entitlement/Yoco story, the **named reviewer has approved it**. The reviewer field is populated before the story enters In Progress, not after.
10. Where the story changes behaviour that `docs/API.md`, `docs/BUSINESS_RULES.md` or `docs/DATA_MODEL.md` describe, those docs are updated in the same PR (`docs/API.md` is **generated from §11, never consulted by it**).
11. The ship record — deploy SHA, URL, smoke result, audit-coverage result — is on the Jira issue. **That record is the ship notification; there is no chat-channel ping.**

**A phase is done** when every story in it is done *and* the phase's exit criteria in §3 are each demonstrably true. Exit criteria are written as assertions with numbers in them for exactly this reason: "payments are finished" is not checkable and "FIXTURE-A asserts contribution R144.37 and the flag renders provisional" is.

---

## 8. Working agreements

### 8.1 Git and PR workflow

Nothing was specified, so this is a proposal sized for two people.

- **`main` is protected.** No direct pushes. Required: PR, one approving review from the other person, green CI.
- **One short-lived branch per story**, named `favo/<JIRA-KEY>-<short-slug>` (e.g. `favo/FAVO-117-shot-picker`). Days, not weeks — a branch open longer than a week is a story that should have been split.
- **Squash merge to `main`, with the Jira key in the commit message** (§15.2's "WI key" is the Jira key from here on).
- **Migration PRs are their own PR**, never mixed with feature code, and CI runs `down` + `up` on every one.
- **Deploy is automatic on merge to `main`** (§9.7). A POS fix is a deploy, not a release — one of the things the Web POS decision preserves.
- **Post-deploy smoke is read-only.** No mutating tests against live data, and **specifically no payment sent to the live card machine from a smoke test, because there is no void.**
- New capabilities ship behind a flag where practical. **Removals do not** — a half-removed loyalty system is worse than either state.

### 8.2 Environments

Three, and keeping them distinct is a Phase 0 deliverable, not an afterthought.

| | What it is | Who touches it | Yoco |
|---|---|---|---|
| **Local** | Each person's machine | Both | Mocked. Never a real key |
| **Staging** | A separate environment alongside production on Transformate (§9.7) | Both, freely | **Yoco's own test credentials.** Every §6.8.4 failure path is exercised here before a real card is presented anywhere |
| **Production** | `favo.hofmi.net`, the café's live system | Deploys only, via CI | Live key, in Infisical, server-side only |

> ⚠ **"Get production back up" must never mean "test against the live church café."** The only thing that may touch the real Khumo is §6.8.2's R1.00 gate, deliberately, once, with R1.00 of real money, outside trading hours — and the de-duplication drill, which takes the machine off the wifi rather than charging anything.

### 8.3 Communication cadence

No PM, no scrum master, two people who already talk. The rhythm below adds three things and no meetings that were not asked for.

- **Daily async check-in, written, one paragraph.** Yesterday / today / blocked-on. Written rather than spoken so it survives a day when one of you is at Bible Institute or on a vendor call. If it takes more than two minutes to write, it is too long.
- **Weekly joint board review — 30 minutes, Friday.** Walk the board together: what moved, what is stuck, what the next week's WIP is. **Friday because Mia already writes a weekly report to HOFMI leadership that day** — the board review and the report draft themselves off the same material, which is one pass instead of two.
- **A money-review slot, on demand.** Whenever a payment / entitlement / fund story is ready for review, the two of you look at it together rather than trading comments. Half an hour, live if possible. This is the §5 rule made practical: with two people, "async code review" on a payment path usually decays into an approving click.
- **A written decision log.** Any decision that changes what the PRD says goes into the repo as a **PRD amendment**, not into a chat message. v7.0's whole Appendix B exists because earlier versions did not do this. Chat is not a record.

### 8.4 Rollback plan for the recovery phase specifically

The question is: what happens if the always-on hosting move is not smooth before a Sunday?

**The reassuring half:** production is *already* down, and the café is *already* trading on Yoco's own app with a paper queue. So there is no working system to break. A failed cutover is a **delay, not an outage** — the café keeps doing exactly what it did last Sunday.

**What to do anyway, so the delay stays cheap:**

1. **Never cut over late in the week.** Do the gate-zero cutover on a Monday or Tuesday, so there are four weekday trading days of real use before the first Sunday touches it.
2. **The Khumo stays paired to Yoco's own app until Phase 1 ships and its gates pass.** FAVO going live on the host does not mean FAVO takes the money — those are two separate cutovers, and the second one is gated on §15.1's payment row.
3. **A Sunday go/no-go, on the Friday.** If the live-queue 4-hour hold has not been demonstrated *that week*, the answer is no, and Sunday runs on Yoco's app. Nobody negotiates this on a Saturday night.
4. **If FAVO is live and fails mid-Sunday:** §14's catastrophic plan — a static "We're back at the counter" page, paper for the day, restore overnight, reconcile the next morning. The restore path is only real if P0 exit criterion 3 was actually done.
5. **If the host itself is the problem** (rather than FAVO's code), that is R21 and OPEN-08's question 4, and the answer to it is the only thing that says who fixes it. Which is why it is a gate-zero condition and not a background conversation.

---

## 9. What this plan is least sure of

Written in the same spirit as the PRD's own Appendix D, because a plan that hides its soft spots gets trusted in the wrong places.

1. **Nikao's capacity is a guess, and he is on the critical path for P0 and P1.** Everything from "6–9 months" downward moves if that guess is wrong.
2. **The R1.00 gate has not run.** Until it does, Phase 1's whole payment block is planned against documentation rather than proof — which is the PRD's own position, not a pessimistic reading of it. One independent check does support the PRD here: Yoco's published Web POS payment endpoint confirms `client_reference` is a required caller-supplied field, confirms the response carries a `redirect_url` "that can be loaded into an iFrame, window, or new tab **to accept merchant input**", documents **no** idempotency mechanism, and says **nothing** about how a physical terminal is linked to a device. All four match what v7.0 says about itself. The `redirect_url` line is the one worth watching: if that merchant input is required on every payment, the Sunday budget is 5 taps, not 4.
3. **The traceability audit (E0.6) might find more than it expects.** "909 tests green" and "148 requirements covered" are different claims, and nobody has checked the second. If the audit finds a large uncovered block, P0 grows and P1 starts later.
4. **A final gap check found four requirements with no home, and there may be more.** The barista training bar, the Sunday throughput drill, the stock-count lid band and the monthly sign-off were all in the PRD and absent from the first draft of this plan — they are now Phase 10 and two Phase 8 tickets. A fifth gap is still open: §15.3 says five operational drills from an old handover document "still stand" but does not say what they are, and one of the five is already known to be retired. **Somebody has to find that document.** It is a ticket in Phase 0.
5. **The estimates are derived from the PRD's own §13 figures plus a capacity guess.** They have no historical velocity behind them, because this team has no recorded velocity. Re-derive them after P0 with actuals.

---

## Sources

Primary: **FAVO Café PRD v7.0** (18 Sep 2026), read in full from `claude/FAVO-PRD-v7.0-snapshot.html` in this project. Secondary: `claude/prd-v5.2-summary.md`, `claude/open-item-ingredient-costing-gap.md`.

External, verified for this plan:
- [Create Web POS Payment — Yoco Developer Hub](https://developer.yoco.com/yoco-api/webpos/create-web-pos-payment-v-1-webpos-webpos-device-id-payments-post)
- [In-person getting started — Yoco Developers](https://developer.yoco.com/in-person/getting-started/)
- [Yoco API reference](https://developer.yoco.com/api-reference)

External, as supplied in the research brief and not independently re-verified here: Atlassian on [epics, stories, themes and initiatives](https://www.atlassian.com/agile/project-management/epics-stories-themes) and [Kanban vs Scrum](https://www.atlassian.com/agile/kanban/kanban-vs-scrum); Stripe on [idempotent requests](https://docs.stripe.com/api/idempotent_requests); Square's [Terminal API overview](https://developer.squareup.com/docs/terminal-api/overview); NN/g on [touch target size](https://www.nngroup.com/articles/touch-target-size/); ThoughtWorks on the Strangler Fig pattern.
