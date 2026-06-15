# TASK_PROTOCOL.md — How every task gets executed

> **Every AI reads this file before executing any Jira task. No exceptions.**
> Humans follow it too — it is the team's working agreement, approved 2026-06-11
> ("Team Protocol & Application Stack — Whiteboard Notes", Confluence, iXchange space).
>
> The canonical copy of this file lives in the repo. A mirror page lives on Confluence
> ("Task Protocol — AI Execution Rules") — if they ever disagree, the repo file wins,
> and the disagreement is a bug: fix the mirror.

Companion docs (same repo, when present): `Best_Practice_Code.md` (pipeline + code
formatting standards — *pending, being set up*) · `PR_Schedule.md` (merge cadence —
*pending*) · `board.md` (Nikao's board-checking routine reads the state this protocol
produces).

---

## 1 · Project registry

Per-project values. Future projects copy this block and change the values.

| Key | Value (FAVO) |
|---|---|
| Jira project | `AT` (hofmi.atlassian.net) |
| Epic | FAVO Café Web App epic in `AT` (all FAVO tasks are children) |
| Board statuses | `To Do` → `In Process` → `Review` → `Done` |
| Repo | `github.com/Heritage-Of-Faith/Favo-WebApp` |
| Local CI gate | `bun check` (= `bun typecheck && bun lint && bun test:unit`) |
| Entry-point doc | `CLAUDE.md` (repo root) — points to the specialist docs per task type |
| Task summary format | `[FAVO-P{phase}][{ID}] {Title}` e.g. `[FAVO-P3][G18] Wallet top-up + coffee packs` |
| Branch format | `feat/<initial>-<jira-key>-<task-id>-<kebab-name>` e.g. `feat/g-at59-g18-wallet-topup` |
| PR title format | `{JIRA-KEY} [FAVO-P{phase}][{ID}] {Title}` e.g. `AT-59 [FAVO-P3][G18] Wallet top-up + coffee packs` |
| Merge commit | Squash, same text as the PR title |

**Why the Jira key goes in the branch and PR title:** the GitHub↔Jira integration and
the Confluence dashboard only see your work if the issue key (`AT-59`) appears in branch
names, commits, and PR titles. Without it, the board drifts from reality — which is
exactly what happened before this protocol existed.

---

## 2 · Before you start — the gate checklist

Run through this in order. If any step fails, **stop and resolve it before writing code.**

1. **Read the Jira ticket fully — including every comment.** Review feedback and
   handover notes live in comments, not in the description.
2. **Check the ticket's "is blocked by" links.** Every blocker must be `Done`.
   For each blocker, **read its handover comment** (§6) — it tells you exactly what to
   connect to. If a blocker is not Done: do not start. Leave a signed comment on your
   ticket saying what you're waiting for, and flag the ticket (`Flagged = Impediment`)
   if it's urgent.
3. **Read the specialist docs the ticket names** (and `CLAUDE.md` → "How to start a
   task" if you haven't this session). Typically 2–3 files.
4. **Move the ticket to `In Process`** and make sure the assignee is set.
5. **Branch off latest `main`** using the branch format from §1. One task per branch.
   No mixed verticals.

If after all that you would still have to *guess* what to build — the task isn't
written well enough. Don't guess: comment on the ticket (signed) and ask the task
author. See the 95% rule (§3).

---

## 3 · Task anatomy — how tasks are written

For whoever creates tasks (humans or AIs generating tasks from an approved PRD).
**The 95% rule:** the PRD plus the ticket must get the executing AI 95% of the way.
If the AI would have to guess, the task isn't written yet.

**Summary:** use the format from §1, one format board-wide.

**Description, in this exact order:**

1. **Header line** — `**Branch:** … | **Owner:** … | **Phase:** …` plus
   `**PRD sections:** …` and `**Dependencies:** …` (the human-readable list; the
   machine-readable version is the issue links below).
2. **"What this task is about"** — the human overview, on top. Written so a
   10-year-old could read it and understand it fully. No Greek. This is what teammates
   skim and what reviewers use to orient.
3. **"What needs to be built"** — the in-depth AI instructions: exact files to create
   or modify, specs, edge cases, business rules by ID (e.g. L09), research pointers.
   As specific as possible — this is the part the AI executes.
4. **"Acceptance criteria"** — a checkable list. Each item must be verifiable by
   running something (a test, a command, a query, a click-through).
5. **Footer** — `Read TASK_PROTOCOL.md before starting.`

**Jira mechanics (not optional):**

- Dependencies are **issue links** (`blocks` / `is blocked by`), not just text.
  The dashboard's stuck-point detection reads these links; text is invisible to it.
- Parent **epic** is set. Assignee is set.
- Anything with independently checkable steps gets **subtasks**.

---

## 4 · Status flow — one loop, no shortcuts

```
To Do → In Process → [build + test locally until green] → push + PR
      → PR checker validates → Review (assignee adds reviewers on the ticket)
      → whole-team sign-off → squash-merge to main → Done
                 ↑                                      |
                 └── revisions needed: back to In Process ┘
```

- **Local first.** Nothing is pushed that hasn't passed `bun check` locally.
- **Push + PR** with the Jira key in branch and title (§1). One task per PR.
- **The automated PR checker** (runs ~every 30 min) checks conflicts and CI status.
  It keeps the queue moving; `PR_Schedule.md` keeps it from growing.
- **Move the ticket to `Review` and add the reviewers on the ticket** (Atlassian
  @/add-people) so their AIs can prompt them: "you need to check here."
- **Human review is mandatory** — the whole team signs off. AI checks never replace it.
- **Revisions** send the ticket back to `In Process`; loop until the review passes
  clean.
- **Blocked at any point:** signed comment on the ticket + `Flagged = Impediment`.
  Slack is for human conversation, not workflow state.

---

## 5 · Comments — how humans and AIs talk

Jira comments are the heart of the workflow: they're how humans and AIs communicate.

- **Plain language first.** A 10-year-old should understand every comment. Technical
  detail is welcome *after* the plain-language version, not instead of it.
- **Every AI comment is signed**, so anyone can tell AI from human. Format:
  `— Claude (for {team member})`.
- **Review feedback lives in ticket comments** — both people and their AIs read and
  act on it there.
- **Never edit old comments. Append.** The comment trail is the project's memory.

---

## 6 · The handover comment — mandatory before Done

If *anything* depends on your task (issue links or common sense), you must leave a
handover comment before the ticket is closed. The next AI starts from this comment —
write it for someone with zero context. Template:

> **Handover — {ID} done.**
> **What happened:** one plain sentence.
> **What changed:** files / server actions / endpoints / schema, with exact import
> paths and signatures. e.g. `topUpWallet(customerId, amountZar)` →
> `{ ok, data: { walletId, yocoClientSecret } }` from `@/server/actions/wallet`.
> **What the next task connects to:** precisely what to call, which env vars exist,
> what's seeded for testing, what was intentionally left out.
> — Claude (for {member})

---

## 7 · Definition of Done

A task is Done when **all** of these are true — until then it is `In Process` or
`Review`, never `Done`:

- [ ] Merged to `main`, all checks green
- [ ] Reviewed and signed off by the whole team (human review, not just AI checks)
- [ ] No known follow-up fixes — anything outstanding is documented on the ticket
- [ ] Handover comment left (§6) if anything depends on this task
- [ ] Ticket transitioned to `Done` by whoever merged — the board must match `main`
      *the moment* it changes, not at the end of the week

---

*Owner: Gian · Protocol source: Team Protocol & Application Stack — Whiteboard Notes
(11 Jun 2026), Confluence · This file: canonical · Questions → comment on the
Confluence mirror page.*
