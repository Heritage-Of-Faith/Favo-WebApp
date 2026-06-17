# FAVO Café — Phase 4 Build Plan

**Phase:** P4 · QA + Production Deploy + Hand-off — **Launch Day**
**Date:** Day 7 · Wed 3 Jun 2026
**WI:** `HOFMI-FAVO-P4`
**Repo:** `github.com/hofmi-ai/favo`
**Default branch:** `main`
**Deploy target:** `favo.hofmi.org` (Coolify on `hofmi-eu-open`, Cloudflare in front)
**Reference docs:** `CLAUDE.md`, `DESIGN.md`, `ARCHITECTURAL.md`, `DATA_MODEL.md`, `API.md`, `BUSINESS_RULES.md`, `PLANNING.md`, `FAVO_PRD_v3.md`

Phases 1–3 have shipped to `main`. Phase 4 is verification, hardening, deploy, and hand-off. **No new feature code** unless something fails pre-flight.

---

## 1. Phase 4 acceptance (from PRD §09)

> Audit coverage query returns 0. All Playwright tests green. Push notification works on a real device from `favo.hofmi.org`. Admin can see live COGS.

**Ship gate:** Matt (Owner) + Nkuli (Admin) sign off. Helm WI transitions to `shipped`. Discord ping to `#favo-ops` with deploy SHA and smoke result.

**The audit-coverage query** (must return 0):

```sql
SELECT COUNT(*)
FROM orders o
LEFT JOIN audit_log a
  ON a.entity_id = o.id AND a.entity_kind = 'order'
WHERE a.id IS NULL
  AND o.completed_at IS NOT NULL;
```

---

## 2. Team & load distribution

| Dev | Phase 4 task count | Why this shape |
|---|---|---|
| **Gian** | 5 | All deploy infra, security, observability, DR runbook, ship coordination |
| **Mine** | 3 | POS pre-flight + prod smoke + barista training |
| **Mia** | 3 | Admin pre-flight/prod smoke + ops runbook + incident playbook |
| **Nikao** | 3 | Customer-side smoke + POPIA pack + counter signage |

Total: 14 tasks across a single day. Most tasks are 1–3 hours; deliberate slack built in for issues found during smoke.

---

## 3. Branching, CI, merge order

- Branch: `feat/<initial>-<task-id>-<kebab-name>` (e.g. `feat/g-g23-preflight-gate`) or `chore/...` for non-code work
- Squash-merge to `main` with `[HOFMI-FAVO-P4] {ID} — {title}`
- CI gate: `bun typecheck` · `bun lint` · `bun test:unit` — green before merge (same as prior phases)
- Phase 4 adds two new CI gates: `bun test:e2e:ci` (full suite, not just incremental) and the security scan job (G24)

### Order of operations on launch day

Strict timeline. Each block has an owner who reports green/red to the channel before the next block starts:

| Window (SAST) | Phase | Lead |
|---|---|---|
| 06:00–09:00 | Pre-flight: E2E + security + Lighthouse + domain smokes on staging | Gian (coordinates) |
| 09:00–11:00 | Production environment + deploy | Gian |
| 11:00–13:00 | Post-deploy smoke on `favo.hofmi.org` (read-only paths only per PRD §11) | All four — each in their domain |
| 13:00–15:00 | Hand-off: walk FAVO team through the runbook + training packs | Mia (ops), Mine (POS), Nikao (customer) |
| 15:00–17:00 | Standby · Owner + Admin sign-off · Discord ship ping | Gian |

---

## 4. Dependency graph

```
G23 (pre-flight gate) ──┬─► G24 (security pass)
                         ├─► M20, A19, N18 (domain pre-flights)
                         └─► G25, G26 (deploy) — blocked until everything green

G25 (prod env) ──► G26 (Coolify deploy) ──┬─► M21, A20, N19 (prod smoke)
                                          └─► G27 (ship coordination)

G24 (security) ──► G26 (deploy)   # zero critical findings is a deploy gate
G27 (DR runbook) ──► G25          # restore must be tested before we deploy

Handoff docs (M22, A21, A22, N20, N21) — parallel to prod smoke; due by 13:00
```

---

## 5. Developer cards

---

### Gian — Deploy, security, observability, DR, ship

---

#### G23 — Pre-flight: consolidated E2E + green gate

- **Owner:** Gian
- **Branch:** `feat/g-g23-preflight-gate`
- **PRD sections:** §11 (verification protocol), §09 P4
- **DB tables touched:** none (read-only against staging)
- **Files to create / modify:**
  - `tests/e2e/full-suite.spec.ts` — orchestrates Phase 1, 2, 3 acceptance specs as a single run
  - `tests/e2e/audit-coverage.spec.ts` — runs the audit-coverage SQL after every mutating step and asserts 0
  - `.github/workflows/preflight.yml` — separate workflow gated to `workflow_dispatch` plus a label trigger on PRs labelled `release-candidate`
  - `scripts/preflight.sh` — single command that runs unit + e2e + audit coverage + Lighthouse smoke
- **Claude prompt:**
  > Read `FAVO_PRD_v3.md` §09 §11 and the three Phase acceptance specs already in `tests/e2e/phase[1-3]-acceptance.spec.ts`. Build a `full-suite.spec.ts` that runs all three in sequence against a fresh staging database (`bun db:reset && bun db:seed:phase1..3`). Add a final spec block that issues the audit-coverage query from §1 of this plan and asserts the count is 0. Build `scripts/preflight.sh` running: (1) `bun typecheck`; (2) `bun lint`; (3) `bun test:unit`; (4) `bun test:e2e:ci tests/e2e/full-suite.spec.ts`; (5) Lighthouse CLI against staging landing + dashboard + POS shell. Exit non-zero if any step fails. Wire it into a manual GitHub Actions workflow `preflight.yml` triggerable from the Actions UI. Output a single summary JSON `preflight.json` with timestamps, durations, pass/fail per gate — Gian posts this to Discord as the green-light signal.
- **Acceptance criteria:**
  - `bash scripts/preflight.sh` returns 0 on a clean staging
  - Audit coverage query returns 0 at the end of the full suite
  - GitHub Actions run produces a downloadable `preflight.json`
- **Dependency:** All Phase 1–3 acceptance specs

---

#### G24 — Security pass: Semgrep + Grype + dependency audit

- **Owner:** Gian
- **Branch:** `feat/g-g24-security-pass`
- **PRD sections:** §09 P4 (zero critical findings gate)
- **DB tables touched:** none
- **Files to create:**
  - `.semgrepignore`
  - `.semgrep/favo-rules.yml` — custom rules for: PAN-like patterns near logging, `audit_log` writes around mutations, raw SQL without parameter binding
  - `.github/workflows/security.yml` — runs Semgrep, Grype (container scan against the Coolify build image), and `bun audit` on every PR
  - `docs/security-baseline.md` — captures the zero-critical baseline + known accepted findings
- **Claude prompt:**
  > Read `FAVO_PRD_v3.md` §05 (security invariant — no PAN in any log/audit/store), §07. Configure Semgrep with the OWASP Top 10 + LGPL-clean rulesets and three custom FAVO rules: (1) `pan-near-log` — flag any string containing 13–19-digit numbers near `console.log`, `logger.*`, `pino`, `writeAudit`; (2) `mutation-without-audit` — flag any `await db.insert|update|delete(...)` not preceded within 5 lines by `writeAudit(`; (3) `raw-sql-no-params` — flag any `sql.raw(` or template-literal SQL without parameter binding. Add Grype to scan the production container image built by Coolify; configure `--fail-on critical`. Add `bun audit --severity high` to the same workflow. Zero critical findings is the gate — block deploy if any pipe fails. Document the baseline in `docs/security-baseline.md` with each accepted finding annotated (suppressing should be rare; explain why if so).
- **Acceptance criteria:**
  - All three scanners run in CI on every PR
  - Current `main` shows zero critical findings
  - `docs/security-baseline.md` is current
- **Dependency:** None (can land before P4 if desired; the gate is what matters on launch day)

---

#### G25 — Production environment: Infisical, Cloudflare, health checks

- **Owner:** Gian
- **Branch:** `feat/g-g25-prod-env`
- **PRD sections:** §05 (Tech stack, env), §10 (R2 R8 mitigations)
- **DB tables touched:** none direct (sets up prod Postgres connectivity)
- **Files to create / modify:**
  - `infra/cloudflare/access-policies.tf` (or JSON if no Terraform) — gates `/admin/*` to HOFMI SSO identities
  - `infra/cloudflare/waf-rules.json` — block obvious abuse patterns, rate limit `/api/auth/*` and `/api/payments/yoco/webhook` (separate budgets — webhook allowance higher to allow Yoco retries)
  - `infra/coolify/favo-app.yaml` — production app config with Infisical service token + healthcheck endpoint
  - `src/app/api/healthz/route.ts` — extends Phase 1 with DB ping + Yoco ping + Loki reachable
  - `docs/production-env-checklist.md` — every env var, where it comes from, who owns it
- **Claude prompt:**
  > Read `ARCHITECTURAL.md` env section and `FAVO_PRD_v3.md` §05. Verify (and document) that every canonical env name is set in Infisical project `hofmi/favo` for the production environment. Generate Cloudflare Access policies that gate `/admin/*` (admin role, HOFMI SSO required). Customer + POS + landing remain public. Add WAF rate limits: `/api/auth/*` 10 req/min/IP, `/api/payments/yoco/webhook` 60 req/min/IP (Yoco retry budget per R8), POST endpoints overall 100 req/min/IP. Extend `/api/healthz` to perform a real Postgres `SELECT 1`, a Yoco API ping, and a Loki reachability check; cache for 5 s. Build a `docs/production-env-checklist.md` table with every env var, source, owner, rotation cadence — Gian uses this as the deploy go/no-go.
- **Acceptance criteria:**
  - `https://favo.hofmi.org/api/healthz` returns 200 with all three sub-checks green
  - Anonymous request to `/admin` returns Cloudflare Access challenge (302 to SSO)
  - WAF rate limits enforce against a manual `ab`/`curl` storm
- **Dependency:** None (can prep day before)

---

#### G26 — Observability: Loki + Grafana + Sentinel alerts

- **Owner:** Gian
- **Branch:** `feat/g-g26-observability`
- **PRD sections:** §05 (logs, tracing), §04 (criteria the dashboards verify)
- **DB tables touched:** none direct
- **Files to create / modify:**
  - `infra/grafana/dashboards/favo-cogs.json` — live revenue, COGS, expenses, net per day
  - `infra/grafana/dashboards/favo-ops.json` — order count, average time-to-cup, push delivery latency p95, SSE connection count, deferred payment count
  - `infra/grafana/dashboards/favo-variance.json` — weekly variance per item per the SQL view from Phase 2 G13
  - `infra/sentinel/alerts.yml` — alert rules
- **Claude prompt:**
  > Read `ARCHITECTURAL.md` observability section, `FAVO_PRD_v3.md` §04 §05. Build three Grafana dashboards reading from Loki + Postgres. **favo-cogs:** mirrors the admin live COGS dashboard so the ops team can watch from outside the app. **favo-ops:** order count rolling 1h, p50/p95 order-to-cup time from `orders.placed_at → orders.completed_at`, push delivery latency from audit rows, SSE active connection count, deferred payment count. **favo-variance:** weekly variance per item, coloured by T01 bands. Sentinel alerts: (a) push latency p95 > 10 s (5-min window) — page on-call; (b) deferred payment count > 0 — Discord ping; (c) audit-coverage query > 0 — page on-call (this is a P0); (d) Yoco webhook 4xx rate > 5 % over 5 min — Discord ping; (e) PostgreSQL replication lag > 60 s — Discord ping.
- **Acceptance criteria:**
  - Three dashboards render against staging data
  - Audit-coverage alert is wired and tested (manually break audit coverage in staging, alert fires within 60 s)
- **Dependency:** G25

---

#### G27 — Production deploy + smoke runbook + ship coordination

- **Owner:** Gian
- **Branch:** `feat/g-g27-deploy-ship`
- **PRD sections:** §09 P4, §11
- **DB tables touched:** all (read-only smoke post-deploy)
- **Files to create:**
  - `docs/deploy-runbook.md` — exact steps, rollback steps, who-pings-whom
  - `docs/backup-restore.md` — Warden R2 snapshot restoration procedure (DR drill)
  - `tests/e2e/prod-smoke.spec.ts` — read-only paths only: landing loads, healthz green, login pages render, POS shell loads behind PIN page, admin page redirects to SSO. **No mutations on prod data.** (PRD §11)
  - `scripts/ship-ping.ts` — posts deploy SHA, smoke result, audit-coverage query result to `#favo-ops`
- **Claude prompt:**
  > Read `FAVO_PRD_v3.md` §09 §11, `ARCHITECTURAL.md` deploy pipeline. Write `deploy-runbook.md` covering: (1) verify pre-flight green (G23 + G24 outputs); (2) verify production env checklist (G25); (3) tag the release commit `v1.0.0`; (4) trigger Coolify webhook; (5) watch logs in real time via Loki; (6) post-deploy smoke (this spec); (7) ship ping; (8) standby for 60 min on the channel. Write `backup-restore.md` documenting Warden R2 nightly snapshot location, point-in-time recovery procedure (worst-case 24h granularity per PRD §10), and a quarterly DR drill template. Build `prod-smoke.spec.ts` running read-only paths only (PRD §11 forbids mutations on prod). Write `scripts/ship-ping.ts` posting a structured Discord embed (title, deploy SHA short, smoke result, audit coverage = 0, link to dashboards).
- **Acceptance criteria:**
  - Coolify deploy succeeds; `favo.hofmi.org` returns 200 within 2 min
  - `prod-smoke.spec.ts` passes against prod
  - Audit coverage query returns 0 immediately after deploy
  - Discord ship ping arrives in `#favo-ops` with all four expected fields
- **Dependency:** G23, G24, G25, G26

---

### Mine — POS pre-flight, prod smoke, barista training

---

#### M20 — POS pre-flight: iPad install + offline drill rehearsal

- **Owner:** Mine
- **Branch:** `chore/m-m20-pos-preflight`
- **PRD sections:** §09 P4, §05 (Offline POS), §10 R2 R3
- **Files to create:**
  - `docs/pos-preflight-checklist.md`
  - `tests/e2e/pos-ipad-smoke.spec.ts` — runs the Phase 1 acceptance flow plus the offline drill against staging, with viewport pinned to 768×1024
- **Claude prompt:**
  > Read `FAVO_PRD_v3.md` §05 §09 §10. On the actual launch hardware (the FAVO counter iPad), perform a clean "add to home screen" install of the POS PWA from staging, log in with PIN, place a test order, transition through to ready, and verify SSE keeps the queue board live. Then perform the 30-minute offline drill end-to-end: WAN off, 5 orders queued, WAN on, sync flushes cleanly. Codify the drill as `pos-ipad-smoke.spec.ts` so it can be re-run in CI with `context.setOffline(true)`. Document any iPad-Safari quirks observed (PWA install storage limits, push permission UX) in `docs/pos-preflight-checklist.md`.
- **Acceptance criteria:**
  - Real iPad runs the full Phase 1 acceptance flow end-to-end
  - Offline drill passes (5/5 orders reconcile, zero loss, zero duplicates)
  - Checklist is signed off by Mine
- **Dependency:** Phase 3 M14, G23

---

#### M21 — POS prod smoke + real-device push test

- **Owner:** Mine
- **Branch:** `chore/m-m21-pos-prod-smoke`
- **PRD sections:** §09 P4 acceptance (push from real device on `favo.hofmi.org`)
- **Files to create:**
  - `docs/pos-prod-smoke.md` — short walkthrough Mine executes between 11:00 and 13:00 SAST
- **Claude prompt:**
  > Read `FAVO_PRD_v3.md` §09 P4. On launch day, immediately post-deploy, log in via PIN on the prod-pointing iPad, place a single test order against a registered staff-owned test customer (use a non-public test phone number to keep noise out of real data). Confirm: (a) Yoco test card flow succeeds; (b) state machine progresses normally; (c) Done transitions to ready; (d) push notification fires within 10 s to Mine's personal device (subscribed via N19's smoke). Take screenshots of each step. Stop short of a real-money transaction. Document the result inline in `docs/pos-prod-smoke.md` as the launch-day evidence pack.
- **Acceptance criteria:**
  - All four POS prod-smoke steps green
  - Push received in < 10 s
  - Screenshots saved
- **Dependency:** G27 (deploy complete)

---

#### M22 — Barista training pack + counter signage

- **Owner:** Mine
- **Branch:** `chore/m-m22-barista-training`
- **PRD sections:** §09 P4 hand-off, `DESIGN.md`
- **Files to create:**
  - `docs/training/barista-quickstart.md` — first-time walkthrough (PIN, taking an order, marking ready, staff discount, waste, redeem loyalty)
  - `docs/training/barista-troubleshooting.md` — Yoco failure, push not arriving, offline mode, lockout
  - `docs/signage/counter-loyalty.md` — copy + layout for a printed counter sign: "Register for loyalty in 30 seconds — favo.hofmi.org"
  - `docs/signage/counter-push.md` — "Allow notifications and we'll ping you when your order is ready"
- **Claude prompt:**
  > Read `FAVO_PRD_v3.md` §09 P4, `DESIGN.md`. Write a barista quick-start as a one-page walkthrough using screenshots from M21. Cover: PIN login, customer lookup ("type Lou, tap Louis"), order build, staff discount weekday/cappuccino-only rule (L03/L14 in plain language), Yoco swipe, Done button, waste logging, loyalty redeem. Troubleshooting page covers the five most likely issues with one-sentence remedies and a "call Gian" escalation line. Signage copy: A6-sized printed cards, brand-consistent with N1 tokens, two designs — loyalty registration and push opt-in. Plain text in `.md` (Nikao can lay out for print if needed).
- **Acceptance criteria:**
  - Quick-start fits on one A4 page when printed
  - Troubleshooting covers Yoco / push / offline / lockout / "I broke something"
  - Signage copy reviewed by Nikao
- **Dependency:** M21 (for screenshots)

---

### Mia — Admin pre-flight, prod smoke, ops runbook, incident playbook

---

#### A19 — Admin pre-flight smoke + admin prod smoke

- **Owner:** Mia
- **Branch:** `chore/a-a19-admin-smokes`
- **PRD sections:** §09 P4 acceptance ("admin can see live COGS")
- **Files to create:**
  - `tests/e2e/admin-flow.spec.ts` — pre-flight against staging: login, dashboard load, inventory view, stock take walkthrough, expense log, monthly P&L draft + admin sign-off
  - `docs/admin-prod-smoke.md` — Mia's launch-day walkthrough: log in via HOFMI SSO on prod, confirm dashboard renders live numbers, confirm one CSV export downloads, confirm one PDF export renders
- **Claude prompt:**
  > Read `FAVO_PRD_v3.md` §09 P4. Build `admin-flow.spec.ts` as a Playwright spec covering the Phase 2 admin acceptance plus the Phase 3 admin extensions (hours editor, exports). Run as part of pre-flight (G23). On launch day after G27 completes, perform the read-only prod smoke: log into `favo.hofmi.org/admin` via SSO, confirm the COGS dashboard renders (numbers will be zero or near-zero on a fresh prod DB — that's fine, the assertion is that it renders without error), download one CSV and one PDF export. Document inline in `docs/admin-prod-smoke.md`.
- **Acceptance criteria:**
  - Pre-flight spec passes on staging
  - Admin prod smoke runs cleanly within 5 min of deploy
  - Live COGS dashboard renders on prod with no errors
- **Dependency:** Phase 1–3 admin tasks, G27

---

#### A20 — Operations runbook (daily / weekly / monthly)

- **Owner:** Mia
- **Branch:** `chore/a-a20-ops-runbook`
- **PRD sections:** §08 L09 L11 T-rules, §09 P4 hand-off
- **Files to create:**
  - `docs/ops-runbook.md`
- **Claude prompt:**
  > Read `BUSINESS_RULES.md` and the Phase 2 admin task cards (A7–A13). Write a single-document operations runbook covering the FAVO admin's recurring duties. **Daily:** open the COGS dashboard (morning check); investigate any flagged variance; respond to low-stock pushes; verify closeDaily cron landed at 23:59 (no Discord red ping). **Weekly:** Sunday — review `generateWeeklyPnL` Discord ping; investigate any variance > 5 % band (T01); run an inventory stock take. **Monthly:** generate the previous month's P&L; sign as admin to close per L11. **Quarterly:** review T-rule tunings (variance bands, freshness windows, low-stock thresholds, sunday rush window). **Annually:** rotate staff PINs; audit RBAC. Each section names the relevant admin screen path and links to the business rule. Plain language — assume the reader is Nkuli, not a developer.
- **Acceptance criteria:**
  - Runbook covers every recurring admin duty implied by the locked + tunable rules
  - Each duty links to the admin screen that supports it
  - Nkuli walks through and confirms understanding during hand-off
- **Dependency:** Phase 2 admin tasks

---

#### A21 — Incident response playbook

- **Owner:** Mia
- **Branch:** `chore/a-a21-incident-playbook`
- **PRD sections:** §10 (Risks & Rollback)
- **Files to create:**
  - `docs/incident-playbook.md`
- **Claude prompt:**
  > Read `FAVO_PRD_v3.md` §10. Build an incident playbook covering each of R1–R10. Per risk: (1) symptoms ("how would I notice this?"); (2) immediate response ("first 5 minutes"); (3) escalation ("when to call Gian"); (4) restoration ("how do we recover?"); (5) post-mortem trigger ("what gets logged where?"). Front the doc with a single "OH NO" decision tree: app down → check `favo.hofmi.org/api/healthz`; payment broken → check Yoco status + Loki for webhook errors; push not arriving → check VAPID config + customer subscription state; queue stuck → check SSE connection in browser dev tools; offline orders not syncing → open `/admin/sync-conflicts`. Each branch ends at either a self-serve fix or a "page Gian" instruction with the on-call rotation link.
- **Acceptance criteria:**
  - Every PRD R-risk has a playbook entry
  - Decision tree covers the top 5 ways things go wrong from the admin's view
  - Cross-referenced with Gian's `docs/deploy-runbook.md` for the rollback paths
- **Dependency:** A20

---

### Nikao — Customer pre-flight, prod smoke, POPIA pack, signage

---

#### N18 — Customer pre-flight: Lighthouse + accessibility + magic link

- **Owner:** Nikao
- **Branch:** `chore/n-n18-customer-preflight`
- **PRD sections:** §09 P4, `DESIGN.md` (accessibility)
- **Files to create:**
  - `tests/e2e/customer-flow.spec.ts` — magic link request → setup → dashboard → push opt-in → wallet view → packs view
  - `docs/customer-preflight-checklist.md`
- **Claude prompt:**
  > Read `DESIGN.md`, `FAVO_PRD_v3.md` §09 P4. Run Lighthouse against staging for landing (`/`), customer login (`/customer/login`), customer dashboard (`/customer/dashboard`), POS shell behind PIN (`/pos/login`). Target: performance ≥ 90 (mobile), accessibility ≥ 95, PWA installable. Run axe-core against the same routes. Document any axe findings + remediations in the checklist. Build `customer-flow.spec.ts` as Playwright covering magic link request, click-through, setup, dashboard verify, push opt-in (with `context.grantPermissions(['notifications'])`), wallet + packs view. Run as part of G23 pre-flight.
- **Acceptance criteria:**
  - Lighthouse green per targets
  - axe-core: zero serious/critical violations
  - `customer-flow.spec.ts` passes
- **Dependency:** Phase 3 customer tasks, G23

---

#### N19 — Customer prod smoke + real-device push subscription

- **Owner:** Nikao
- **Branch:** `chore/n-n19-customer-prod-smoke`
- **PRD sections:** §09 P4 acceptance, §04 (push delivery within 10 s)
- **Files to create:**
  - `docs/customer-prod-smoke.md`
- **Claude prompt:**
  > Read `FAVO_PRD_v3.md` §09 §04. On launch day post-deploy: from a real Android Chrome device, navigate to `favo.hofmi.org`, request a magic link to a test email, complete setup, grant push permission. Subscribe Mine to push events for Mine's M21 test order. Confirm push arrives within 10 s when M21 runs Done. Take screenshots of each step. Document inline in `docs/customer-prod-smoke.md`.
- **Acceptance criteria:**
  - End-to-end customer flow works on a real device against prod
  - Push received in < 10 s
  - Subscription stored against the right customer id (verify with Gian via SQL)
- **Dependency:** G27, M21 coordination

---

#### N20 — POPIA pack + privacy policy + counter signage

- **Owner:** Nikao
- **Branch:** `chore/n-n20-popia-pack`
- **PRD sections:** Appendix A (POPIA), §06 (customers, audit_log)
- **Files to create:**
  - `docs/popia/privacy-policy.md` — public-facing, linked from landing footer
  - `docs/popia/data-inventory.md` — internal: every customer-PII field, where it lives, retention period, who can access (RLS-mapped)
  - `docs/popia/subject-rights.md` — internal procedure: access request, deletion request, correction request — including the audit-log handling note (audit cannot be deleted but customer can request anonymisation of their PII in audit)
  - `src/app/(customer)/privacy/page.tsx` — renders the privacy policy
  - `src/components/landing/PrivacyLink.tsx` — adds footer link on landing + customer surfaces
- **Claude prompt:**
  > Read `FAVO_PRD_v3.md` Appendix A (POPIA), `DATA_MODEL.md` (RLS, customers table, audit_log invariant). Draft a POPIA-compliant privacy policy in plain English: who FAVO is, what data we collect (email, name, phone, push subscription, purchase history, loyalty + wallet + pack data), why we collect it (loyalty service + push notifications + financial records), retention (orders + audit indefinitely for tax/audit, customer can request anonymisation otherwise), who can access (RBAC table from RLS summary), data subject rights (access, correction, deletion, complaint), contact (`privacy@hofmi.org`). The data inventory is internal and maps each field to its table + retention rationale. Subject-rights procedure documents how an admin handles a request — including how an audit-row PII anonymisation works (insert a follow-up audit row redacting PII; original row is preserved per L12 but PII can be replaced with `[REDACTED:popia-request-{id}]`). Render the policy at `/privacy` and link from landing + customer footers.
- **Acceptance criteria:**
  - Privacy policy live at `favo.hofmi.org/privacy` post-deploy
  - Data inventory covers every PII field
  - Subject-rights procedure compatible with L12 (audit append-only)
  - Reviewed for POPIA compliance by Nkuli before sign-off
- **Dependency:** Phase 3 N12 (customer auth flow)

---

## 6. Phase 4 verification — launch day walkthrough

**Lead:** Gian. **Co-leads by domain:** Mine (POS), Mia (admin), Nikao (customer).

| Time (SAST) | Step | Owner | Pass criterion |
|---|---|---|---|
| 06:00 | Branch `main` is at the release-candidate commit · tag `v1.0.0-rc1` | Gian | git tag pushed |
| 06:15 | `bash scripts/preflight.sh` against staging | Gian | exit 0 + `preflight.json` shows all green |
| 06:45 | Security scans green (Semgrep + Grype + bun audit) | Gian | zero critical findings |
| 07:00 | iPad PWA install + 30-min offline drill | Mine | drill checklist signed |
| 07:30 | Admin flow spec (pre-flight) | Mia | spec green |
| 08:00 | Customer flow spec + Lighthouse + axe | Nikao | thresholds met |
| 08:30 | Pre-flight summary posted to `#favo-ops` | Gian | green-light go/no-go |
| 09:00 | Re-tag as `v1.0.0`; production env checklist confirmed | Gian | checklist signed |
| 09:30 | Coolify webhook triggered | Gian | build succeeds in < 5 min |
| 10:00 | `favo.hofmi.org` responds 200 · healthz green | Gian | all three sub-checks green |
| 10:15 | Cloudflare Access policies verified · WAF rules active | Gian | curl probes confirm |
| 11:00 | POS prod smoke: PIN login + test order + push | Mine | screenshots saved |
| 11:30 | Admin prod smoke: SSO login + COGS dashboard + 1 CSV + 1 PDF | Mia | export files saved |
| 12:00 | Customer prod smoke: magic link + setup + push subscription | Nikao | end-to-end on real device |
| 12:30 | Audit coverage query on prod returns 0 | Gian | SQL evidence saved |
| 13:00 | Hand-off begins: Mia walks Nkuli through ops runbook | Mia | sign-off captured |
| 13:30 | Mine walks barista (Louis) through quick-start + signage placement | Mine | sign-off captured |
| 14:00 | Nikao walks customer-side: privacy + opt-in copy review with Nkuli | Nikao | sign-off captured |
| 14:30 | First real customer order at the counter (not a test) | All | order completes; push received |
| 15:00 | Owner (Matt) + Admin (Nkuli) sign the WI | Gian | Helm WI → `shipped` |
| 15:15 | Discord ship ping fires: SHA + smoke + audit + URL | Gian | post visible in `#favo-ops` |
| 15:30–17:00 | Standby; monitor Grafana + Loki | Gian + on-call | no P0 alerts |

If any pre-flight gate fails: fix forward if < 1h work; else slip launch by one day and ship Phase 1 only the following morning (PRD R1 mitigation).

---

## 7. Quality bars (final, cumulative — per PRD §11)

| Gate | Target | Verified |
|---|---|---|
| Unit tests (Vitest) | ≥ 50 cumulative across phases | `bun test:unit` |
| E2E tests (Playwright) | ≥ 20 cumulative | `bun test:e2e:ci` full suite |
| Audit coverage query | returns 0 | SQL on prod |
| Push delivery latency | < 10 s p95 | Grafana panel `favo-ops` |
| Order-to-cup p50 (weekday) | ≤ 5 min | Grafana panel `favo-ops` |
| Order-to-cup p95 (Sunday peak) | ≤ 10 min | Grafana panel `favo-ops` |
| Lighthouse mobile | ≥ 90 performance, ≥ 95 a11y | `npx lighthouse` |
| Semgrep + Grype + bun audit | zero critical | CI workflow |
| Audit append-only | trigger denies UPDATE/DELETE | `tests/db/audit.test.ts` |
| Tenant isolation | RLS enforced | `tests/db/rls.test.ts` |

---

## 8. Risks on launch day

From PRD §10 — Phase 4 specifically:

- **R1 (deadline slip)** — Pre-flight gates are the explicit slip detector. If any fails by 09:00, slip by 24h.
- **R2 (Yoco outage)** — Real launch is Wednesday lunch, not Sunday peak; lower exposure. Deferred-payment mode from Phase 3 M19 is the fallback.
- **R7 (PIN compromise)** — Document quarterly rotation in A21.
- **R8 (Yoco webhook replay)** — Verified by re-sending a webhook against prod (read-only test using a known-replayed event id).

---

## 9. Post-launch (out of Phase 4 scope but on the radar)

Per PRD §09:

- **Week 1 daily check-ins** between Gian and Nkuli — calibrate recipe yields, recost lots (R10), tune low-stock thresholds (T04).
- **v1.1 roadmap:** shift scheduling, quality ratings, barista performance dashboard.
- **First quarterly DR drill:** restore from R2 snapshot to a scratch Coolify environment; verify data integrity.

---

## 10. Ship ping format

Posted by `scripts/ship-ping.ts` (G27) to Discord `#favo-ops`:

> **FAVO Café v1.0.0 — SHIPPED**
> Deploy SHA: `<short-sha>`
> URL: https://favo.hofmi.org
> Pre-flight: ✅ (link to preflight.json)
> Prod smoke: ✅ (POS, admin, customer)
> Audit coverage: 0
> Push test: <10 s (real device)
> Signed by: Matt (Owner), Nkuli (Admin)
> Helm WI: `HOFMI-FAVO-1` → `shipped`

---

*End of FAVO Café Phase 4 Build Plan.*
