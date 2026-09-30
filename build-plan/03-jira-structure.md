# FAVO Café — Build Plan · 03 · Jira structure

**Nothing has been created in a live Jira.** The tickets are in **`favo-jira-import.csv`**, next to this file — 182 rows, written in plain English, with an **Assignee** column so each of you can see at a glance what the other is doing. Import it once you have agreed the split.

---

## 1. Issue hierarchy

Atlassian's own hierarchy is Initiative → Epic → Story → Task/Sub-task. FAVO is one project, so the Initiative level is skipped — it exists to group epics across several projects and there is nothing to group.

| Level | What it is here | Sizing | Example |
|---|---|---|---|
| **Epic** | **A phase.** Eleven of them (ten numbered, plus the go-live phase, which sits after Phase 3), matching the roadmap and the releases | Weeks–months | `Phase 1 — The till and card payments` |
| **Story** | One job, named in plain English, with an owner | 1–5 days | `Fix the free weekday coffee so office staff can actually get it` |
| **Task / Sub-task** | The steps inside a story | < 1 day | Made when the story is pulled, not at import |

*Why epics are phases and not work areas:* an epic cannot sit inside another epic, so having both "Phase 1" and "Card payments" as epics leaves one of them floating with nothing linked to it. Work areas live in the labels instead, which is simpler to read and easier to filter.

Three rules that keep the hierarchy honest:

1. **A Story that cites no requirement ID needs a reason in its description.** Most do — design-system work, docs reconciliation and the traceability audit legitimately have none, and those are written as *no REQ row* rather than left blank, so an absent citation is visibly deliberate rather than an oversight.
2. **Vertical slices, not architectural layers.** With two people, splitting into "Mia does all frontend / Nikao does all backend" creates two single-person silos on the money path, which is exactly what the ownership rule exists to prevent. Where a story genuinely spans both (the voucher, the fund's money-out), it is one Story with sub-tasks on each side and both names on it.
3. **Sub-tasks are created when the story is pulled, not at import.** Writing 400 sub-tasks up front for a plan that will change after Phase 0 is inventory, not planning.

---

## 2. Board type — Kanban, and this is a recommendation for you to confirm

**Recommended: a Kanban board with WIP limits, not Scrum.**

Atlassian's own Kanban-vs-Scrum guidance gives no firm team-size threshold and explicitly recommends experimenting rather than choosing on doctrine. So this is a judgement about this team, not a rule:

- **No PM and no scrum master.** Scrum's value is largely in coordination ceremony — sprint planning, review, retro, a backlog groomed against a velocity. Two people who talk daily do not need a ceremony to know what the other is doing; they need a board that shows it.
- **Recovery work does not fit fixed sprint boundaries.** Phase 0 waits on Matt, on Yoco and on a four-hour connection test. A two-week sprint containing "wait for a vendor email" is a sprint that fails for reasons nobody controls, and a burndown chart that measures that is noise.
- **WIP limits do the job sprint commitment does.** Limit 1–2 in-progress items per person. Two people with two things in flight each is four open branches — already more than a two-person review culture can keep current.
- **It suits a part-time intern's week.** Mia's hours land around study. Pull-when-ready is a better fit than "you committed to 13 points on Monday."

**What to confirm:** whether Nikao wants a sprint cadence for reporting reasons. If HOFMI leadership wants a rhythm, Fix Versions (§4) give that without sprint overhead.

### Suggested columns

`Backlog` → `Ready` → `In Progress` → `In Review` → `Done`

**The WIP limits go on `In Review`, not on `In Progress`.** Claude writes the code, so nothing queues up waiting to be built — it queues up waiting to be *read*. Limits by tier:

- **Tier A (money, Yoco, secrets): 1 in review, total.** Not one each — one. If a second money story is ready, the next thing either of you does is finish reviewing the first.
- **Tier B (auth, migrations, deduction, personal data): 2 in review.**
- **Tier C (screens, docs, deletions, config): no limit.** CI is the gate there.

Two further notes:

- **The cap is the safety mechanism, not a throughput setting.** Raising it to go faster removes the only thing standing between "Claude produced a lot of payment code" and "nobody read it".
- **A money story cannot enter `In Review` without the Reviewer field populated** (§5). Enforce this with a workflow validator if your Jira plan allows one; otherwise it is a habit and the Friday board review is where a blank one gets caught.

### Definition of Ready (so `Ready` means something)

A story is Ready when it cites its REQ rows, names its acceptance assertions with the PRD's own numbers in them, and — if it is a money story — has a Reviewer.

---

## 3. Labels

Keep the set small; a taxonomy nobody applies consistently is worse than none.

Plain words, no jargon. The full list is in §6; these are the ones that carry a rule:

| Label | Use |
|---|---|
| `money` | Touches payments, discounts, funds or a write-down. **Implies a mandatory Reviewer** |
| `yoco` | Talks to the card machine in code. **Mandatory Reviewer** |
| `security` · `privacy` · `entitlement` | Logins and limits · personal data · the free weekday cup. **Mandatory Reviewer** |
| `pair` | Do it together, not review-afterwards. Four tickets |
| `gate` | A phase cannot close until this is done |
| `guesswork` | Built on a number the spec itself calls unconfirmed |
| `waiting-on-someone-else` | Blocked on Yoco, Matt or the bookkeeper — not on each other |
| `vendor` | A conversation, not code. Deliberately **not** `yoco`, so the Reviewer rule does not fire on an email |

`waiting-on-someone-else` earns its place: it is what stops the Friday review spending ten minutes on something neither of you can move.

---

## 4. Fix Versions / Releases

Epics organise the backlog; **Fix Versions answer "what ships when"**, which is the question Mia needs for the weekly report to HOFMI leadership. One version per phase completion.

| Version | Phase | Released when |
|---|---|---|
| `0.1 Back online` | P0 | All eleven P0 exit criteria are true |
| `0.2 Till and card payments` | P1 | The payment gate row passes; tap budgets drilled and recorded |
| `0.3 Day types sessions and vouchers` | P2 | The free-cup bug closed; deduction correct per ingredient; voucher gates pass |
| `0.4 Cleaned up` | P3 | Both enforcement searches return nothing; no dead feature on screen |
| **`1.0 Live at the counter`** | **GL** | **Both training tests passed, the drills run, the go/no-go signed — the café is trading on FAVO** |
| `1.1 Offline verified` | P4 | The physical drill passes, or offline ships disabled |
| `1.2 Blessing fund` | P5 | The six fund gates pass **and** the bookkeeper has agreed DEC-15 |
| `1.3 One source of truth` | P6 + P7 | Discord search zero; wrong-domain search zero; CLAUDE.md points at v7.0 |
| `1.4 Cost visibility` | P8 | Both money fixtures pass; the rollup answers the funding question with no assembly |
| `1.5 Event mode` | P9 | The Discipleship 101 drill passes |

**`1.0` is go-live, deliberately.** It is the version that changes what happens at the counter, and it lands at roughly **2–3 months** rather than at the end. Everything after it improves a system already in daily use.

**For the weekly report:** the useful line is the version, its percentage complete, and any `waiting-on-someone-else` item with who is holding it. Not a task list.

---

## 5. The Reviewer field — enforce the ownership rule at the tool level

Add a **custom field: `Reviewer` (single user picker)**.

> **Mandatory on every issue labelled `money`, `yoco`, `security`, `privacy` or `entitlement`. It must be populated before the issue enters `In Progress`, and the named person must have approved the PR before the issue reaches `Done`.**

If your Jira plan supports a workflow validator, put one on the `Ready → In Progress` transition requiring the field when any of those labels is present. If it does not, add it to the issue template as a required checklist line:

```
Reviewer: [ name ]
Reviewed on: [ PR link ]
```

This is the §5 ownership rule made mechanical rather than remembered. Its reason, in one line: v7.0's own Appendix D says the payment chapter "has had no independent review" and "the same author wrote and swept all of it" — and L02 means a payment bug has no rollback, only a comped drink next time the person comes in.

**Also add:** a checklist on the Definition of Done in every money issue template —

```
[ ] Every assertion traces to a REQ row or a §15.1 gate row
[ ] The test asserts the PRD's numbers, not a recomputed expectation
[ ] No silent-failure path (SUM over NULLs, zero where UNAVAILABLE belongs, fetch error read as a status)
[ ] Nothing retries a payment outside S4 step 3's three conditions
[ ] Migration has a tested down script; CI ran down+up
[ ] docs/API.md regenerated if §11 behaviour changed
[ ] Ship record on the issue: SHA, URL, smoke result, audit-coverage result
```

---

## 6. The import file

**The tickets live in `favo-jira-import.csv`, next to this file.** It replaces the earlier draft, which was written in developer language — these are written so that either of you can read any ticket and know exactly what the other person is doing.

**182 rows: 11 epics and 171 stories.** Covers every phase, not just the first two.

### What each column is for

| Column | What it does |
|---|---|
| **Issue Type** | `Epic` = a phase. `Story` = one job. There are no sub-tasks in the file — make those when you pull a story |
| **Summary** | Plain English, no jargon. "Fix the free weekday coffee so office staff can actually get it" — not "repoint staff_entitlement_log FK" |
| **Description** | Four parts every time: **WHAT** it is · **WHY** it matters · **DONE WHEN** you can stop · **SPEC** where to look it up. The why is there so neither of you has to take the other's word for whether something is worth doing |
| **Epic Link** | Which phase it belongs to |
| **Assignee** | Who **owns** it — specifies it, has Claude build it, and verifies it. Not who types it; Claude writes the code. This is still the column that answers "what is the other person working on" |
| **Reviewer** | Who has to approve it. On money work, mandatory |
| **Blocked By** | Which ticket must finish first. **New** — see §8 |
| **Labels** | Plain words: `till`, `payments`, `money`, `fund`, `vouchers`, `reports`, `design`, `security`, `privacy`, `stock`, `sessions`, `docs`, `removal`, `audit`, `alerts`, `setup`, `events`, `database`, `customer-app`, `admin`, `gate`, `pair`, `guesswork`, `waiting-on-someone-else`, `vendor`, `phase` |
| **Fix Version** | Which release it ships in (§4) |

### The review tiers matter more than the labels

Claude writes the code, so the board's real job is routing work to the right level of human attention. Three tiers, set out in `04-how-claude-builds-this.md` §3:

- **Tier A — both of you read it before merge**, and **at most one in flight at a time.** Payments, tenders, discounts, the fund, write-downs, Yoco, secrets. If a second is ready, the next thing either of you does is finish reviewing the first.
- **Tier B — one named reviewer.** Auth, sessions, permissions, personal data, the free cup, migrations, deduction, the jobs. Two in flight.
- **Tier C — CI is the gate, a human looks at the result rather than the diff.** Screens, docs, deletions, config, report queries, the design system. No cap — this is where volume is safe.

Tier C can be loose because each item has a cheap objective check: a grep that must return zero, a contrast ratio, a screenshot. Tier A has none of those, which is exactly why it is capped.

### Three labels worth knowing

- **`pair`** — do it together, in the same room or the same call. Four tickets carry it: the R1 card machine test, the three-condition rule for re-charging a card, the fund balance-locking test, and the synthetic money fixture. These are the four places where a mistake costs real money and neither of us can catch it alone.
- **`guesswork`** — this ticket is built on a number the spec itself says is unconfirmed. Four of them. Do not treat the output as fact.
- **`waiting-on-someone-else`** — blocked on Yoco, Matt or the bookkeeper, not on each other. Four tickets. These are what stop the Friday review burning ten minutes on something neither of you can move.

---

## 7. Importing

1. Create the project (team-managed Kanban is fine).
2. Add the custom field **`Reviewer`** (single user picker) and a **`Blocked By`** field, or those two columns get dropped on import.
3. Create the eight Fix Versions from §4 first.
4. Import `favo-jira-import.csv`. Map `Epic Link` → *Epic Link*, `Assignee` → *Assignee*.
5. Spot-check five rows — in particular that `Labels` split on the semicolons rather than importing as one long label. If your Jira splits on commas instead, re-save that column with commas inside the quotes.
6. Set WIP limits: `In Progress` 2 per person, `In Review` 2 total.

---

## 8. Dependencies — who is waiting on whom

The `Blocked By` column is filled in for every story that genuinely cannot start yet. Two things it makes visible:

**Mia is downstream of Nikao more often than the reverse.** Most till screens need a database column or a server action that Nikao writes first. That is real and it is worth managing rather than discovering.

**The rule that fixes it: schema first.** Whenever a phase starts, Nikao's first job is to land the database columns and a stub of the server action for everything Mia will build that phase — even if the real logic comes later. A stub that returns sensible fake data unblocks weeks of screen work.

**The second rule: Mia always has an unblocked queue.** These jobs depend on nothing and can be pulled at any time:

- The 148-rule checklist and her half of the audit (Phase 0)
- The whole colour and size system (Phase 0)
- Removing the loyalty and packs screens (Phase 3)
- Her half of the document clean-up (Phase 7)
- Any test-writing ticket the audit produced

If she is ever blocked, she pulls from that list rather than waiting. It is not busy-work — two of those are phase exit criteria.

---

## 9. Keeping the split fair

Three rules, agreed at the first board review and revisited at each phase review:

1. **The tedious jobs are split, not assigned.** The three genuinely dull jobs in this plan — the 148-rule audit, the loyalty deletion, the document clean-up — are each split down the middle. The audit is split so that **each person audits the half the other will build**, which is the cheapest way either of you learns the other's area.
2. **Four tickets are paired, not reviewed.** Labelled `pair`. On those, reviewing afterwards is not enough.
3. **First pick rotates.** At each phase review, whoever carried more of the dull work last phase picks first from the next phase.
