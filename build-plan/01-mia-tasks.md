# FAVO Café — Build Plan · 01 · Mia's tasks

**Read `00-overview-and-roadmap.md` first** — it holds the source-of-truth resolution, the phase exit criteria, the risk register and the ownership rule that this document assumes.

> ⚠ **This split is a proposal.** Nikao has not seen it and has not confirmed his own capacity or preferences. Adjust it together at the first board review. The **ownership rule** (a named reviewer on every money/auth/entitlement/Yoco item) is not adjustable; **who owns which epic** is.

**Capacity assumed: ~15–20 hrs/week** around Bible Institute study. Flagged as an assumption in the overview (A1).

> ⚠ **Claude writes the code.** Every row below is something you **own, specify, review and verify** — not something you type. "Build X" means: check the requirement rows are right, have Claude build it, then confirm the acceptance assertion still asserts the spec's own numbers. The review tiers, the in-flight caps and the four questions to review against are in **`04-how-claude-builds-this.md`**. The traps Claude must not fall into are in **`CLAUDE.md`**, which goes in the repo root.

**How to read a row.** Every story cites the Appendix C requirement IDs it satisfies. Those IDs are what the acceptance test asserts — not a paraphrase of them, and not a recomputed expectation. Where a story has no REQ row (design foundation work, docs, audits), that is marked *no REQ row* rather than left blank, so an absent citation is visibly deliberate.

---

## Phase 0 — Recovery and audit

While Nikao is on infrastructure, these two epics are yours and they are not filler: the second one is what Phase 1's UI is built against, and the first is what tells you both what you actually have.

### E0.6 — Requirement → code → test traceability audit *(split with Nikao — you own the register and the money half)*

> **Split on purpose:** you audit the rules **Nikao** will build (REQ-101…177 — the money, reporting, voucher and fund rules); he audits the rules **you** will build (REQ-001…071 — the till and payment path). It costs nothing extra and it is the cheapest way either of you learns the other's area before it gets written.

The deliverable is a register in the repo — `docs/traceability.md` or a CSV, either is fine — with one row per Appendix C requirement.

| # | Story | Satisfies | Notes |
|---|---|---|---|
| M0.6.1 | Build the empty register: all 148 rows (REQ-001…071, REQ-101…135, REQ-136…177), each with its source clause, priority (P1/P2), and three empty columns: *code exists?* · *test exists?* · *test passing?* | *no REQ row — this is the audit itself* | The arithmetic checks: 71 + 35 + 42 = 148 |
| M0.6.2 | ⚠ **Nikao's half** — he fills C.1 (REQ-001…071). You do not | — | Expect a lot of "partially". Record "partially" plus a one-line note rather than a yes/no you cannot defend |
| M0.6.3 | **Your half** — fill C.2 (REQ-101…135) and C.3 (REQ-136…177), 77 rows | — | C.3 is v7.0-new, so most of it will be "no" — that is information, not a failure |
| M0.6.4 | Fill the *test exists / passing* columns by running the suite and mapping test files to rows | — | This is where "909 tests are green" becomes "these 62 requirements have a test" |
| M0.6.5 | Write the gap list: every requirement with no passing test, grouped by the phase that will build it, and create a test-writing task for each | — | Hand this to the Phase 1 and Phase 2 planning as backlog input |
| M0.6.6 | Flag the three rows v7.0 itself marks as untestable today (REQ-047's 10-second push, REQ-069's 4-hour connection, and the REQ-010/029/030 card-machine block) so nobody chases them before the gates that make them measurable | REQ-047 · REQ-069 · REQ-010 · REQ-029 · REQ-030 | These become measurable at P0 exit and after the R1.00 gate respectively |
| M0.6.7 | Separately flag: **the 45-orders-in-100-minutes figure has no recorded source** and it sizes two §05 criteria, T03's windows and §9.9's infrastructure | *no REQ row* | Note it in the register as "unsourced input, needs provenance or re-derivation". Do not treat it as measured |

**Done when:** the register exists in the repo, every one of the 148 rows has all three columns filled, and every uncovered row is in the backlog.

### E0.8 — Layer 2 design foundation (§17.6) *(you own it; Nikao reviews)*

Layer 1 — the FAVO brand system — is authoritative for brand and **has no status colour of any kind and no size or touch-target token of any kind.** §17.3 says touch targets are "verified in CI against the tokens"; until Layer 2 exists there is nothing to verify against, and Phase 1's order panel cannot be built to spec.

| # | Story | Satisfies |
|---|---|---|
| M0.8.1 | Define the seven semantic status tokens: `--status-success`, `--status-error`, `--status-warn` (provisional), `--status-unavailable`, `--selected`, `--status-offline`, `--status-disabled`. Derive every value from Layer 1's anchors — **a raw hex outside Layer 1's token set is a PRD amendment** | REQ-110 (its rendering half) |
| M0.8.2 | Prove `--status-warn` (provisional) and `--status-unavailable` are **visually distinct from each other and from success and error**. v6.0 had one token doing both jobs; two different failures rendering identically is the defect §17.6.1 exists to close | REQ-110 · REQ-129 |
| M0.8.3 | Define the size tokens: `--target-pos` 44 px · `--target-admin` 40 px · `--target-customer` 44 px · `--target-gap` 8 px. Document the mm derivation (`mm = css_px × 25.4 / 132`) so it survives someone buying a newer iPad — and record that an **iPad mini (163 ppi) falls below the 8.46 mm floor** and would need the px tokens raised before adoption | D1 · §17.6.4 |
| M0.8.4 | Define the three reference viewports: POS 1080 × 810 landscape · admin 1280 × 800 · customer 390 × 844 | §17.6.3 |
| M0.8.5 | Wire CI checks: contrast ≥ 4.5:1 body / ≥ 3:1 large text and boundaries, and target-size + gap checks against the size tokens | REQ (accessibility gate, §15.1) |
| M0.8.6 | Record the three **prohibited** Layer 1 pairings for app body text: `--fg-2` (Cool Steel) on Porcelain at 2.46:1, `--accent` on Porcelain at 3.12:1, white on `--accent` at 3.38:1. The last two are large-text-and-boundaries only — **which directly constrains D5**, since "Done" is the most prominent action in the product and its label is body-sized | §17.3 · D5 |
| M0.8.7 | Design (not yet build) the profit/loss indicator with a **second cue** — a sign, a word or an arrow — since red/green alone fails the most common colour-vision deficiency, and this is the number the whole of Priority 2 exists to communicate. The `provisional` state needs a **third** treatment that is neither red nor green and cannot be mistaken for either | §17.3 · L39 |

**Done when:** the tokens exist, CI enforces both floors, and the three renderings (success / provisional / unavailable) are demonstrably distinguishable — including to someone who cannot separate red from green.

---

## Phase 1 — Flow fix and card payments

### E1.1 — Order flow fix, target binding, recents grid *(you own it; Nikao reviews — entitlement-adjacent)*

| # | Story | Satisfies |
|---|---|---|
| M1.1.1 | `orders.notification_target` + the L28 binding rule in the POS: every order binds a target — a registered customer or **explicit `none`** — before Place. Order creation cannot complete without one, and `none` is chosen, never defaulted into by skipping a step | REQ-046 |
| M1.1.2 | Ring-up / make separation: the barista rings up in seconds, the order lands in the queue as `ordered`, the queue is the **work list** not a status display, the barista taps in to start (`in_progress`, which deducts stock) and taps Done (`ready`, which fires the push) | REQ-021 · REQ-047 |
| M1.1.3 | The recents grid: **office staff who have NOT yet claimed today's cup first**, most recent first, then the last 12 matched customers. Served tiles stay visible below, visibly marked, never in a primary slot | REQ-052 |
| M1.1.4 | Search as the fallback path, implementing §6.9.4a's contract on the client side: fires at 2 characters, debounced ~200 ms, **never blocks the order path** — the menu grid stays tappable and the drink can be rung while the search is in flight | REQ-140 · REQ-141 · REQ-142 |
| M1.1.5 | Two people, one name: surname always renders beside the given name, and where two results still read alike, the last four digits of the phone. **No email and no full phone number in any payload** | REQ-142 |
| M1.1.6 | Zero results renders an **empty list, never an error**, with "no notification" as an explicit adjacent choice — this is the screen where L28's "chosen, never defaulted into" is either honoured or quietly broken | REQ-141 |
| M1.1.7 | The Favo row wired into the POS: inline above the menu grid, **≤ ¼ of the order panel**, never a modal or interstitial; "Something else" is a dismissal, not a navigation; the menu grid stays visible and tappable at all times | REQ-055 · D2 · D3 · D4 · D6 |
| M1.1.8 | Drift prevention: customer-side (account page) and barista-side (POS) Favo setup call **the same server action and validate against the same schema** — not two implementations writing to one table | §6.4 |
| M1.1.9 | Queue offline behaviour: renders from local state, offline-created orders marked *not yet synced*, `in_progress`/Done disabled **with a visible reason**. ⚠ empty and offline must be distinguishable — an empty work list during a disconnection reads as "nothing to make" | REQ-013 |

**Watch-out for M1.1.3:** on a clean database the grid is empty, so the first week's orders go through the search the budget forbids. That is accepted and time-boxed — the ≤ 3-tap weekday budget is measured **from the second week of trading**. Do not pre-populate the grid with invented customer rows to hit a number.

### E1.2 — Order line controls *(you own it; Nikao reviews)*

| # | Story | Satisfies |
|---|---|---|
| M1.2.1 | The quantity stepper on the order line: first tap on a menu item adds at quantity 1; every change after that is on an explicit − / + on the line; stepping to zero removes the line | REQ-053 · L37 · D8 |
| M1.2.2 | Repeat-tap behaviour: tapping an item already on the order **never changes the quantity** — it flashes the line whose configuration matches the current selection and draws the eye to its stepper | REQ-053 |
| M1.2.3 | **DEF-E:** one line per *distinct configuration* (menu item + shots + modifications), not one line per menu item. Where no line matches the current configuration, a repeat tap **adds a new line** | REQ-148 |
| M1.2.4 | The segmented shot picker — `1 2 3 4`, one tap to any value, **not a − / + stepper**. Segments **spaced, never flush**: four 44 px targets sharing borders is 0 px between adjacent targets, which breaks D1 by a drawing convention rather than by a decision | REQ-138 · D10 · L38 |
| M1.2.5 | Mode-aware rendering: the weekday picker shows **two segments, not four greyed ones**; Sunday and paid events show T15 segments | REQ-138 · L48 |
| M1.2.6 | **L48 throughout the order panel:** no shot picker on a drink with no coffee in it; no voucher chip on a weekday; no fund chip on an order owing nothing. **Absent from the rendered tree, not present and disabled** | REQ-146 |
| M1.2.7 | The L48 / §17.4.1 boundary, in code and in review: *stopped is shown, meaningless is hidden.* A barista's third comp renders the admin-PIN prompt rather than hiding the control — they must see why they are stopped. A control that could never do anything here is absent | REQ-146 · §17.4.1 |
| M1.2.8 | Partly-vouchered line rendering: `m of n` and the remaining price, so a partly-vouchered line can never read as fully vouchered *(ships with E2.6, designed here)* | REQ-147 |
| M1.2.9 | **The fit check** (§6.2.4d): the busiest realistic order — three lines, five controls each, target chip, up to two fund tiles and Place, ~18 interactive targets — all ≥ 44 px with ≥ 8 px gaps, measured on the real tablet at §17.6.4's geometry. Re-run this **before a sixth per-line control is ever added** | §15.1's L48 drill |

### E1.8 — PWA install onboarding and iOS push honesty *(you own it; Nikao reviews)*

This is **R16**, rated *High if unaddressed / High*, and it is the failure mode where everything looks like it worked.

| # | Story | Satisfies |
|---|---|---|
| M1.8.1 | An install step in registration and onboarding, with **explicit iPhone instructions** ("Share → Add to Home Screen") | REQ-048 · L29 |
| M1.8.2 | On an iPhone that has not installed the PWA, the app **states the install requirement and the subscribed state is unreachable** — it never shows a subscribed state it cannot honour | REQ-048 |
| M1.8.3 | Manual verification on a **real iPhone**, not a simulator. The silent-failure case is the one that matters | §15.1 iOS install honesty row |
| M1.8.4 | Order history for customers: only `ready`, `collected` or `cancelled`. An order appears as soon as Done is tapped, so history is never empty for the 20 minutes the sweep takes — and **`orders.state` is never returned to a customer-scoped read of an in-flight order** | REQ-049 · L23 |

**⚠ Pulled forward from Phase 7:** `src/server/push/vapid.ts` carries the wrong `favo.hofmi.org` domain as its VAPID subject. **A wrong subject is a silent push-delivery failure.** Fix it in Phase 0 alongside `tests/e2e/prod-smoke.spec.ts`, not in Phase 7 — E1.8 has nothing to verify against until it is right.

### Your reviewer load in Phase 1 — and two things you *pair* on

You are the **required reviewer** on E1.3, E1.4, E1.5 and E1.6 — the whole money path.

⚠ **Two of those are pairing, not reviewing.** Sit with Nikao for: the **R1.00 card machine test** (Phase 0 — about two hours, and it is the only time anyone will watch three of the failure paths happen), and the **three-condition rule that allows a second charge** (E1.4). A mistake in either costs a customer real money with no way to give it back, and reviewing a diff afterwards is not the same as watching it built. Two more pair items land later: the fund's balance-locking test and the synthetic money fixture.

The rest is reviewing, and that is not a formality and it is not a request to re-derive Nikao's implementation. Four questions, all answerable without owning the domain:

1. **Does every assertion trace to a REQ row or a §15.1 gate row?** If a test asserts something the PRD does not say, either the PRD says it somewhere you have not found, or the test is inventing a requirement.
2. **Does the test assert the PRD's numbers, or compute them?** FIXTURE-A asserts contribution **R144.37**. A test that recomputes the expected value from the same formula under test proves nothing.
3. **Is there a silent path?** A `SUM()` skipping NULLs. A zero where UNAVAILABLE belongs. A `fetch` error treated as a status. A subscribed state on an iPhone that cannot honour it.
4. **Does anything retry a payment?** The only door to a second send is S4 step 3's three conditions — the status resource read *failed* (not an error, not pending), twice, ≥ 60 s apart, ≥ 120 s after the send. **A fetch error is never a licence to send again.**

If the answer to (4) is ever "yes, but only when…", stop and read §6.8.4 together before approving.

---

## Phase 2 — Modes, sessions, identity, vouchers

### E2.3 — Rota, shift-start push, Hand over *(you own it; Nikao reviews — attribution touches money)*

| # | Story | Satisfies |
|---|---|---|
| M2.3.1 | `barista_shifts` keyed to **the session, not the date** — a Sunday now has two sessions and two baristas, and without this the evening barista is never told they are on | §6.11.1 · COL-23 |
| M2.3.2 | Shift-start push per session | §6.3 |
| M2.3.3 | The **Hand over** control: ends the session and returns to the PIN screen **without touching orders in flight**. With no idle lock during trading hours, this is load-bearing rather than a convenience — it is the only thing preserving per-barista attribution across an overlap | REQ-061 |
| M2.3.4 | The opening-window step: mode already selected from the date, overridable in one tap **before the broadcast**, never a separate action. On a Saturday it offers **Start an event**, not a mode picker | REQ-056 · REQ-057 |

### E2.4 — Walk-in tracking *(you own it; Nikao reviews)*

| # | Story | Satisfies |
|---|---|---|
| M2.4.1 | POS walk-in logging: drink category and type only, **no identity of any kind**, never charged, never counted against the staff entitlement | REQ-058 |
| M2.4.2 | `walk_ins.quantity` **per order line**, so `walk_in_cups` counts walk-in cups and not the whole order's — an order with one walk-in line and one paid line counts only the walk-in line | REQ-116 |
| M2.4.3 | No daily limit enforced — barista discretion, logged for visibility, not policed by the database. A walk-in has no persistent identity to key a limit off | L20 |

### E2.6 — The Untracked hot drink voucher — POS half *(you own the POS; Nikao owns the server actions; you review each other)*

| # | Story | Satisfies |
|---|---|---|
| M2.6.1 | The `voucher` chip on the order line, beside the shot picker. One tap applies, **tapping again removes it** — same toggle, and that is the undo | REQ-154 |
| M2.6.2 | **No confirmation step**, deliberately: the line strikes through to R0 and the total drops, both before Place. The visible result *is* the confirmation. (Contrast the fund top-up, which does get a confirmation — R23 — because its result is neither visible nor reversible) | §6.9.3 |
| M2.6.3 | Renders **only** where a voucher kind is in force for the session. On a weekday it does not exist on any line | REQ-155 · REQ-146 |
| M2.6.4 | `m of n` rendering on a quantity-*n* line | REQ-147 |
| M2.6.5 | The slip-count prompt at `closeSession` — and its empty state is **the normal opening state and is not zero.** An uncounted tin and a tin holding nothing are different facts and must render differently | REQ-157 · L43 |
| M2.6.6 | Tap-budget drill: voucher single shot ≤ 4 taps, voucher double ≤ 5, timed on the real tablet against the 08:05–09:16 sequence | §05's voucher ring-up row |

**Why the voucher is not built on the comp path, in case anyone proposes it:** routing it through `compOrderLine` would hit `COMP_LIMIT` on the third visitor, and it would put twenty legitimate free drinks into **the one report that exists to make illegitimate ones visible**. A voucher is a paper slip the church issued and the café counts back. A comp is a barista's unplanned decision whose legitimate rate is zero.

---

## Phase 3 — Removal: loyalty and coffee packs *(split with Nikao)*

> **Split on purpose:** you remove the screens, Nikao removes the server code and the tables. Screens still go first — removing the data first leaves customers looking at a stale points balance.

⚠ **The sequence is normative. Do not reorder it.** 76 source files reference loyalty and 22 reference packs; this is the largest single change in the plan, and it is deletion — the good kind of large.

| # | Story | Satisfies |
|---|---|---|
| M3.1.1 | **Take and verify a full backup.** Removal is a hard delete with no wind-down; the backup is the only reversal path | R3's rollback |
| M3.1.2 | Remove UI surfaces **first**: the customer loyalty page, the three admin loyalty pages, in-cart redemption, `PackDetailCard`, and the loyalty references on the admin customer detail page | R4 — remove the UI before the data so nobody sees a stale balance |
| M3.1.3 | ⚠ **Nikao's half** — server actions, the accrual path, the tables and the tested down script | §11.1 |
| M3.1.4 | ⚠ **Nikao's half** — updating the ~34 loyalty and 24 pack test files | §13.3 |
| M3.1.6 | Fix the customer-facing privacy policy page, which currently describes loyalty data collection — **POPIA disclosure has to match what is actually stored** | §9.4 |
| M3.1.7 | Both enforcement greps return zero (wallet; loyalty/packs) | §13.3's completion gate |

**Suite green after each step, not only at the end.** A half-removed loyalty system is worse than either state, which is also why this ships without a feature flag.

---

## Phase 5 — The blessing fund, POS half *(shared with Nikao; you review each other)*

### E5.3 — Money out, at the counter

| # | Story | Satisfies |
|---|---|---|
| M5.3.1 | The two-chip footer: **at most two tender chips at any number of funds** — the linked fund, and one chip standing for every open fund with `+4` after it. True at two funds and true at twenty | REQ-170 |
| M5.3.2 | Radio, not reveal: both chips shown, one lit, tapping the other switches; tapping the lit one turns it off and the order goes to the card. **The card costs no tap** — there is no card chip, it is what Place does when no fund is lit, which is why the button says so | REQ-169 |
| M5.3.3 | A linked fund **arrives lit** and is declinable in one tap — L03's posture, for L03's reason: a standing arrangement should not cost a decision every time | REQ-164 · REQ-169 |
| M5.3.4 | A fund that cannot cover the order is **not offered** — not a chip that refuses. A fund below the cheapest live menu item renders as empty, because it is | REQ-170 · L48 |
| M5.3.5 | The override list: a **second tap on the already-lit chip** opens every open fund with its balance and code. **Not a long-press** — §17.6 carries no long-press anywhere in the POS, and a gesture that appears exactly once is a gesture nobody remembers with wet hands | §6.10.6 |
| M5.3.6 | The barista can **read a fund's balance** on the fund control and tell a donor who asks. Balance only — the ledger, draw history and member list stay on the admin surface | L21 (as clarified) · COL-13 |
| M5.3.7 | Tap-budget drills: open fund with a stranger ≤ 4 · linked person auto-applied ≤ 3 · linked person paying their own way 4 · override 5 | §05's fund ring-up row |

### E5.2 support — the top-up screen *(Nikao owns the action; you own the screen)*

| # | Story | Satisfies |
|---|---|---|
| M5.2.1 | The amount-entry and confirm screen: **the figure shown large** before anything reaches the machine. This is the one place in the POS that earns a confirmation step | R23 |
| M5.2.2 | The T13 ceiling refusal renders as a **validation error before the send**, never as a failure afterwards | REQ-175 |
| M5.2.3 | `peripheral-down` on this screen is `TERMINAL_UNREACHABLE` and **there is no deferred top-up** — the screen says a gift can wait | §17.4.1 |
| M5.2.4 | `system-error` separates `GATEWAY_UNAVAILABLE` (safe to try again) from `PAYMENT_UNKNOWN` (never) **in the words on the screen, not only in the code** | REQ-010 |

---

## Phase 7 — Domain, doc and duplicate reconciliation *(split with Nikao)*

> **Split on purpose:** Nikao takes the ~12 code, test and infrastructure files; you take the ~25 documents, including the two POPIA ones.

| # | Story | Satisfies |
|---|---|---|
| M7.1.1 | ⚠ **In Phase 0, not here:** fix `src/server/push/vapid.ts` and `tests/e2e/prod-smoke.spec.ts`. Both fail **silently** and both are load-bearing for a P0 exit criterion | §13.6 |
| M7.1.2 | **Your half:** the ~25 documents, including `docs/popia/privacy-policy.md` and `docs/popia/subject-rights.md`. ⚠ **Nikao's half:** `src/app/layout.tsx`, the privacy page, the service-worker test, `infra/coolify`, `infra/cloudflare`, three Grafana dashboards and `infra/sentinel/alerts.yml`. Shared gate: `grep -rIn 'hofmi\.org' .` returns zero outside `docs/archive/` | §13.6 |
| M7.1.3 | **Put PRD v7.0 in the repo** and point `CLAUDE.md`'s "PRD is the source of truth" line at it — it currently points at `FAVO_PRD_v3.md`. *Do this in week one, not in Phase 7* | Overview §1.5 |
| M7.1.4 | Archive `FAVO_PRD_v5.2.md`, `FAVO_PRD_v5.1.md`, `FAVO_PRD_v5.md`, `docs/FAVO_PRD_v3.md` and the three phase build plans into `docs/archive/` | §13.6 |
| M7.1.5 | Delete the nine root-level duplicates, keeping the `docs/` copies. Root and `docs/DESIGN.md` differ by 137 lines | §13.6 |
| M7.1.6 | Regenerate `docs/API.md` **from §11** — never consulted by it — and bring `ARCHITECTURAL.md`, `docs/BUSINESS_RULES.md`, `docs/DATA_MODEL.md` into line. Both API.md and BUSINESS_RULES.md are stale against v4 and still say the staff discount is "Cappuccinos only" | §13.6 · §11.4 |
| M7.1.7 | Consolidate `/admin/login` onto `/staff/login` and delete it. Gate: `grep -rIn 'admin/login' src/` returns zero. Two login surfaces means two places a session lifetime, a rate limit and an idle lock can drift apart | §17.4 |

---

## Phase 8 — Priority 2: cost management

### E8.1 — Live COGS dashboard *(you own it; Nikao reviews)*

| # | Story | Satisfies |
|---|---|---|
| M8.1.1 | Per-mode split — weekday revenue is intentionally zero, so a blended margin would be meaningless and quietly alarming | REQ-121 |
| M8.1.2 | **Margin broken out by shot count**, not only by item. One `GROUP BY`, and the single most actionable number v7.0 produces: price is flat from one shot to two and cost is not, and 83% of cappuccinos took the second shot | REQ-139 |
| M8.1.3 | `cost_source` labelling wherever a margin surfaces — **provisional, never `--status-success`**, with the warning and a link to the recosting screen | REQ-110 · REQ-131 · L39 |
| M8.1.4 | ⚠ **Empty is never zeroes.** An unrecosted or un-imported input renders **UNAVAILABLE with the offending item named**, and the profit flag renders provisional while any lot is an estimate | REQ-108 · REQ-109 |
| M8.1.5 | COGS increments within 5 s of a test order | REQ-121 |

### E8.3 — Weekly ops summary and the write-down block *(you own it; Nikao reviews)*

| # | Story | Satisfies |
|---|---|---|
| M8.3.0 | ⚠ **You write the query for this epic, not only the screen.** It is a read-only report, so the worst case is a wrong number rather than a wrong charge — which makes it the right place to learn the server side end to end. Nikao reviews | §7.3.1 |
| M8.3.1 | The three mode sections: Weekday (cost and consumption only — no revenue exists), Sunday (revenue, COGS, profit/loss flag, **per shot count and per session**), Events (per event: drinks made, consumption, cost, revenue where charged) | REQ-123 |
| M8.3.2 | **The seven-row write-down block, per barista:** comps (count + `comps_zar`) · deferred write-offs (count + value, split by reason, `unresolved_at_close` separately) · abandoned orders (count) · **vouchers (count *and* value)** · **fund draws (count and value drawn)** · unresolved payments (count open + oldest age) · reconciliation (days closed, days blocked, open T10 items) | REQ-124 · REQ-145 |
| M8.3.3 | **Zero prints as `0`, never omitted.** An absent line is indistinguishable from a clean week, and the whole purpose of these rows is that someone other than the author sees them | §7.3.1 |
| M8.3.4 | The voucher row also carries the session's slip count beside the recorded count, **and the count of days the tin was not counted at all** | R25 |
| M8.3.5 | Delivered as **push + a single in-app screen** to the three baristas and the Admin role, automatically, every Monday 06:00 — not an emailed PDF or CSV | REQ-123 |

### E8.4 — `/admin/yield` recosting *(you own it; Nikao reviews)*

| # | Story | Satisfies |
|---|---|---|
| M8.4.1 | The screen's content **is** the list of `cost_source = 'estimate'` lots — that is not an empty state, it is the work. This screen is L39's only exit | §17.4.1 |
| M8.4.2 | Setting a lot to `invoice` is Admin-only and **audited** | REQ-131 |
| M8.4.3 | Container yield entry — the input to `unit_cost = lot.cost_zar / lot.yield_units` | §7.0.2 |

### E8.6 — The POS Day summary and its history (§7.5) *(you own it; Nikao reviews — it prints money figures)*

| # | Story | Satisfies |
|---|---|---|
| M8.6.1 | `/pos/today` and `/pos/history`: order count, gross, written off, collected, card fees, net settled, COGS, contribution, **tender totals split card vs fund**, **discounts split entitlement / comp / voucher**, voucher slips counted vs recorded, entitlement cups / walk-in cups / comps as three separate figures, deferred open/settled/written off, reconciliation status | REQ-128 |
| M8.6.2 | **It is a read, not an action.** Nothing is confirmed, nothing is submitted, no tap ends the day | REQ-128 |
| M8.6.3 | ⚠ **Three states, three renderings:** a day with no orders shows **zeroes**; a day whose fee import has not run shows **UNAVAILABLE** with "settles overnight" on the fee and net lines — never blank and never R0.00; a margin from an estimated lot shows **provisional** | REQ-129 |

---

## Phase GL — Go live *(yours, and the go/no-go is joint)*

⚠ **This runs after Phase 3, not at the end of the plan.** It was originally placed after the cost reporting, which would have left the café on Yoco's own app for months while a working till sat finished. Nothing in Phases 4–9 is needed to take an order, so go-live comes here and the rest continues with the café live.

Four things the PRD requires that the first draft of the plan had no home for.

| # | Story | Satisfies |
|---|---|---|
| MGL.1 | The **20-minute walkthrough** a barista can be taken through, plus the counter signage. It has to exist and be the same every time, or the training bar below means nothing. There is an old Jira ticket for this — close it in favour of this one | §5.3 |
| MGL.2 | **Training test 1:** a barista new to the system works a full weekday shift unaided after the walkthrough | §5.3 |
| MGL.3 | **Training test 2:** the same barista takes ten consecutive paid Sunday orders with a second person present but not intervening. This is the half that matters — Sunday is paid, busy and involves the card machine | §5.3 |
| MGL.4 | The **Sunday throughput drill** — 45 orders in 100 minutes on the real tablet with the tap budgets holding, measured per trading window | §5.2 |
| MGL.5 | The **wet-hands drill** — no mis-taps on the primary order path | §15.1 |
| MGL.6 | The **Friday go/no-go**, written down with both names on it. Four questions, all yes or Sunday runs on Yoco's app | plan §8.4 |

---

## Cross-phase: accessibility and the wet-hands drill *(yours throughout)*

Not a phase and not a separate epic — **the CI half is tracked on E0.8 and the drill is a pre-go-live gate tracked there too**, so it does not float unowned.

- Contrast and touch-target checks in CI against Layer 2's tokens, on every PR (from E0.8).
- Every control has an accessible name; the customer PWA is public and must be usable with a screen reader; every admin action reachable by keyboard.
- **No colour-only signalling** anywhere, and specifically not on the profit/loss indicator.
- The drill, once, before go-live: **a barista with wet hands, no mis-taps on the primary order path.**

---

## What is explicitly *not* yours

So the two documents add up without overlap: Nikao owns the host and database (E0.1–E0.5, E0.7), every server-side payment action and error path (E1.3–E1.6), alerting (E1.7), sessions and the session model (E2.1), identity and the entitlement repoint (E2.2), deduction and the `Extra Shot` deletion (E2.5), the voucher's server actions (E2.6 server half), `app_config` and rate limits (E2.7), the offline trim (E4.1), the fund's server side (E5.1, E5.2, E5.4), the Discord deletion (E6.1), the ministry rollup and `logExpense` (E8.2), the money fixtures (E8.5), and event mode (E9.1).

**You review all of the money ones.** That list is in `00-overview-and-roadmap.md` §4.
