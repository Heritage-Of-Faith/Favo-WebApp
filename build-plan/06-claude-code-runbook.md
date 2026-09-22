# FAVO Café — Build Plan · 06 · The Claude Code runbook

**For Mia, working from Claude Code.** This is the operating manual for the two weeks: what to put in the repo before you start, what to paste at the top of each day, and what to do when Claude tells you something is done.

---

## 1. Before the first prompt

Three files go into the repo. They are the difference between Claude Code guessing and Claude Code knowing.

| File | Where | What it does |
|---|---|---|
| `CLAUDE.md` | repo root, **replacing** the existing one | Loaded automatically in every session. Carries the spec of record, 14 verified traps, 20 live defects with line numbers, the invariants, and the standing prohibitions. |
| `scripts/verify-v7.ts` | `scripts/` | 33 machine-checkable gates. Run it and it tells you the truth in four seconds. |
| `FAVO_PRD_v7.0.md` | repo root | The spec itself, as text Claude can grep. It is currently only an HTML snapshot in the Claude project — get it into the repo. |

Then wire the gate into the check script:

```jsonc
// package.json
"verify": "bun scripts/verify-v7.ts",
"check":  "bun typecheck && bun lint && bun test:unit && bun verify"
```

Run `bun verify` once, before changing anything. Today it reports **8 passed · 22 failed · 3 warnings**. That is your starting line, and every one of those 22 is a real finding with a file and a line behind it.

---

## 2. The shape of a day

Claude Code works best when each session has one scope and one gate. Not "build the entitlement" — *"make this Given/When/Then true, and prove it."*

**Start of session:**

> Read `CLAUDE.md` and `scripts/verify-v7.ts` first.
> Today is **Day N: <the heading from plan §4>**.
> Scope: REQ-xxx, REQ-yyy. Nothing else.
> Before you write anything: grep for each of those requirements and tell me what you found. Assume absent, verify absent, say what you searched for.
> Then propose the change and **wait** — do not build until I say go.

The "wait" matters. The cheapest place to catch a misunderstanding is before the code exists.

**End of session:**

> Run `bun check`. Report: the test-count delta, which `verify-v7` gates changed state, and anything you chose not to do.
> If a gate still fails, say which and why — do not adjust the gate.

---

## 3. The three prompts worth keeping

### (a) The grep-first prompt
Use it at the start of anything you suspect might already exist.

> Before building: for each of REQ-xxx…, grep the repo and report `DONE / PARTIAL / ABSENT` with a file:line, or the exact pattern you searched for and got no match on. Do not infer from filenames. If you would describe something as missing from the PRD, read the raw PRD section first and quote it.

That last sentence exists because an earlier analysis reported §7.0.2's cost formulas as unspecified after reading a truncated summary. It was escalated to Nikao and had to be walked back. Raw text, always.

### (b) The adversarial review prompt
Run this in a **fresh session**, so it has no memory of the conversation that produced the code.

> Here is a diff and the requirement text it claims to satisfy. You did not write this code and you have no context on why it looks the way it does.
> One question: does this diff satisfy the Given/When/Then as literally written, or does it satisfy a paraphrase of it?
> Check specifically: was any existing assertion weakened, deleted, or made less specific? If a test changed in the same commit as the code it tests, quote both and say whether the test still constrains the behaviour.

This is the single highest-value AI habit in the whole plan. It costs one session and it catches the failure mode nothing else catches.

### (c) The parallel-read prompt
For anything that means reading a lot of files — a deletion sweep, a pre-go-live audit, "what does this feature touch."

> Split this across four subagents by scope: [A], [B], [C], [D]. Each one verifies against actual source and cites file:line. No agent infers from a filename. Give me one consolidated table.

The gap analysis behind this plan was exactly this: four agents, ~11 minutes, work that would have taken days by hand.

---

## 4. What you personally have to look at

Claude writes everything. You do not review 4,700 deleted lines — the gates do. You review a short list, and it is short on purpose.

**Always read yourself:**
1. **Any commit where a test changed alongside the code it tests.** Claude's commit message must say so in the first line. This is the one diff a gate cannot judge.
2. **FIXTURE-A and FIXTURE-B.** You or Nikao write the expected numbers, by hand, from the PRD's worked example. If the code disagrees with the fixture, the code is wrong. **R144.37, not R144.36.**
3. **The day-5 migration.** Once a migration is on production, unwinding it is a bad afternoon.
4. **Anything touching the entitlement**, because it is the reason the café exists and it is currently broken at the data model.

**Let the gates handle:** every deletion, every screen, every doc, the test count, the grep conformance, and all 33 invariants in `verify-v7.ts`.

**Nikao reviews with you on Tier A only** — money, auth, migrations touching `payments` or `orders`. One in review at a time, so neither of you is rubber-stamping a queue.

---

## 5. When Claude says something is done

Four questions. They take a minute and they catch most of it.

1. **"What did you grep for?"** If the answer is vague, the verification was vague.
2. **"What's the test count now?"** During the deletion pass it should fall toward ~750 from 942. Outside 740–760 is a finding.
3. **"Which `verify-v7` gates changed state?"** Should name specific ones. "All green" on a day that should not have fixed everything is a red flag, not a good sign.
4. **"What did you choose not to do?"** The most useful question in the list. Claude will usually tell you honestly, and it is where the deferred work hides.

---

## 6. Things to refuse

- **"I'll adjust the test so it passes."** No. If FIXTURE-A produces R144.36, the arithmetic is wrong. Stop and report.
- **"I've weakened the gate because it was too strict."** No. If a gate is wrong, change it deliberately, in its own commit, with a reason — never as part of making something else pass.
- **"This requirement seems unnecessary / isn't in the PRD."** Ask for the raw section quoted first.
- **A new "v8" or amendment document.** Changes go into v7.0 or they do not exist.
- **Shipping a money change during the two trading days** (days 12–14). Those days exist to observe, not to fix.

---

## 7. Getting push access

Claude Code can read the repo without anything — it is public. To push branches and open PRs it needs:

```bash
brew install gh        # or: winget install GitHub.cli
gh auth login          # choose GitHub.com → HTTPS → browser
```

One-time, on the machine you run Claude Code from. Until that is done, Claude can build and test locally but you will be committing by hand, which will cost you an hour a day for two weeks.

---

## 8. The one-line version

> **Claude builds. The gates verify. You decide.**
>
> Your judgement is needed on four things: the acceptance numbers, the migration, the entitlement, and what gets deferred. Everything else is either machine-checkable or somebody else's call.
