---
description: Run the full pre-PR checklist — local CI, check GitHub check status, diagnose failures, fix issues, and confirm all checks green before you hand off for review. Use before every PR or after pushing a fix branch.
---

You are running the FAVO pre-PR readiness check. Work through every step. Fix issues as you find them — do not stop and ask.

Repo root: C:/Users/Nikao/Downloads/Favo-WebApp-github
The user's vertical is Design (feat/n-* branches). Never touch backend, POS, or admin files.

## Step 1 — Identify the current branch and its PR

```bash
cd C:/Users/Nikao/Downloads/Favo-WebApp-github
git branch --show-current
gh pr list --head $(git branch --show-current) --json number,title,baseRefName,url
```

If no PR exists yet, note the branch name. If it exists, record the PR number.

## Step 2 — Run local CI gate

```bash
export PATH="$HOME/.bun/bin:$PATH"
bun typecheck 2>&1
bun lint 2>&1
bun test:unit 2>&1
```

**If typecheck fails:**
- Read the exact error. Fix the TypeScript issue. Re-run until clean.
- Common causes: missing type imports, `any` where a type is needed, wrong prop types.

**If lint fails:**
- Run `bun lint --fix` first to auto-fix formatting.
- For remaining errors, fix each one manually.
- Never use `// eslint-disable` unless the rule is genuinely wrong for this code.

**If tests fail:**
- Run the failing file in isolation: `bun vitest run tests/unit/server/[file].test.ts`
- Read the failure. Fix the bug in the source or update the test if the behaviour legitimately changed.
- All 89 tests must pass before continuing.

Do not continue to Step 3 until `bun typecheck && bun lint && bun test:unit` all exit 0.

## Step 3 — Check GitHub CI status

If a PR exists:
```bash
gh pr checks <PR_NUMBER>
```

Expected: all three checks pass — `Typecheck · Lint · Test`, `review`, `security-review`.

**Diagnosing failures:**

### `Typecheck · Lint · Test` fails on GitHub but passes locally
Most likely cause: the branch targets a feature branch (not main) so CI never ran before — retarget the PR to main:
```bash
gh pr edit <PR_NUMBER> --base main
```
Then wait for CI to re-run and check again.

### `review` or `security-review` shows failure
Check if this is a stale result (from before the `continue-on-error` fix) or a real failure:
```bash
gh run list --branch $(git branch --show-current) --limit 5 --json name,conclusion,createdAt,headSha
```
If the failing run is from an OLD commit (not the current HEAD), it's stale. Force a fresh run:
```bash
# Make a real code touch to trigger a synchronize event
git commit --allow-empty -m "ci: retrigger checks" --no-verify
git push --no-verify
```
Then wait and re-check.

If `review`/`security-review` fail on the CURRENT commit, check if `CLAUDE_CODE_OAUTH_TOKEN` is set:
- Go to GitHub repo Settings → Secrets and variables → Actions
- If `CLAUDE_CODE_OAUTH_TOKEN` is missing, tell the user: "The CLAUDE_CODE_OAUTH_TOKEN secret needs to be added in GitHub repo settings by the repo admin. Review checks are non-blocking (continue-on-error) so this won't prevent the merge, but the automated review won't run until the secret is configured."

### CI doesn't appear at all on the PR
The workflow only fires on `pull_request` events. If you just retargeted the base, it may need a push to trigger:
```bash
git commit --allow-empty -m "ci: trigger checks after base retarget" --no-verify && git push --no-verify
```

## Step 4 — Verify base branch is correct

```bash
gh pr view <PR_NUMBER> --json baseRefName
```

- N1 → `main`
- N2, N4, N6 → `main` (after N1 merged)
- N3 → `main` (after N4 merges) or `feat/n-n4-hours-component` (if N4 not yet merged)
- N5 → `main` (after N2 and G7 merged)

If the base is wrong, retarget:
```bash
gh pr edit <PR_NUMBER> --base main
```

## Step 5 — Final confirmation

Run:
```bash
gh pr checks <PR_NUMBER>
```

All three checks must show `pass`. If any still fail after the steps above, diagnose further and fix.

When all pass, report:

> "PR #[N] is ready — all 3 checks green (Typecheck · Lint · Test ✓, review ✓, security-review ✓). Base: [branch]. Retarget the PR to main if it's on a feature branch and merge when approved."

## Common issues cheat sheet

| Symptom | Root cause | Fix |
|---|---|---|
| `review` + `security-review` both fail | `CLAUDE_CODE_OAUTH_TOKEN` secret not set | Non-blocking — tell user to add secret |
| CI not running at all | PR targets a feature branch | `gh pr edit N --base main` |
| Stale failing checks after a fix | GitHub caching old run | Empty commit push to trigger synchronize |
| `bg-dark-teal` class not applying | Tailwind v4 custom utilities not scanned | Use `style={{ backgroundColor: 'var(--color-dark-teal)' }}` instead |
| Login page 404 | Route group doesn't add to URL path | Move file outside the `(customer)` group to `src/app/customer/login/` |
| `bun: command not found` in Git hook | Bun not on bash PATH | First line of hook: `export PATH="$HOME/.bun/bin:$PATH"` |
