# FAVO Café — Build Plan · 02 · Nikao's tasks

**Read `00-overview-and-roadmap.md` first** — it holds the source-of-truth resolution, the phase exit criteria, the risk register and the ownership rule this document assumes.

> ⚠ **This split is a proposal and you have not seen it.** It was written from the PRD and from what the open items say you already own (the Yoco terminal testing, the Transformate conversation). Nothing here is decided on your behalf — adjust it with Mia at the first board review. The one thing that is not up for adjustment is the **ownership rule**: every money, auth, entitlement and Yoco item names Mia as required reviewer, because v7.0's own Appendix D says the payment chapter "has had no independent review" and "the same author wrote and swept all of it."
>
> ⚠ **Your capacity is an assumption** — planned at ≈10–15 hrs/week, now spent on **reviewing, deciding and the vendor conversations** rather than building. You are still the critical path for Phase 0 and Phase 1, but for a different reason: the money path cannot merge until you have read it.
>
> **What you cannot delegate, however short the week is:** reading the payment code, the four vendor conversations (Yoco, Matt, the bookkeeper), and the physical acts — linking the Khumo, sending the R1.00, restoring the backup. Everything else can move to Mia or be handled by CI. `00-overview-and-roadmap.md` §5c has the tiering.

> ⚠ **Claude writes the code.** Every row below is something you **own, specify, review and verify** — not something you type. "Build X" means: check the requirement rows are right, have Claude build it, then confirm the acceptance assertion still asserts the spec's own numbers. The review tiers, the in-flight caps and the four questions to review against are in **`04-how-claude-builds-this.md`**. The traps Claude must not fall into are in **`CLAUDE.md`**, which goes in the repo root.

**How to read a row.** Every story cites the Appendix C requirement IDs it satisfies. Those IDs are what the test asserts.

---

## Week one, before anything else — three items with external clocks

These are not a phase. They are three things that cost an hour and then wait on other people, so they should be in flight before any code is written.

| # | Item | Why now | Blocks |
|---|---|---|---|
| N0.0.1 | **Send the Yoco email.** Draft is ready. It answers FACT-1 (how a terminal links to a Web POS device), FACT-2 (is the supported-model list Yoco's or a third party's, and does it cover Khumo Print 2), FEE-1 (does `GET /v1/payments/` return `processing_fees`), and §7.0.1b's gap 4 (do Yoco's cost figures include the double shot) | Free, multi-day turnaround, four answers | Nothing — but FACT-2 blocks buying hardware, and an early answer to FACT-1 might make the R1.00 gate a formality |
| N0.0.2 | **Submit the Yoco SDK integration application.** Insurance only, and "a one-line contingency, not step 0" | It is the **only item in the whole plan with an external approval clock**, and it is free to send. It is thrown away if the R1.00 test passes | Nothing |
| N0.0.3 | **Get Matt's answer on the Transformate terms (OPEN-08).** Four questions; **question 4 is the gate — who is contractually on the hook if the server dies at 08:00 on a Sunday.** ⚠ The earlier note to Matt also needs correcting: it flags a future native iOS POS, which is no longer the plan | It must land **before gate zero completes**, because gate zero is the commitment to this infrastructure. R21 is the one risk in the PRD with no technical mitigation | **Phase 0's completion** |
| N0.0.4 | **Open the DEC-15 conversation with HOFMI's bookkeeper**: a fund top-up is money owed in coffee, not income, until the coffee is drawn | It gates the blessing fund's go-live and nothing else — but it is a conversation with a person, and those have their own clock. Starting it in Phase 5 is starting it late | Phase 5's go-live only |
| N0.0.5 | **Put PRD v7.0 in the repo and repoint `CLAUDE.md`** (which currently points at `FAVO_PRD_v3.md`) | An hour, and it stops every future session picking up a stale answer. The rest of §13.6 can wait for Phase 7; this cannot | Nothing — but it prevents the whole class of problem |

---

## Phase 0 — Recovery and audit (gate zero)

This phase is mostly yours. §13.0 executed in full — plus one shared job.

### E0.6 (shared) — your half of the 148-rule audit *(Mia owns the register; Mia reviews)*

**Split on purpose: you audit the rules Mia will build, and she audits the rules you will build.** You take **REQ-001…071** — the till, the eight worked sequences and the money path, 71 rows. Fill in three columns per row: is it built, is there a test, does the test pass. Record "partially" with a one-line note rather than a yes/no you cannot defend.

It costs a few hours and it is the cheapest way either of you learns the other's half before it gets written. It also means the person reviewing your payment work has already read the till rules end to end.

### E0.1 — Host, Postgres, migrations, seed verification *(Mia reviews)*

**There is no data migration.** FAVO starts on a clean database — no orders, customers, inventory, entitlement rows or financial records carried over from Supabase. That settles three things: §9.4's five-year retention starts now on the new instance; the RPO/RTO figures govern the new system only; and **every corrective migration in §10.3 and §10.3.1 is a no-op on first run**. What it does not excuse: the schema still has to arrive in the right shape, and a seeded database still has to be verified before trading.

| # | Story | Satisfies |
|---|---|---|
| N0.1.1 | Stand up the always-on container/VM on Transformate with **co-located Postgres over a direct session connection**. No serverless, no pooler-only path — several serverless-Postgres products do not support `LISTEN/NOTIFY` at all and are not candidates regardless of other merits | §9.1's three hard requirements |
| N0.1.2 | Two code simplifications the direct connection unlocks: remove `prepare: false` from `db/index.ts` (the PgBouncer workaround) and collapse the two-connection-string arrangement (pooled 6543 + session 5432) to one | §9.2 |
| N0.1.3 | `Africa/Johannesburg` on the container — **all day-close and wall-clock logic depends on it** | §9.2 |
| N0.1.4 | Apply migrations to the §10 target shape: 35 − 7 removed + 9 added = **37 tables** | §10 |
| N0.1.5 | Seed the menu, prices (§7.0.1), recipes and ingredient costs | §13.0 |
| N0.1.6 | **Seed verification — this is a gate, not a checklist.** No ingredient consumed by a live recipe costs `0.0000`; the three alternative milks (oat, macadamia, almond — **not macadamia alone**) are seeded with real costs; every lot carries `cost_source = 'estimate'` unless an Admin has recosted it; the profit flag confirmed rendering `provisional` | **REQ-132** |
| N0.1.7 | **Reconcile the bean cost.** The seed says R3.21/cup; Yoco's implied figure is ≈R8.76/cup — a ~170% disagreement on the input that appears in every coffee. Record which source you took and set `cost_source` to `invoice` **only if a real invoice backs it** | §7.0.1b defect 1 · R13 |
| N0.1.8 | **Confirm the Chai Latte price.** §7.0.1 marks R20 "unconfirmed" — no sale on 2026-08-16, and the dev seed carries a different figure. §13.0's seed-verify step is the gate | §7.0.1 |
| N0.1.9 | ⛔ **Do not delete "the orphaned gram/ml lots" as a class.** Only `lot_espresso_beans_001` and `lot_whole_milk_001` are orphaned. Deleting the powder lots removes chocolate and chai from the cost model entirely | §7.0.1b gap 3 |
| N0.1.10 | Record the powder-scale dispute (gap 3) as a **stated open data question**, not a correction. Correcting it moves `cogs_zar` R196.36 → R210.61 and contribution R144.37 → R130.12 — a 9.9% swing, which is exactly why it may not be done on a guess, and no single chocolate price reconciles both Mocha and Hot Chocolate | §7.0.1b gap 3 |

### E0.2 — Domain, TLS, secrets, key rotation *(Mia reviews — secrets)*

| # | Story | Satisfies |
|---|---|---|
| N0.2.1 | Attach `favo.hofmi.net` via **Cloudflare for SaaS custom hostname on Transformate's zone**. The zone stays at Xneelo; there is **no zone migration** in this plan | §9.3 |
| N0.2.2 | Run `dig +short MX hofmi.net && dig +short NS hofmi.net && dig +short favo.hofmi.net` **before and after**. Acceptance: MX unchanged, NS still Xneelo, `favo.hofmi.net` resolving, cert valid. **Anything else is a stop** | R2 |
| N0.2.3 | Set `AUTH_URL` and `PUBLIC_BASE_URL` | §13.0 |
| N0.2.4 | **Rotate the database password** (exposed during development) and re-issue Yoco and VAPID keys into Infisical | §13.0 |
| N0.2.5 | Move ~15 secrets off Vercel into Infisical. The Yoco secret key lives here **and only here** | §9.7 · L40 |
| N0.2.6 | ⚠ **Fix the two silently-failing `hofmi.org` files now, not in Phase 7:** `src/server/push/vapid.ts` (a wrong VAPID subject is a silent push-delivery failure) and `tests/e2e/prod-smoke.spec.ts` (gate zero's own smoke test asserts against a domain that will never resolve) | §13.6, pulled forward |

### E0.3 — Backup, PITR, restore rehearsal *(Mia reviews)*

| # | Story | Satisfies |
|---|---|---|
| N0.3.1 | Continuous WAL archiving to encrypted off-site storage, **RPO ≤ 5 minutes** — not nightly dumps, which would put an entire Sunday's takings inside the loss window | DEC-05 |
| N0.3.2 | Nightly full base backups retained per the ≥ 5-year rule | §9.4 |
| N0.3.3 | **Restore the backup and record the elapsed time.** A backup that has never been restored is not a backup, and this is the first measurement of RTO | §15.1 gate-zero row |
| N0.3.4 | Calendar the quarterly re-rehearsal, with an owner. A failed rehearsal is an **immediate alert**, not a note in a report | §9.4 · §9.6.3 |

### E0.4 — Yoco device setup and the R1.00 gate *(Mia reviews)*

**This is the single highest-value hour in the plan.** It runs before any payment code is written, so the answer arrives at the cheapest possible moment.

| # | Story | Satisfies |
|---|---|---|
| N0.4.1 | Generate the API key in Yoco's developer console for FAVO's own business account | §6.8.2 |
| N0.4.2 | Create a Web POS device named **FAVO Till**; put its id in `app_config.webpos_device_id` — Admin-writable and audited, **not an environment variable**, so a replacement machine does not need a redeploy | §9.10.1 · REQ-065 |
| N0.4.3 | **Link the Khumo to that device.** ⚠ This is the undocumented step (FACT-1) and the reason for the email | R18 |
| N0.4.4 | Send **R1.00** and watch whether the Khumo wakes up asking for a tap. ⚠ **Do this with Mia in the room** — she is the reviewer on every payment story that follows, and this is the only time anyone gets to watch three of the failure paths actually happen | §15.1's payment gate row |
| N0.4.5 | **Count the taps FAVO's own screen costs**, and record whether a merchant confirmation is required in FAVO's browser. §05's Sunday budget is amended **by this measurement rather than by an argument** ⚠ Yoco's published endpoint returns a `redirect_url` "that can be loaded into an iFrame, window, or new tab to accept merchant input" — if that input is required every time, the budget is 5 taps, not 4 | §05 · §6.8.2 |
| N0.4.6 | **Let it decline.** Record what the fetch returns | REQ-010 |
| N0.4.7 | **Take it off the wifi mid-payment.** Record what the fetch returns. These two steps are the cheapest moment to observe error paths nobody at FAVO has ever seen | R20 |
| N0.4.8 | Record the terminal's `model` and `serial_number` from the device lookup — this settles **FACT-2 from Yoco's own record** rather than from a third-party list | FACT-2 |
| N0.4.9 | **Write the results up in the repo**, not in a chat message. Everything in the payment chapter rests on this hour | §15.1 |

**If step N0.4.3 fails:** it is a delay, not a reversal. The SDK application (N0.0.2) is already in the queue, §6.8.0's rejected route is reinstated by a PRD amendment, and the plan loses weeks rather than the decision. Do not start writing SDK code against it unless and until the gate actually fails.

### E0.5 — Edge validation and the responsiveness baseline *(Mia reviews)*

| # | Story | Satisfies |
|---|---|---|
| N0.5.1 | **Validate the live queue through the edge for ≥ 4 hours.** This is the gate the previous host failed — a local test that bypasses Cloudflare does not satisfy it | **REQ-069** |
| N0.5.2 | Measure and record the four §05.1 figures through the edge: tap-to-visual < 100 ms, order commit < 1.5 s p95, cold load < 5 s, usable at 3G-grade | REQ-070 |
| N0.5.3 | **The residency decision point.** App and DB are co-located in the EU; the till is in Johannesburg. This is the one moment changing region is nearly free, and **the revisit trigger is the 1.5 s commit figure**, not a tap figure | DEC / §9.4 |
| N0.5.4 | Retire `POST /api/payments/yoco/webhook` — **404, retired, not re-pointed.** FAVO subscribes to no webhook and requires no public payment endpoint | §11.1 · §15.1 |
| N0.5.5 | Enable connection-drop logging on the tablet, so §8.4's "monthly-ish" becomes a measured number | DEC-12 |
| N0.5.6 | Uptime and health checks on `GET /api/healthz` — no auth, `200 {ok:true, db:"up", ts}` or `503 {ok:false, db:"down"}`, liveness only, no PII, **never a 500** | §9.8 · §11.4 |

---

## Phase 1 — Card payments (and the money defects)

### E1.3 — Card tender, the happy path *(Mia is required reviewer)*

| # | Story | Satisfies |
|---|---|---|
| N1.3.1 | The `payments` target shape: one row **per attempt, not per order** — `attempt`, `client_reference` (NOT NULL UNIQUE), `yoco_payment_id`, `webpos_device_id`, `amount_zar`, `charged_amount_zar`, `fee_zar` (NULL, never 0), `tip_zar`, `receipt_no`, `settlement_ref`, `sent_at`, `last_checked_at`. Status enum migrates to `pending | successful | declined | unresolved` | §10.3.3 |
| N1.3.2 | `beginTender(orderId)` — reads `client_uuid`, takes `attempt = MAX+1`, writes the `pending` row with `client_reference = client_uuid:attempt` and `webpos_device_id` **read from config once, here**. Serialised per order with `SELECT … FOR UPDATE` so two taps cannot allocate two attempts. **From this moment the order total is frozen** | REQ-026 · REQ-027 · REQ-028 · REQ-065 |
| N1.3.3 | The P4 freeze enforced at a named point: `createOrder`, `compOrderLine`, `applyFreeCoffee`, `cancelOrder` — and, in v7.0, `redeemVoucher`, `removeVoucher` and `drawFromDonorFund` — all reject with `TENDER_IN_PROGRESS` while an attempt is pending or unresolved | REQ-028 |
| N1.3.4 | `sendToTerminal(orderId, attempt)` — sends `amount_zar` and `client_reference`; **persists Yoco's returned payment id and `sent_at` immediately, before any outcome is known**; 10 s timeout; a second call for the same `(orderId, attempt)` is a `VALIDATION` failure, never a re-send | REQ-029 |
| N1.3.5 | `pollTenderResult` on S2's schedule — every 2 s for 30 s, then every 5 s, to a **180 s ceiling from the send**. Writes `last_checked_at`. Returns the status unchanged and **never interprets an error as a status** | REQ-003 |
| N1.3.6 | `recordTenderResult` — asserts `charged_amount_zar == orders.total_zar` (**both integer cents, no × 100 factor** — v5.2 asserted a conversion that would have flagged every card sale as a variance). A mismatch is recorded **at the charged amount** and flagged to T10, never overwritten. Idempotent on `(orderId, attempt)` | REQ-030 |
| N1.3.7 | The **payment adapter** — one server-side parser, the only code that touches a raw Yoco response, returning only the fields §10.3.3 stores. The masked PAN, the scheme token, the cardholder name and any raw copy of the body are **dropped at that boundary** and never reach a log, a column, an error tracker or a client | REQ-031 · L40 |
| N1.3.8 | The DB guarantee: `CREATE UNIQUE INDEX ON payments (order_id) WHERE status = 'successful'` — and the second one on `(fund_topup_id)`, because **Postgres treats NULLs as distinct** and the order index leaves top-ups entirely unguarded | REQ-011 · REQ-174 · COL-5 |
| N1.3.9 | The polymorphic subject: `payments.order_id` nullable under `CHECK (num_nonnulls(order_id, fund_topup_id) = 1)`. **One column change, cheapest to land while the table is being migrated anyway — carried in Phase 1 even if the fund is deferred** | REQ-174 |
| N1.3.10 | `orders.client_uuid` (NOT NULL, UNIQUE), `revenue_day`, `daily_seq` (`UNIQUE (revenue_day, daily_seq)`), all minted inside the `createOrder` transaction. `client_uuid` is **S7b's online idempotency key** — without it, a 10-second timeout, a "reloading" message and a second tap is two orders, two payments and two stock deductions on the one path L02 leaves no remedy for | REQ-017 |

⚠ **Never add `voided` to the payment status enum.** Yoco documents refunds and documents no void. §10.6 forbids reports that default on an unknown value, and a state FAVO can never observe is a state FAVO would guess at.

### E1.4 — Payment error paths and recovery *(Mia is required reviewer)*

**All ten paths of §6.8.4, built with the happy path, not after it.** Six describe a failure nobody at FAVO has seen; this is R20, rated *Certain*.

| # | Story | Satisfies |
|---|---|---|
| N1.4.1 | The closed error-code set of §6.0.1 — `{ok:false, code, message}` and **no other string is ever returned** | REQ-001 |
| N1.4.2 | The one distinction that must never be conflated **in code or in copy**: a send that **errored with no payment id** → `GATEWAY_UNAVAILABLE`, nothing was created, **safe to offer a retry**; a send that **timed out** → `PAYMENT_UNKNOWN`, a payment may exist FAVO holds no id for, **never retried** | REQ-010 |
| N1.4.3 | `TERMINAL_UNREACHABLE` on a failed device lookup or a device-error send, with `setDeferredMode` **one tap away**. Never a silent retry | REQ-068 |
| N1.4.4 | The 180 s ceiling: FAVO stops waiting, writes `unresolved`, and **does not attempt to cancel** — Yoco documents no way to cancel a Web POS payment in flight, and a ceiling that pretended to cancel would be the most dangerous line in the chapter | REQ-003 |
| N1.4.5 | S4 recovery — `resolveTenderByLookup(orderId)`: fetch by `yoco_payment_id` where FAVO holds one and **by `client_reference` where it does not**. Attach a `successful`; leave everything else `unresolved`. **A fetch error is not a status and never resolves anything** | REQ-008 |
| N1.4.6 | ⚠ **PAIR WITH MIA on this one.** **The three-condition test for a second send**, and nothing else may authorise one: (a) the status resource **read `failed`** — not an error, not `pending`, not empty; (b) two consecutive fetches **≥ 60 s apart** both read `failed`; (c) **≥ 120 s since the send**. Write this as one guarded function with the three conditions named in the code | REQ-009 |
| N1.4.7 | Two successful payments on one order = a double charge that **has already happened**. Attach at the first, flag `duplicate_charge` to T10 **immediately, not at the close**, push the Admin with both Yoco ids and the amount | REQ-011 |
| N1.4.8 | **S4a — `unresolved` is loud immediately.** Push the Admin the moment a payment enters `unresolved`, naming `daily_seq`, amount, barista and session, with one named action: *"Ask the customer whether their card was charged before they leave — the slip from the machine settles it."* Two in one session escalate | REQ-012 |
| N1.4.9 | A declined card **pauses** an order, it does not destroy one: stays in `ordered` with its queue position and bound target, no stock deducted, re-attemptable as a **new attempt with a new reference** | REQ-004 |
| N1.4.10 | `beginTender` serialised so a double-tap returns `TENDER_IN_PROGRESS` rather than opening a second attempt | REQ-028 |
| N1.4.11 | Exercise **every one of the ten paths against Yoco's test credentials on staging** before a real card is presented anywhere | §15.1 |

### E1.5 — The discount arithmetic defects *(Mia is required reviewer)*

All three were **live in v6.0** and are cheaper to fix before the code they affect is written.

| # | Story | Satisfies |
|---|---|---|
| N1.5.1 | **DEF-A / L41** — at most one discount *mechanism* per line (entitlement, comp, or voucher; never two kinds). Enforced at the application layer **and** by `CHECK (discount_zar <= quantity * unit_price_zar)`. ⚠ *Mechanism, not row*: a line may carry up to `quantity` voucher rows, because two visitors who both want the same cappuccino made the same way produce one line at quantity 2 | REQ-143 · REQ-151 |
| N1.5.2 | **DEF-B / L33's ceiling** — reads `line_gross − discount_zar`, not `line_gross`, so a line can never be discounted past its own remaining value. The second term becomes `(highest live menu price + (T15 − 2) × extra_shot_zar) × quantity` — the most expensive drink the menu can produce is a four-shot Mocha at R45, and a remedy that cannot cover the thing it remedies is not a remedy | REQ-152 · REQ-059 |
| N1.5.3 | **DEF-C / L42** — an order whose net charge is R0 **never begins a tender, in any mode**. No `payments` row, nothing sent, completes as `payment_mode='free'`. Reachable in v6.0 in two taps, and it surfaced to the barista as a broken card machine rather than as a comped order | REQ-153 |
| N1.5.4 | `compOrderLine`'s closed reason list — `wrong_drink · wrong_charge · spillage · staff_error · goodwill · donation` — **the `comp_reason` enum is the definition of record**; at most one line per order; two per barista per session with an admin PIN on the third | REQ-059 |
| N1.5.5 | `order_items` columns: `discount_zar` (NOT NULL default 0), `comp_reason`, `shots` (int NOT NULL default 1, CHECK 1..T15), and **`CHECK (quantity >= 1)` only** — ⛔ `quantity` **already exists** as integer NOT NULL DEFAULT 1 at `9aefc2c`. v5.2 commissioned it as new under the name `qty`, which would have created a duplicate column beside the one every §7.0.2 formula reads | §10.3 |

### E1.6 — Deferred settlement and the close sweep *(Mia is required reviewer)*

| # | Story | Satisfies |
|---|---|---|
| N1.6.1 | `setDeferredMode` + `opening_sessions.deferred_*` + **`deferred_entered_by` (`manual | health_check`)** — only a `health_check` entry may auto-exit. A manual entry exits only manually, or a barista who declares a dead machine is ejected from deferred mode by a check that was never red | REQ-006 |
| N1.6.2 | S2a's alerting: an immediate Admin push on entry naming barista, session and reason, **repeating every 30 minutes it stays on**; plus an independent push when written-off value crosses `writeoff_alert_zar` (R100) or 3 orders are written off in one session | REQ-005 |
| N1.6.3 | `settleDeferredOrder(orderId, ref?)` — **queries Yoco before it sends.** `ALREADY_RESOLVED` is derived from FAVO's own rows, and the entire reason a deferred order exists is that FAVO's record may be wrong. **The guard is the query; the enum value is only the message** | §6.0.4 T3 3a |
| N1.6.4 | Path B: capture the standalone machine's transaction reference in `settlement_ref` — what makes the outage fallback reconcilable instead of blind | §6.7 |
| N1.6.5 | `closeDaily()` in its **normative order**: settle-or-write-off **first and unconditionally**, then the L09 stock reconciliation. A mismatch blocks **only the close record**, never the write-off, and never the next day's session | REQ-007 · REQ-036 |
| N1.6.6 | ⛔ **The sweep's definition of unpaid must exclude a fund-paid order.** An order is settled if it holds a successful payment **or** a `donor_fund_entries` spend entry — otherwise every fund-paid coffee books as a bad debt on the day it was paid for. `GET /api/admin/unpaid-orders` takes the same definition | REQ-166 |
| N1.6.7 | **A free order is never swept.** A weekday entitlement cup, a walk-in and a free-posture event order have no payment record by design — sweeping them would book ~63 × R20 ≈ R1,260 of phantom loss every weekday straight into contribution | REQ-007 |
| N1.6.8 | Every write-off row carries `actor_kind='system'` **and `actor_staff_id` set to the barista who took the order**, plus a reason — and the close raises an **Admin approval queue** cleared with a PIN. Until cleared they report as **unapproved**. *Without the actor id, a write-off and a theft produce byte-identical records* | REQ-035 |
| N1.6.9 | `daily_closes` (revenue_day PK, counts, values, reconciliation status, `blocked_reason`, `was_catch_up`) — the close record L09's gate blocks on, and the resume point that makes a crash mid-sweep recoverable rather than skipped | §10.2 |
| N1.6.10 | The close runs at **00:05 SAST**, closing the previous revenue day — not 23:55, which cannot satisfy §10.6's deferred-order invariant for an order rung at 23:57 | REQ-067 |
| N1.6.11 | `GET /api/admin/unpaid-orders` — defined over **unpaid**, not over `yoco_deferred`. The narrower definition hid the S3/S4 orphans from the only list an Admin reads | §11.2 |

### E1.7 — Alerting (§9.6.3) *(Mia reviews)*

**Build this in Phase 1, because Phase 6 cannot delete Discord until it exists and has fired in a test.**

| # | Story | Satisfies |
|---|---|---|
| N1.7.1 | The eight immediate conditions: FAVO unreachable > 2 min · **the card machine unreachable during trading hours within 2 min** · a failed backup/restore rehearsal · any order unsettled at close · two unresolved payments in one session · a stock reconciliation mismatch · admin PIN cooldown · **an unnamed blessing fund created** (ships with Phase 5) | REQ-068 |
| N1.7.2 | ⚠ **The card-machine alert goes to the barista's own device as well as to you.** They are standing next to it and can restart it or fix the wifi; you cannot. This alert is genuinely new and exists **because of** the Web POS decision — a machine can now fail silently while someone stands beside it | R19 · REQ-068 |
| N1.7.3 | The daily digest: storage > 80% · queue-stream disconnects > 60 s as a day count · **the voucher slip variance and T11's session count as one line** · total live fund balance above ~R5,000 | §9.6.3 |
| N1.7.4 | **De-duplication is part of the build, not a follow-up.** A card machine off the wifi for an hour is **one alert plus one resolution notice, not sixty.** Every immediate alert is de-duplicated and names an action — an alert that names no action is not an alert | §15.1's de-dup drill |
| N1.7.5 | The seven scheduled jobs as **server-side timers on one instance**, each with its schedule, missed-run behaviour and audience per §9.6.2. Three rules hold for all seven: a catch-up is **recorded as a catch-up**; **no job may initiate a payment or create revenue**; a failing job **raises once and never retries silently** | REQ-066 · REQ-067 |
| N1.7.6 | Job 4 (unconfirmed-payment reconciliation) now performs the lookup itself — the Web POS fetch is a server-side call, so **recovery no longer depends on anyone standing at the till.** It still never initiates, never re-sends and never creates revenue | REQ-066 |

---

## Phase 2 — Modes, sessions, identity, deduction

### E2.1 — Sessions and the opening window *(Mia reviews)*

| # | Story | Satisfies |
|---|---|---|
| N2.1.1 | ⛔ **Do not run v6.0's narrowing migration.** It commissions a migration from `unique(session_date, opens_at)` down to `UNIQUE (session_date)` that §6.11 reverses. The shipped constraint at `9aefc2c` is **retained**; working this step as v6.0 wrote it does the work twice and writes a migration and a down-script for nothing | COL-14 |
| N2.1.2 | The **one genuinely new object**: a partial unique index allowing at most one open session across the whole table (`WHERE closed_at IS NULL`). *This is what makes "the current session" a definition rather than a search* | §10.6 |
| N2.1.3 | `opening_sessions.mode` (weekday / sunday / event) + `event_window_id` + `setDayMode`, defaulted from **the session's own window by overlap** — never from the day, never from *now*. A default computed against the day gives a Sunday morning the evening's event mode; one computed against *now* leaves a barista opening at 17:45 for an 18:00 service with `sunday` | REQ-056 · COL-8 |
| N2.1.4 | `openSession` rejects with `STALE_STATE` **while a session is open**, not while a row exists for today. A second session on the same date is the normal path | §11.2 |
| N2.1.5 | `closeSession(id)` — sets `closed_at`, prompts for that session's voucher slip count, clears session-scoped state. **Distinct from `closeDaily()`**, which stays per revenue day. Forced at the day boundary and at an event window's expiry, audited | REQ-157 |
| N2.1.6 | Per-session columns: `voucher_slips_counted` (NULL ≠ zero), `voucher_redemptions_recorded`, `voucher_kinds_active`, `closed_at` | REQ-157 |
| N2.1.7 | `daily_seq` runs **across the whole revenue day and is never restarted** — the evening's first order is #38, not #1, or it collides with the morning's numbers on every settlement lookup | COL-30 |
| N2.1.8 | Deferred mode is **session-scoped and now genuinely so** — a machine off the wifi in the morning does not carry a deferred banner into the evening | §6.11.1 |
| N2.1.9 | Saturday: `setDayMode` rejects any Saturday session with no event window. **There is deliberately no Saturday value in the mode enum** — `weekday` would grant free coffee and skip cups, `sunday` would charge | REQ-057 |

### E2.2 — Identity and the entitlement repoint *(Mia is required reviewer — entitlement)*

**This closes R15, rated *Certain / High*: the free-coffee entitlement currently cannot reach the ~63 office staff it exists for.**

| # | Story | Satisfies |
|---|---|---|
| N2.2.1 | `customers.status` (`office_staff | church_member`), set at self-registration. **The value is `office_staff`, not `staff`** — the bare word collides with the `staff` table | §1.1 |
| N2.2.2 | Repoint `staff_entitlement_log.staff_id → customer_id` (FK to `customers`), `UNIQUE(staff_id, day) → UNIQUE(customer_id, day)`, keeping `applied_by_staff_id` pointing at `staff` — **both facts matter and they are different people** | §10.3.1 |
| N2.2.3 | Rename `applyStaffDiscount → applyFreeCoffee`. **The rename is worth the churn: the old name is what made the bug invisible.** The shipped `applyStaffDiscount` sets `orders.total_zar = 0`, zeroing the entire order — the new one discounts **one unit** | REQ-115 |
| N2.2.4 | ⚠ **Do this with the `status` column, not after it.** The entitlement check depends on it, and until both land the weekday benefit reaches nobody it is meant for | R15 |
| N2.2.5 | Auto-application on the weekday path — the barista taps **only to decline**. A dedicated claim screen is for exceptions, never the normal path: v5.0's manual screen made a free cup cost ~7 interactions and a typed name, 63 times a day | REQ-024 |
| N2.2.6 | `ENTITLEMENT_USED` on a second claim — the order **continues as paid**, and the refusal is **audited with `action='reject'`**. R14's whole mitigation is anomaly detection on entitlement claims; unrecorded refusals make it impossible | REQ-025 |
| N2.2.7 | `NOT_ELIGIBLE` for church members, FAVO-staff ids and ineligible categories, also audited | REQ-025 |
| N2.2.8 | Computed broadcast audience from `customers.status` — **never hand-picked, never derived from the `staff` table** | REQ-056 |
| N2.2.9 | `orders` constraints: `notification_target` NOT NULL, `payment_mode` NOT NULL, and `CHECK ((notification_target = 'customer') = (customer_id IS NOT NULL))` — without it a row can claim it will notify someone and carry no customer, which is R16's exact shape | REQ-046 |

### E2.5 — Mode-aware and shot-aware deduction *(Mia reviews)*

**One coordinated pass. Fixing mode-awareness without the shot multiplier produces a deduction path that is mode-correct and ingredient-wrong — harder to spot than being wrong in both.**

| # | Story | Satisfies |
|---|---|---|
| N2.5.1 | Cup and lid **excluded on weekday orders** (reusable mugs), included on Sunday, per the event's switch on events — reading the mode from the session row | REQ-125 |
| N2.5.2 | The shot multiplier: `shot_factor = order_items.shots` for the **coffee** ingredient and **1 for every other ingredient**. Same cup, same lid, same milk | REQ-137 |
| N2.5.3 | **DEF-G — a deduction may span two containers and it must.** A four-shot drink deducts four cups; if the open bag holds two, the line draws from two lots, **completing inside one transaction** by auto-opening the next sealed container. And `line_cogs` costs the coffee term **per unit drawn, at the lot each unit came from** — not four units at the first bag's rate | §15.1's DEF-G row · §7.0.2 |
| N2.5.4 | Delete `Extra Shot` from `menu_customisations` **in the same migration** as `shots` lands, and move the R10 to `config.extra_shot_zar`. Keeping both is two prices for one fact | REQ-054 |
| N2.5.5 | ⛔ **Do not re-do the modification-awareness fix.** `deductForOrder()` is **already** modification-aware — migration `0027_at145_customisation_inventory_effects.sql` shipped it. What remains commissioned is mode-awareness and the shot multiplier | §10.5 |
| N2.5.6 | T15's weekday cap at 2 shots, enforced at the application layer as well as by the picker's rendering | REQ-144 |
| N2.5.7 | Stock deducts at **exactly one point** — `transitionOrder('in_progress')` — in every mode; and `STOCK_EXHAUSTED_AT_MAKE` when it fails after the money is taken, with an immediate Admin push | REQ-021 · REQ-022 |

### E2.6 server half — the voucher's actions *(shared with Mia; you review each other)*

| # | Story | Satisfies |
|---|---|---|
| N2.6.1 | `voucher_redemptions` — `order_item_id`, `session_id`, `voucher_kind`, `discount_zar`, `redeemed_by_staff_id`, `at`, `reversed_at`, `reversed_by_staff_id` | §10.2 |
| N2.6.2 | `redeemVoucher(orderItemId, kind)` — writes `discount_zar = line_unit_price` for **one unit**, listed price, modifications and extra shots together. Rejects: a line carrying a different mechanism (L41); a line already at `quantity` redemptions; a kind not in the session's active list; a line with no net charge; any call while a tender is open or the order is fund-settled | REQ-154 · REQ-151 · REQ-155 |
| N2.6.3 | `removeVoucher` — **a reversal, never a delete.** Apply and remove three times → three rows carrying `reversed_at`, `voucher_cups` counts none of them, six audit entries | COL-29 |
| N2.6.4 | `recordVoucherCount(sessionId, counted)` — keyed to the **session**, prompted by `closeSession`, a variance raises the L09 push as a **digest line**, and it **never blocks the close** | REQ-156 · REQ-157 |
| N2.6.5 | The counting rules: `voucher_cups` counts **live** rows on orders that **reached `in_progress`** — a drink never made consumed no beans and no cup. **Counted as paper, not counted as coffee** | §7.0.2 |
| N2.6.6 | §6.9.4's reclassification: `outreach_cogs` out of `contribution` and into `ministry_cost`, so both sides move by the same amount and **`ministry_net` is unchanged** — while the day still prints `cogs_zar` whole with `outreach_cogs` as its own line beneath it | REQ-158 |
| N2.6.7 | Vouchers **queue and replay offline** — a voucher is a line attribute of order creation with no uniqueness constraint for a replay to violate, so L34's connection requirement does not transfer to it. This is the only discount that queues | §6.0.6 T5 |

### E2.7 — `app_config`, tunables, session lifetime, rate limits *(Mia is required reviewer — auth)*

| # | Story | Satisfies |
|---|---|---|
| N2.7.1 | One `app_config` table keyed `(tenant_id, key)`, jsonb values, **every write audited with before/after and a reason**, Admin-only | §10.4 |
| N2.7.2 | Seed the tunables: `eligible_free_categories`, `extra_shot_zar` (1000), `max_shots_per_line` (4) / `max_shots_weekday` (2), `sunday_windows` (**a list, not one window** — a single window excluded the evening service from every §05 Sunday measurement), `voucher_kinds`, `voucher_expected_max_per_session` (25), `donor_fund_ceiling_zar`, `donor_fund_dormancy_days`, `webpos_device_id`, `writeoff_alert_zar`, `expected_fee_rate_bp` (265), `low_stock_ping_cooldown_min`. **Delete `tender_mode`** | §10.4 · §12.2 |
| N2.7.3 | The config rule: **read once at the point of use, never cached across a request, and recorded onto the row it affects** — so changing config never rewrites history, and a report that read config would rewrite history the moment config moved | REQ-065 |
| N2.7.4 | Session lifetime: **12-hour absolute ceiling**; 5-minute idle lock **outside** the opening window; **no idle lock during an opening window**; the lock preserves everything — the order in progress, the queue, the customer match, an open tender | REQ-061 |
| N2.7.5 | Admin PIN overrides are **single-action**: one action authorised, no admin session started, the barista's not extended, `on_behalf_of_staff_id` recorded | REQ-063 |
| N2.7.6 | Rate limits: customer login 10/account/15 min and 30/IP (**the whole office shares one IP**); registration and reset 30/IP; **admin PIN 5 then a 5-minute cooldown and an immediate alert**; **the barista till session never rate-limited, on any path, by any middleware** | REQ-062 |
| N2.7.7 | ⚠ **Write the till exemption down where a future maintainer will see it**, so it is not "hardened" away later by someone applying a framework default. Any change to it is a PRD amendment | L36 |
| N2.7.8 | `audit_log` to its §10.3.2 shape — `actor_kind`, `on_behalf_of_staff_id`, `entity` (renamed from `entity_kind`), `actor_staff_id`, before/after as **changed fields only, never whole rows, never a PAN**. Append-only forever, not disableable by any role, baristas have no read access. ⚠ **Drop the `webhook` actor kind** — FAVO subscribes to no webhook, so it is a value nothing can ever write | REQ-064 |
| N2.7.9 | Append-only triggers on `stock_movements` and `price_history` — **no policy or trigger protects either today**, so until this ships the rule is a convention, not a guarantee | §10.6 |
| N2.7.10 | `price_history.set_by_staff_id` (NOT NULL) + `reason`, and `setMenuItemPrice(id, price, reason?)` rewritten to carry them. ⛔ **The shipped action inserts a `price_history` row without an actor — every price change would violate NOT NULL and fail on first use** | REQ-130 |

---

## Phase 3 (shared) — your half of the loyalty and packs removal *(Mia reviews)*

Mia removes the screens first; you remove what is behind them.

| # | Story | Satisfies |
|---|---|---|
| N3.1.1 | Remove the loyalty server actions and the points-earning path | §11.1 |
| N3.1.2 | Drop `loyalty_transactions`, `customers.loyalty_points`, `coffee_packs`, `pack_redemptions` — with a **tested down script** | §10.1 |
| N3.1.3 | Update the ~34 loyalty and 24 pack test files. **The count of record is the grep command, not a number in prose.** Suite green after each step, not only at the end | §13.3 |

---

## Phase 4 — Offline trim and the audit gate *(Mia reviews)*

| # | Story | Satisfies |
|---|---|---|
| N4.1.1 | Delete `sync_conflicts`, `actions/sync-conflicts.ts`, the admin resolution surface and `outbox_log.conflict_id` | §10.1 |
| N4.1.2 | ⚠ **Each retained file must be edited, not merely kept.** `api/sync/orders/route.ts`, `server/sync/apply-outbox.ts`, `hooks/useOfflineOutbox.ts` and `crons/retry-deferred-payments.ts` all write `sync_conflicts` and **will not compile** once the table drops. Strip the conflict-write path, keep the outbox replay and the idempotency rejection | §13.4 |
| N4.1.3 | **Delete `retry-deferred-payments.ts`** — it sets `payments.status='successful'` from a cron, accrues loyalty §8.1 removes, and writes `sync_conflicts` §10.1 drops. One retained file violating three rules. Its legitimate successor is `resolveTenderByLookup`, which reads Yoco and never sends | §13.4 |
| N4.1.4 | Remove or internally gate the live `/api/crons/*` endpoints, so **"no Admin may run a timer" is enforceable** — an Admin who could invoke the close by hand could close a day twice | §10.7 |
| N4.1.5 | Keep `outbox_log.client_uuid`'s UNIQUE constraint. **That is the idempotency guarantee**, and idempotency is the property a single-writer retry path actually needs | REQ-038 |
| N4.1.6 | The CI regression test on write/replay — no data loss, no duplicate order — **running on every PR** | REQ-038 |
| N4.1.7 | The scope statement, written down: **order creation only.** `transitionOrder`, stock adjustments, entitlement claims, walk-in logging, broadcasts and all tender require a connection and **fail visibly** without one | REQ-037 |
| N4.1.8 | §8.4's entitlement-collision ruling implemented: a second offline claim replays as a normal order with the entitlement **not** applied, is flagged on the admin exception list, and is written off the way a deferred order is. **Never silently dropped** | L34 |
| N4.1.9 | Replay rules: an order **> 12 hours old at replay is rejected** and surfaced; a replay takes **the server's receipt time** as its revenue day, never the client's — so a replay landing after a close belongs to the new day and is never back-dated into closed books | REQ-039 |
| N4.1.10 | **The physical drill on the real tablet over the real network**, and it must exercise **an entitlement claim, not five plain orders** — the current drill passes while leaving that seam untested. **If it does not pass, offline ships disabled, not unverified** | §15.1 · L34 |

---

## Phase 5 — The blessing fund, server side *(Mia is required reviewer throughout)*

### E5.1 — The entity

| # | Story | Satisfies |
|---|---|---|
| N5.1.1 | `donor_funds` — **no `balance_zar` column.** The ledger is the truth and the balance is `Σ entries`, computed at the point of use. A cached balance that can drift from its ledger is the defect §6.6 spends a whole clause preventing | §6.10.5 |
| N5.1.2 | `donor_fund_entries` — append-only: `kind (top_up | spend | sweep | adjustment)`, `amount_zar`, `order_id`, `payment_id`, `funding_method`, `reference`, `recorded_by_staff_id`, `reason`. **A `top_up` contributes only while its payment is `successful`** | REQ-173 |
| N5.1.3 | `donor_fund_members` — **this table is the switch.** There is no fund-type column: empty means barista discretion, non-empty gates every draw. Partial unique index on `customer_id` over active funds, so **one person has at most one live linked fund and the counter never faces a choice** | REQ-172 |
| N5.1.4 | The fund code: four characters from `ABCDEFGHJKMNPQRSTUVWXYZ23456789` (no 0/O, no 1/I/L), generated with a uniqueness check and a retry. **A bearer handle, not a secret** — anyone who can quote it can draw against the fund, and that is stated so nobody later assumes otherwise | §6.10.3 |
| N5.1.5 | `createDonorFund` — issues the code, records the **non-refundability acknowledgement** (L45), takes the one question (*for specific people* or *for anyone*). A display name is optional; **an unnamed fund fires an immediate Admin push naming barista, amount and code, and never blocks** — a genuinely anonymous gift is a real thing | REQ-176 |
| N5.1.6 | The permission split: a barista may create, fund, draw from and **read the balance of** a fund. They may **not** rename it, re-link its names, sweep it, or read its ledger. The counter handles transactions; the desk handles the entity | §10.7 |
| N5.1.7 | POPIA: **`donor_fund_members` follows the customer, not the fund** — it carries the customer's retention period and is deleted with the customer. A fund outliving its members keeps the ledger and loses the names | §9.4 |

### E5.2 — Money in

| # | Story | Satisfies |
|---|---|---|
| N5.2.1 | `beginFundTender(fundId, amount)` — allocates the attempt, freezes the amount, writes a **pending** `top_up` entry and a `payments` row keyed on `fund_topup_id`, **minting its own `client_uuid`** on P3's rule so a timed-out top-up is recoverable by reference. Serialised per fund | REQ-174 |
| N5.2.2 | **The balance does not exist until Yoco confirms the payment succeeded.** A declined top-up leaves the fund at zero; an unresolved one shows as pending, contributes nothing, and resolves through S4's lookup — **never by sending again** | REQ-173 |
| N5.2.3 | T13's ceiling checked **before anything reaches the machine** | REQ-175 |
| N5.2.4 | From there the existing `sendToTerminal → pollTenderResult → recordTenderResult → resolveTenderByLookup` chain runs **unchanged**, including every error path and the 180 s ceiling. Nothing new is invented | §6.10.3 |
| N5.2.5 | **In deferred mode it returns `TERMINAL_UNREACHABLE` and writes nothing. There is no deferred top-up** — unlike a coffee, a gift can wait | §11.2 |
| N5.2.6 | `topUpDonorFund(fundId, amount, method, reference)` — the Admin cash/EFT path. **A missing reference is a `VALIDATION` failure, not a warning** | REQ-161 |
| N5.2.7 | A top-up may **not** be rung on the same card tap as an order — that is §8.11's multi-subject payment arriving through the back door. **Two transactions, and the POS says so** rather than silently refusing | REQ-174 |

### E5.3 server half — Money out

| # | Story | Satisfies |
|---|---|---|
| N5.3.1 | `drawFromDonorFund(orderId, fundId)` — locks the fund row with `SELECT … FOR UPDATE`, computes the balance from the ledger, audits, writes a `spend` entry and `orders.payment_mode='donor_fund'`. **Never writes to `payments`** | REQ-162 |
| N5.3.2 | ⚠ **Why never `payments`:** a fund draw is not a Yoco payment. A row there would sit in T10's two-directional reconciliation that Yoco's export can never match, generating a permanent exception **every time someone is given a coffee** — and it would be the third path §10.2.1 exists to forbid | §10.2.1 |
| N5.3.3 | **A fund draw is a tender, not a discount.** The drink is sold at full price; `order_net_charged` stays R20; margin reads normally. It stays out of `order_discount`, `comps_zar` and every write-down total — which is why it does not interact with L41 at all | REQ-162 · L47 |
| N5.3.4 | ⚠ **PAIR WITH MIA on the locking test.** **All or nothing.** No split tender between a fund and a card — a partial draw is a second tender path against one order, and §6.8's whole apparatus assumes one. `FUND_INSUFFICIENT` | REQ-163 |
| N5.3.5 | Selection: **oldest unspent gift first**, among funds that can cover the order. Not tidiness — the alternative quietly wrongs a donor, draining one fund while another sits untouched until the dormancy sweep takes it to ministry income | REQ-170 |
| N5.3.6 | Linked names gate the draw: `FUND_NOT_LINKED` for anyone not on the list; **auto-applied and declinable in one tap** for anyone on it | REQ-164 |
| N5.3.7 | **Settling freezes the order** exactly as P4 freezes it during a card tender — a comp, a voucher, a new line or a quantity step all return `TENDER_IN_PROGRESS`. Without it the fund pays R40 for an order then comped to R20 and the difference is simply gone | REQ-167 |
| N5.3.8 | Cancelling a fund-paid order writes a **compensating `adjustment` entry**; the original `spend` is never edited. **This is not a refund and L02 is not engaged** — no money leaves FAVO. It rides the existing admin-PIN cancel path and the same audit row | REQ-168 |
| N5.3.9 | `FUND_UNAVAILABLE` on an order with no net charge — a weekday office cup is already free, and drawing a fund for it spends real money on a drink nobody was going to be charged for | §6.10.6 |

### E5.4 — Admin surface, dormancy, liability

| # | Story | Satisfies |
|---|---|---|
| N5.4.1 | `/admin/funds` — every fund with balance, ledger, member list and last draw, **in draw order with each one's queue position and a depletion estimate** from the last thirty days' rate, rendered **UNAVAILABLE rather than guessed** while fewer than thirty days of draws exist | REQ-171 |
| N5.4.2 | Job 7, the dormancy check (daily 06:30): alerts at T14 − 30 days, and at T14 **writes an Admin task and nothing else.** Missed runs are skipped, not caught up | REQ-177 |
| N5.4.3 | ⚠ **The sweep proposes; an Admin confirms.** §12.3 forbids a scheduled job creating revenue, so `sweepDonorFund` is an **Admin action**, audited with a reason. A dormancy sweep on a timer would be a direct violation | REQ-177 |
| N5.4.4 | The R24 digest line: total live balance across all funds above ~R5,000 — **alerting, never blocking.** T13 caps each fund; nothing caps the sum, and five funds is up to R10,000 of coffee owed | R24 |
| N5.4.5 | **No donor statement.** No push, no in-app screen, no customer-scoped endpoint returns a fund balance or ledger — asserted on the payload of every customer-scoped read | REQ-165 |

---

## Phase 6 — Discord removal *(Mia reviews)*

**Two steps and the order is not negotiable.**

| # | Story | Satisfies |
|---|---|---|
| N6.1.1 | **First:** verify the §9.6.3 replacement by forcing a close mismatch on staging and confirming the Admin device receives it — **and by asserting the de-duplication**, which is the part v5.2's version of this step did not require | §13.5 |
| N6.1.2 | **Then:** delete `src/server/discord/webhook.ts`; drop the import and ping block from `crons/close-daily.ts` and `crons/generate-weekly-pnl.ts`; delete `scripts/ship-ping.ts` (**the work-item record is the ship notification**); remove the mocks from the two test files while keeping the reconciliation coverage; repoint `infra/sentinel/alerts.yml` at Transformate's observability alerting; clean `.env.example` and the seven docs | §13.5 |
| N6.1.3 | Completion gate: the grep returns **zero**, excluding this PRD and `docs/archive/`. Baseline at `9aefc2c` is 89 matches across code, infra, scripts and docs; a further ~24 drop out automatically once Phase 7 archives the superseded documents | §13.5 |

⚠ **`closeDaily()`'s only current alert is the Discord ping.** Deleting it before the replacement exists leaves daily reconciliation computing a variance, writing an audit row, and telling nobody — a silent regression on a rule meant to gate the day's close.

---

## Phase 7 (shared) — your half of the domain clean-up *(Mia reviews)*

Mia takes the ~25 documents. You take the ~12 files where a wrong web address is a functional bug rather than a typo: `src/app/layout.tsx`, the customer privacy page, `tests/unit/lib/customer-sw.test.ts`, `infra/coolify/favo-app.yml`, `infra/cloudflare/variables.tf`, the three Grafana dashboards and `infra/sentinel/alerts.yml`. (`vapid.ts` and `prod-smoke.spec.ts` are already done in Phase 0.) Shared gate: `grep -rIn 'hofmi\.org' .` returns zero outside `docs/archive/`.

---

## Phase 8 — Priority 2, server side

### E8.2 — Ministry rollup, `logExpense`, `/admin/expenses` *(Mia is required reviewer)*

| # | Story | Satisfies |
|---|---|---|
| N8.2.1 | `logExpense(category, amount_zar, incurred_at, note?)` + `/admin/expenses`. ⛔ **The `expenses` table exists and its only writer is a demo seed.** Phase 0 starts clean, so without this `ministry_cost`'s expense term is permanently zero | REQ-114 |
| N8.2.2 | `getMinistryRollup(from, to)` — weekday cost + Sunday revenue and cost + **event columns as their own third column, never folded into either** | REQ-122 |
| N8.2.3 | `ministry_cost = weekday_cogs + free_event_cogs + outreach_cogs + Σ expenses`. **`free_event_cogs`, not `event_cogs`** — a paid event day's COGS is already inside its contribution. And **Σ expenses excludes card processing fees**: a fee is never both an expense and a deduction | REQ-112 · REQ-113 |
| N8.2.4 | `ministry_income = Σ contribution over paid **sessions** + Σ Admin-confirmed sweeps` — sessions, not days, because a Sunday carrying a morning and an event evening satisfies "paid day" twice | §7.0.2 · COL-10 |
| N8.2.5 | ⚠ **Until `logExpense` has a writer in production, `ministry_cost` renders UNAVAILABLE — not COGS-only.** A rollup reporting the ministry's cost with no rent, utilities or wages is worse than no rollup | REQ-114 |
| N8.2.6 | CSV and PDF export stay (`/api/reports/export`), and **every successful export writes an audit row** — an export is a data egress and §9.4's POPIA commitments apply to it | REQ-135 |

### E8.5 — The money fixtures *(Mia is required reviewer)*

| # | Story | Satisfies |
|---|---|---|
| N8.5.1 | **FIXTURE-A** — replay the 13 FAVO orders of 2026-08-16 and assert **to the cent**: gross R350.00 · fees R9.27 · net settled R340.73 · written off R0.00 · comps R0.00 · `cogs_zar` **R196.36** · gross margin **R153.64** · contribution **R144.37** · 17 drinks · 10 double shots. And assert the flag renders **provisional, not green** | REQ-117 |
| N8.5.2 | ⚠ **A builder who computes R144.36 has found a real disagreement and should stop, not adjust.** The grounding sheet published R196.37 / R153.63 / R144.36 on a mixed rounding basis, and a third answer (R196.09) exists from an older rule. Three defensible answers to one day's profit is what an unfixed rounding rule produces | §7.0.3 |
| N8.5.3 | ⚠ **PAIR WITH MIA.** **FIXTURE-B — one fixture, not two.** A synthetic day carrying: one comp, one write-off, one path-B settlement, one entitlement cup, one walk-in line beside a paid line, one tip, one quantity-2 line, **four voucher redemptions, two fund draws, a settled fund top-up, a four-shot line, and a line that exhausts a bean container mid-deduction.** Assert every §7.0.2 term individually | REQ-118 |
| N8.5.4 | FIXTURE-B also asserts **`ministry_net` is identical with and without §6.9.4's reclassification**, while the day still prints `cogs_zar` whole | REQ-158 |
| N8.5.5 | Why B is required: every discretionary term in §7.0.2 is **zero** in FIXTURE-A, so a formula wrong in `written_off_zar`, `comps_zar`, `tip_zar`, `entitlement_cups` or `walk_in_cups` passes every existing check. **A synthetic fixture that exercises a rule is worth more than a real day that does not** | C-1 |
| N8.5.6 | Rounding: **exactly once, at `order_cogs`, half-up, per order.** Every day/week/month figure is a sum of those integers, so no two reports can disagree by a rounding choice. Ingredient unit costs stay at `numeric(10,4)` | REQ-106 · REQ-107 |
| N8.5.7 | `fee_zar` is **Yoco's actual per-transaction figure, never estimated from a rate, never recomputed.** Yoco rounds a half-cent fee down and §7.0.2 rounds half-up — a recomputed fee disagrees with the gateway by a cent on every such line, and the gateway is right by definition. `expected_fee_rate_bp` flags anomalies only, on days with ≥ 10 card transactions, and is **re-derived monthly from actuals** | REQ-119 |
| N8.5.8 | T10 reconciliation, both directions, daily, at **transaction grain**, with retail lines and path-B settlements reported as **named informational lines rather than mismatches** | REQ-019 · REQ-032 · REQ-033 |
| N8.5.9 | `importYocoTransactions(revenue_day)` — from the Yoco export an Admin uploads at `/admin/reports`, 06:00 SAST, catch-up on startup, idempotent on `(revenue_day, yoco payment id)`. **It never writes `payments.status` — it annotates revenue, it cannot create it.** Pushes the Admin at 09:00 if no export has been uploaded | REQ-067 |
| N8.5.10 | ⚠ **Do not build on FEE-1.** Yoco's REST fee route is unverified by anyone; if it works it closes §7.5's one regression against the incumbent, and until then the daily upload is the specification in force | FEE-1 |

---

### E8 additions found in the final gap check *(Mia reviews)*

| # | Story | Satisfies |
|---|---|---|
| N8.6.1 | **The weekly stock count's lid band.** Stock counts already work; what is missing is that lids need a wider variance tolerance than everything else. Customers decline lids and we deliberately do not track that, so lid stock always drifts positive — without its own band that harmless drift pollutes the one signal that would show real waste or theft | REQ-127 |
| N8.6.2 | **Monthly sign-off.** A monthly P&L cannot be marked closed without the admin's signature, enforced by a database CHECK rather than a habit, and closing is irreversible | §5.4 · L11 |

---

## Phase 9 — Event mode *(Mia reviews)*

| # | Story | Satisfies |
|---|---|---|
| N9.1.1 | `event_profiles` and `event_windows`. **Two tables, deliberately:** a recurrence needs a template; reporting needs a concrete occurrence to attribute orders to, and the window **snapshots the six switches at open** so editing a profile never rewrites history | REQ-044 |
| N9.1.2 | The **six** switches: menu scope · payment posture · cup & lid · broadcast audience · extra-shot surcharge · **voucher kinds** (the sixth, new in v7.0) | §6.6 |
| N9.1.3 | All three activation paths — recurring template, one-off scheduled, ad-hoc *Start an event* with a **mandatory end time** | §6.6 |
| N9.1.4 | `ends_at` NOT NULL, **windows > 24 h rejected** | REQ-043 |
| N9.1.5 | **Deactivation is a read, not a job.** `mode` is stored; whether the event is *in force* is derived from the window on every read. At `ends_at` the six switches stop applying with no timer and no job, while the session row still records what happened | REQ-042 |
| N9.1.6 | A session bound to an expiring window is **force-closed**, audited, with the slip count prompted as normal | COL-11 |
| N9.1.7 | Price overrides written **in one transaction** to both `price_history` (source of truth, append-only, carrying `set_by_staff_id`) and `event_windows.price_overrides` (read snapshot). Where they disagree `price_history` wins and the discrepancy is a bug; a daily check asserts equality | §10.6 · DEC-03 |
| N9.1.8 | Precedence: a one-off beats a recurring template on the same date; an explicit event beats the date-derived mode **including Sunday, but overriding a Sunday requires a confirmation step** | §6.6 |
| N9.1.9 | The **Discipleship 101 acceptance drill**: recurring Wednesday template, confirmed in one tap; place orders and assert **zero payments sent and no card prompt**; assert cups **are** deducted; assert the window closes itself at 20:30 and Thursday defaults to Weekday | REQ-045 · §15.1 |
| N9.1.10 | The **Untracked Church** profile: full menu · standard payment · cups consumed · office staff + church members · **surcharge charged** · `voucher_kinds = ["untracked_hot_drink"]`. ⚠ Decide in the Phase 2 review whether this lands here or earlier as a Path A profile, **if the evening service starts being served before Phase 9** | §6.11.2 |

---

## Standing prohibitions — flag, don't build

If a ticket, design or PR proposes any of these, it contradicts the PRD. The correct response is to flag it, not to build it.

- A **native wrapper** of any kind — no Capacitor, no custom plugin, no Apple Developer enrolment, no signing certificate. Read §6.8.0 first.
- A **customer-held, self-service or refundable stored balance**. Read §6.10.1 first. The word *"wallet"* never appears in UI copy, tickets or code comments; the POS says *Blessing fund* and the schema says `donor_funds`.
- A **guest notification flow, a counter QR, or any customer-visible order-status or queue view.**
- A **group tab** — it needs one payment pointing at more than one order, which is the one schema change FAVO cannot afford. It reopens only on evidence: a month of `donor_fund_entries` showing a payer topping up daily and complaining about the prepayment.
- **Cash.** A barista offered cash rings the order `yoco_deferred` with reason `cash_offered`. It reopens if a barista reports being offered cash more than once in month one.
- A **receipt of any kind** — no printer, no drawer, no emailed or pushed receipt. The customer gets the terminal's slip.
- **Loyalty, points or packs**, in any form.
- A **raw hex value outside Layer 1's token set.**

---

## What is explicitly *not* yours

So the two documents add up without overlap: Mia owns the traceability audit (E0.6) and the Layer 2 design foundation (E0.8), the order flow and recents grid (E1.1), the line controls (E1.2), the PWA install and iOS honesty (E1.8), the rota and Hand over (E2.3), walk-ins (E2.4), the voucher's POS half (E2.6), the loyalty/pack removal (E3.1), the fund's counter surfaces (E5.2's screen and E5.3's POS half), the domain and doc reconciliation (E7.1), the COGS dashboard (E8.1), the weekly summary and write-down block (E8.3 — **she writes the query on this one, not only the screen**), `/admin/yield` (E8.4), the POS Day summary (E8.6), and accessibility throughout.

**She reviews every money item of yours.** That list is in `00-overview-and-roadmap.md` §4, and the four questions she reviews against are in `01-mia-tasks.md`.
