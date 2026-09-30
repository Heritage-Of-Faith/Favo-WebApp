# FAVO Café — Build Plan · 04 · How this actually gets built

**Added 21 September 2026**, after Mia pointed out that the first draft of this plan assumed two people typing the code by hand. **Claude writes the code. Mia and Nikao specify, review, decide and verify.** That is a different job, and this document is the part of the plan that changes most.

---

## 1. What changes and what does not

### Build time collapses

A migration, a server action, a React component, a 76-file deletion sweep, a test suite — these are minutes to hours, not days. The first draft's estimate of 700–1,200 hours was human typing time and it no longer means anything.

### Five things do not move at all

The calendar is now set almost entirely by these, and none of them respond to writing code faster.

| What | Why it is fixed |
|---|---|
| **Waiting on people** | Matt's answer on the hosting agreement. Yoco's reply to the four questions. The SDK application's approval clock. The bookkeeper on the fund's accounting. Same clock as before |
| **Physical tests** | The R1.00 payment on the real Khumo, outside trading hours. The four-hour live-queue hold, which takes four hours. The backup restore. Pulling the plug for the offline drill |
| **Sundays** | The training bar needs **ten consecutive paid Sunday orders, supervised**. The throughput drill wants a real Sunday morning. There are four or five Sundays in a month and **you cannot compress one.** If a Sunday test fails, the retry is next week |
| **Two weeks of real trading** | The stock-variance criterion is "< 5% **by week 2**". The fee import needs a real Yoco export from a real trading day. No amount of code produces that data |
| **Your review throughput** | See §3. This is now the binding constraint on everything that is not waiting for a Sunday |

### One thing gets worse

Claude can produce more payments code per day than two part-time people can read carefully. On a system where **L02 means a wrong charge has no remedy but a free drink next time the person comes in**, unreviewed volume is the main risk this plan now carries. The gates are no longer a tax on top of building — **they are the work.**

---

## 2. The failure mode to design against

The PRD names it about itself, in Appendix D:

> *"The payment chapter is new text and has had no independent review … the same author wrote and swept all of it."*

That was about a human writing a spec alone. It describes the AI build pattern exactly, and worse:

**Claude writes the code → Claude writes the test → Claude reviews the PR = the same misunderstanding certified three times, with three green ticks on it.**

A test written by whoever wrote the code tests that the code does what its author thought it should. That is not worthless, but it is not independent, and on a payment path it is the specific failure that produces a confident, passing, wrong system.

### The guard: the human owns the number

The practice that fixes this is small and specific.

> **A human writes or checks the acceptance assertion. Claude writes the code and the test. The human's job at review is to confirm the assertion was not weakened.**

This works here because **the PRD already contains the numbers.** They were arrived at by a process independent of any code:

- FIXTURE-A asserts `cogs_zar` **R196.36**, `gross_margin` **R153.64**, `contribution` **R144.37**, 17 drinks, 10 double shots — a real trading day, worked to the cent, verified independently five times across two review runs.
- The tap budgets: **≤ 4** taps for a Sunday sale, **≤ 3** weekday single shot, **≤ 5** voucher double.
- The shot prices: R20 · R20 · R30 · R40.
- The 148 Given/When/Then rows.

So the reviewer's question is never *"is this code right?"* — which needs the domain. It is **"does this test still assert R144.37?"** — which needs only the PRD.

### The four review questions, unchanged but now load-bearing

On any money story:

1. **Does every assertion trace to a named requirement row or a gate row?** An assertion for something the PRD does not say means either you have not found the clause, or a requirement has been invented.
2. **Does the test assert the PRD's literal numbers, or compute them?** A test that recomputes the expected value from the same formula under test proves nothing.
3. **Is there a silent path?** A `SUM()` skipping NULLs. A zero where UNAVAILABLE belongs. A fetch error read as a status. A subscribed state on an iPhone that cannot honour it.
4. **Does anything retry a payment?** The only door is the three-condition test. If the answer is ever "yes, but only when…", stop and read §6.8.4 together.

---

## 3. Review tiers — what gets human eyes and how much

Reviewing everything equally means reviewing the important things badly. Three tiers.

### Tier A — two humans, before merge
**Payments, tenders, discounts, the blessing fund, write-downs, the Yoco integration, the payment adapter, secrets.**

- Both of you read it. Not a glance — the four questions above, answered out loud.
- **Cap: at most one Tier-A story in review at a time.** If a second is ready, the next thing either of you does is finish reviewing the first. Two money PRs open at once on a two-person team is how a bad approval gets clicked.
- Four items are **paired, not reviewed**: the R1.00 Khumo test, the three-condition re-charge rule, the fund's balance-locking test, and the synthetic money fixture. On those, watch it being built.

### Tier B — one human, before merge
**Auth and sessions, rate limits, permissions, personal data, the free weekday entitlement, migrations, stock deduction, the scheduled jobs.**

- The named reviewer reads the diff and runs the test.
- Cap: two in review at a time.

### Tier C — automated gates, human spot-check
**Screens, docs, deletions, config, seed data, report queries, the design system.**

- CI is the gate: typecheck, lint, unit tests, the contrast and touch-target checks, the enforcement greps.
- A human looks at the rendered result rather than the diff — does the screen work on the real tablet, does the page read correctly.
- No cap. This is where volume is safe.

**The reason Tier C can be loose:** every one of those has a cheap, objective check — a grep that must return zero, a contrast ratio, a screenshot. Tier A has none. A payment path either behaves correctly against a machine nobody has tested, or it does not, and no automated check available to this project can tell you which.

---

## 4. What the humans own outright

Claude cannot do these, and no amount of code changes that.

**Decisions with no right answer in the spec**
- Which bean cost is real — the seed says R3.21/cup, Yoco's implied figure is ~R8.76. A 170% gap on the ingredient in every coffee.
- The Chai Latte price, marked unconfirmed.
- Whether the powder scale is 0.18 or 18 ¢/g. A **stated open data question**, not a bug — no single price reconciles both Mocha and Hot Chocolate.
- Whether to accept the hosting terms, once Matt answers.
- Whether the deferred-income treatment of fund top-ups is right for HOFMI's books.

**Conversations**
- Matt, Yoco, the bookkeeper, Miné, HOFMI leadership.

**Physical acts**
- Linking the Khumo. Sending the R1.00. Taking the machine off the wifi. Pulling the tablet's network. Restoring the backup. Counting slips in a tin.

**Judgement about people**
- Whether a barista is genuinely ready after the walkthrough. Whether the screen works with wet hands. Whether the Friday go/no-go is a yes.

**And the one that matters most:** deciding that something is **good enough to take a stranger's money on a Sunday morning.** No test asserts that.

---

## 5. Revised timeline

Build time out, drills and review in. Same 182 tickets, same order, different arithmetic.

| Phase | Was | Now | What sets it |
|---|---|---|---|
| **P0** Back online | 3–5 wk | **1½–3 wk** | Matt's answer · scheduling the Khumo · DNS · the 4-hour hold. The 148-rule audit drops from weeks to about a day |
| **P1** Till + card payments | 5–8 wk | **2–3 wk** | Exercising ten failure paths on staging, and Tier-A review — not typing |
| **P2** Day types, sessions, vouchers | 4–6 wk | **1½–2½ wk** | Review of the entitlement and deduction work; one real weekday to sanity-check the free cup |
| **P3** Delete loyalty & packs | 2–3 wk | **4–7 days** | The backup, then suite-green after each step. The 76-file sweep itself is fast |
| **GL** 🟢 **Go live** | 1–2 wk | **2–3 wk** | **Sundays.** One weekday shift solo, then ten supervised paid Sunday orders. Now one of the *longest* phases |
| **Live at the counter** | 15–24 wk | **8–12 wk ≈ 2–3 months** | |
| P4 Offline verified | 1–2 wk | 3–5 days | The physical drill |
| P5 Blessing fund | 2–3 wk | 1–2 wk | The bookkeeper's clock |
| P6 Discord off | 3–5 d | 1–2 days | |
| P7 Docs & domain | 1 wk | 2–3 days | The 37-file sweep is fast; review is a day |
| P8 Cost visibility | 4–6 wk | **3–4 wk** | **Two weeks of real trading data**, and a real Yoco export. Almost entirely waiting, not building |
| P9 Event mode | 2–3 wk | 3–5 days | Plus a Wednesday to run the Discipleship 101 drill |
| **Whole plan** | 7–10 mo | **3½–5 months** | |

**Read the P8 and GL rows together, because they make the point.** The two longest remaining phases are long because one needs Sundays and the other needs a fortnight of real trading. Neither is a coding problem, and neither gets shorter if Claude writes faster.

### Where the remaining slack actually is

1. **Matt's answer.** It gates Phase 0's completion and nothing in this plan can route around it.
2. **Getting the Khumo tested.** Two hours of someone's time, outside trading hours, and the whole payment chapter is written on documentation until it happens.
3. **Your review capacity on Tier A.** With the one-at-a-time cap, the payment work is paced by how quickly you two can read it properly. That cap is deliberate and should not be raised to go faster.
4. **The Sunday calendar.** If the supervised-Sunday test fails, the retry is a week later. Build slack for one failed attempt.

---

## 6. What to set up before the first ticket

Three things, in this order. None takes more than a day and all three are cheap insurance.

1. **Put `CLAUDE.md` at the repo root.** It is in this folder, ready to drop in. It carries the PRD's authority, the 17 traps, the invariants, the standing prohibitions and the stop-and-ask rules. **This is the highest-value file in the whole plan**, because it is the one Claude reads automatically — a warning in a markdown plan document is a warning nobody loads. The current `CLAUDE.md` points at `FAVO_PRD_v3.md`, four versions stale.
2. **Put `FAVO_PRD_v7.0.md` in the repo** and archive the three superseded versions. A spec that exists only as a Claude artefact is a spec the repo cannot be checked against.
3. **Wire the enforcement greps into CI, not into a checklist.** The PRD gives seven of them — `wallet`, `loyalt|coffeepack|packRedemption`, `discord`, `hofmi\.org`, `sync_conflicts`, `pending_charges`, `refund`, `admin/login` — each of which must return zero at a defined point. As CI checks they are a wall; as items in a document they are a suggestion.

### And one habit worth having from day one

**Re-baseline after Phase 0.** Phase 0 produces this project's first real measurements: how long a Tier-A review actually takes, how fast tickets actually close, the four responsiveness figures, the audit's true test coverage. Every number in the table above is derived from reasoning rather than observation. **The second estimate is the one worth telling Miranda.**
