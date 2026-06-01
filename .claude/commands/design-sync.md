---
description: Apply a new design system export to a fresh brand/ branch, start the dev server for preview, and open a PR only after you approve. Never touches main directly.
---

You are applying a design system update to the FAVO Café web app on an isolated branch. Follow every step in order.

## Input

The user may provide:
- A `.zip` file path (Claude Design export)
- A `.css` file path
- No argument — use the default export path: `C:\Users\Nikao\Downloads\FAVO Design System.zip`

The argument is: $ARGUMENTS

---

## Step 1 — Read the source

If the input is a zip:
- Extract it to a temp folder
- Find `colors_and_type.css` inside it
- Read it

If the input is a `.css` file:
- Read it directly

Parse all CSS custom properties from `:root { ... }`. These are the incoming token values.

---

## Step 2 — Create an isolated brand worktree

From the repo root (`C:\Users\Nikao\Downloads\Favo-WebApp-github`):

```bash
git fetch origin
git worktree add ../favo-brand-$(date +%Y-%m-%d) -b brand/design-$(date +%Y-%m-%d) origin/main
```

If a branch for today already exists, append `-2`, `-3`, etc.

Then copy the environment file into the worktree (`.worktreeinclude` lists it but Claude Code handles the copy):
```bash
cp .env.local ../favo-brand-$(date +%Y-%m-%d)/.env.local
```

Install dependencies in the new worktree:
```bash
cd ../favo-brand-$(date +%Y-%m-%d) && bun install
```

**All remaining steps run inside the worktree directory, not the main repo.**

Tell the user: "Working in isolated worktree `../favo-brand-YYYY-MM-DD` on branch `brand/design-YYYY-MM-DD` — your current work in the main repo is untouched."

---

## Step 3 — Diff tokens

Compare the incoming tokens against `src/app/globals.css` `@theme { ... }`.

Show the user a clear diff:
- **Changed:** token name — old value → new value
- **New:** tokens not currently in globals.css
- **Removed:** tokens present in globals.css but missing from the new file (warn — do not delete automatically)

Continue without waiting for input unless a token is being fully deleted.

---

## Step 4 — Apply token changes

Update `src/app/globals.css`:
- Replace changed values in `@theme { ... }`
- Add new tokens in the correct section
- Update the Google Fonts `@import` if font families changed
- Never remove a token unless it was in the previous file and is explicitly absent from the new one

Update `src/lib/design-tokens.ts`:
- Update CSS var references and inline hex comments
- Add new tokens to the correct export object
- Never duplicate hex values — only `var(--token-name)`

---

## Step 5 — Copy new assets

If the zip contains an `assets/` folder:
- Copy new or updated files to `public/brand/`:
  - Logos → `public/brand/logos/`
  - Photography → `public/brand/photography/`
  - Brand icons → `public/brand/icons/`
- Report every file copied or updated

---

## Step 6 — Update docs/DESIGN.md token table

Update the Brand palette and Semantic tokens tables in `docs/DESIGN.md` to reflect the new values. Keep all other content unchanged.

---

## Step 7 — Run CI

```bash
bun check
```

If it fails, diagnose and fix before continuing. Do not push a broken branch.

---

## Step 8 — Push the branch

```bash
git add src/app/globals.css src/lib/design-tokens.ts docs/DESIGN.md public/brand/
git commit -m "brand: apply design system update $(date +%Y-%m-%d)"
git push -u origin brand/design-$(date +%Y-%m-%d)
```

---

## Step 9 — Start the dev server

```bash
bun dev
```

Tell the user:
> "Branch pushed and dev server running at **http://localhost:3000**. Review the design changes in the browser. When you're happy, say **'looks good, open PR'** and I'll create the pull request to main. Say **'discard'** and I'll delete the branch."

Wait for the user's response.

---

## Step 10a — If user says "looks good" or "open PR"

```bash
gh pr create \
  --title "brand: design system update $(date +%Y-%m-%d)" \
  --base main \
  --body "Design system sync from Claude Design export.

## Changes
- [auto-filled: list token changes from Step 3]
- [auto-filled: list assets copied from Step 5]

## Review checklist
- [ ] Landing page renders correctly
- [ ] Typography matches design system
- [ ] Colours correct on light and dark surfaces
- [ ] No layout regressions on POS or admin surfaces

🎨 Applied via \`/design-sync\`"
```

Output the PR URL.

## Step 10b — If user says "discard" or "looks wrong"

```bash
cd ../Favo-WebApp-github
git worktree remove ../favo-brand-$(date +%Y-%m-%d) --force
git branch -D brand/design-$(date +%Y-%m-%d)
git push origin --delete brand/design-$(date +%Y-%m-%d) 2>/dev/null || true
```

Tell the user: "Worktree and branch deleted. Main is unchanged. Adjust the design and run `/design-sync` again."
