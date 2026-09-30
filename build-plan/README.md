# FAVO Café — build plan

The plan for getting FAVO from where it is to PRD v7.0, written against the repo as it actually stands. Verified against `main @ 3902e61` on 22 Sep 2026: cloned, dependencies installed, test suite run.

**Source of truth is `docs/FAVO_PRD_v7.md`.** This folder is a plan for building to it, not an amendment to it. Where the two disagree, the PRD wins.

## Read this first

| | |
|---|---|
| **[05-the-two-week-plan.md](05-the-two-week-plan.md)** | The current plan. Start here. Weekday-first go-live, day by day, with the honest scope. |
| **[06-claude-code-runbook.md](06-claude-code-runbook.md)** | How to run the two weeks from Claude Code: prompts, what to review yourself, what to refuse. |
| **[CLAUDE.proposed.md](CLAUDE.proposed.md)** | A proposed replacement for the repo-root `CLAUDE.md`. **Not applied** — see the note below. |

## The rest

| | |
|---|---|
| [00-overview-and-roadmap.md](00-overview-and-roadmap.md) | The full 11-phase roadmap, the ownership rules, the risk register. The long-form plan behind the fortnight. |
| [01-mia-tasks.md](01-mia-tasks.md) · [02-nikao-tasks.md](02-nikao-tasks.md) | Per-person task breakdowns, every row citing Appendix C IDs. |
| [03-jira-structure.md](03-jira-structure.md) | Board structure, epics, labels, the import CSV's shape. |
| [04-how-claude-builds-this.md](04-how-claude-builds-this.md) | What changes when Claude writes the code, and what doesn't. |

## Where the project actually is

Measured against all 148 Appendix C requirements, by reading source and citing file:line:

| | Count |
|---|---|
| DONE | 12 |
| PARTIAL | 25 |
| ABSENT | 110 |
| DELETE (exists, v7 removes it) | 1 |

The repo is a working café app built to PRD v3. v7 replaces v3's money rules, mode rules and payment architecture, so most of v7's normative behaviour is genuinely absent rather than half-built. The infrastructure — queue, SSE, push, inventory containers, 942 green tests — is real and carries forward.

**Full v7 in two weeks is not possible.** Weekday service is. Sunday card sales are not: the repo uses Yoco's *online checkout* API with a webhook, and v7 specifies the *Web POS* device API with polling and no webhook. §1 of the two-week plan has the reasoning.

## The gate script

`scripts/verify-v7.ts` is the machine-checkable half of v7 conformance — 33 gates covering the PRD's own deletion greps, the money-shape invariants, the auth fixes, and the post-deletion test-count band.

```bash
bun scripts/verify-v7.ts
```

Wire it into `package.json`:

```jsonc
"verify": "bun scripts/verify-v7.ts",
"check":  "bun typecheck && bun lint && bun test:unit && bun verify"
```

Against `main` today it reports **8 passed · 22 failed · 3 warnings**. Every failure is a real finding with a file and a line behind it. A gate that fails blocks the commit; if you think a gate is wrong, change it deliberately in its own commit — never as part of making something else pass.

## A note on `CLAUDE.proposed.md`

The repo-root `CLAUDE.md` was updated in #238 to point at `docs/FAVO_PRD_v7.md`. `CLAUDE.proposed.md` is a fuller replacement: the traps verified against the current schema, the live defects with line numbers, the invariants, and the standing prohibitions.

It is **deliberately not applied** — #238 is recent work by someone else and overwriting it silently would be wrong. Read it, then decide whether to replace the root file with it.

## Two things found while writing this

1. **`docs/FAVO_PRD_v7.md` is missing REQ-118** from the Appendix C table. The row exists in the authoritative HTML snapshot; it did not survive the Markdown conversion in #238. FIXTURE-B — the synthetic day that exercises every discretionary term in §7.0.2 — is described in §15.1 but has no normative row. Worth restoring, because FIXTURE-B is one of the two acceptance bars the plan relies on.
2. **v7.0 has two known internal defects**, neither anyone's fault here: §9.6.1 and §16.1 say "six" scheduled jobs where §9.6.2 (the register of record) lists **seven**; and Appendix D says the fund's counter top-up inherits R18 while R18's own row doesn't mention it.
