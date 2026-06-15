# Deploy Runbook — AT-85 (G27)

**Owner:** Gian | **Phase:** HOFMI-FAVO-P4  
**PRD references:** §09 P4 (go-live criteria), §11 (prod smoke — read-only only)

This is the exact step-by-step procedure for deploying FAVO to production.
Gian owns the 09:00–17:00 launch window. Do not deviate from this order.

---

## Pre-conditions (must all be ✅ before starting)

| # | Check | Command | Expected |
|---|---|---|---|
| 1 | CI green on `main` | GitHub Actions → All checks | ✅ |
| 2 | Security scan clean | `.github/workflows/security.yml` | 0 critical findings |
| 3 | Pre-flight gate | `bash scripts/preflight.sh` | `"overall":"pass"` in preflight.json |
| 4 | Prod env checklist | `docs/production-env-checklist.md` | All rows signed |
| 5 | Staging healthz | `curl https://staging.favo.hofmi.org/api/healthz` | `{"ok":true}` |
| 6 | Staging smoke | `bun test:e2e:ci tests/e2e/prod-smoke.spec.ts` | All pass |

If any pre-condition is ❌, **stop**. Do not proceed until it is resolved.

---

## Deploy steps

### Step 1 — Tag the release commit

```bash
# From a clean checkout of main
git checkout main && git pull origin main

# Verify you are on the correct SHA
git log --oneline -3

# Tag the release
git tag -a v1.0.0 -m "FAVO v1.0.0 — Phase 4 production release"
git push origin v1.0.0
```

**Rollback:** `git tag -d v1.0.0 && git push origin :refs/tags/v1.0.0`

---

### Step 2 — Verify Coolify has the latest `main`

1. Navigate to Coolify → Projects → **hofmi-favo** → **favo-webapp**
2. Confirm branch is set to `main` and the webhook is active
3. If Coolify didn't auto-deploy after the `main` push, click **Redeploy**

**Rollback:** Select the previous deployment SHA under **Deployments** → **Redeploy**

---

### Step 3 — Watch the deploy log

```bash
# Stream Loki logs during deploy (requires lokitail or Grafana Explore)
# In Grafana Explore:
{service="favo-webapp"} | logfmt | line_format "{{.level}} {{.msg}}"

# Alternatively, tail Coolify's build log in the web UI
```

Watch for:
- `✓ Starting server on :3000` — app started
- `Drizzle: No pending migrations` — DB is up to date
- Any `ERROR` or `FATAL` lines — investigate immediately

**Rollback condition:** Any unhandled FATAL within 2 minutes of start → rollback to previous deployment.

---

### Step 4 — Post-deploy smoke

```bash
# Against production — read-only paths only (PRD §11)
PUBLIC_BASE_URL=https://favo.hofmi.org bun test:e2e:ci tests/e2e/prod-smoke.spec.ts
```

All tests must pass. If any fail, investigate before proceeding.

**Rollback condition:** Any smoke test failure → rollback to previous deployment.

---

### Step 5 — Audit coverage check

```bash
# Verify no orders lack an audit row (should always be 0 on a fresh deploy)
curl -s "https://favo.hofmi.org/api/admin/audit-coverage?secret=${TEST_AUDIT_SECRET}" \
  | python3 -c "import json,sys; d=json.load(sys.stdin); print('GAP:', d['gapCount']); sys.exit(0 if d['gapCount']==0 else 1)"
```

Expected: `GAP: 0`. If non-zero, **stop and investigate** — this is a P0.

---

### Step 6 — Fire the ship ping

```bash
DISCORD_WEBHOOK_URL=<webhook> bun run scripts/ship-ping.ts \
  --sha "$(git rev-parse --short HEAD)" \
  --smoke pass \
  --audit 0 \
  --dashboard "https://grafana.hofmi.org/d/favo-ops-v1"
```

Confirm the embed appears in `#favo-ops` with:
- Deploy SHA ✅
- Smoke: pass ✅
- Audit coverage: 0 ✅
- Grafana link ✅

---

### Step 7 — Standby

Remain on `#favo-ops` for 60 minutes post-launch. Watch:
- Grafana ops dashboard (order throughput, push latency)
- Sentinel alerts (any critical firing = rollback immediately)
- Customer and barista reports via the café WhatsApp group

---

## Rollback procedure (any step)

```bash
# Option A: Coolify UI (fastest)
# Coolify → favo-webapp → Deployments → <previous SHA> → Redeploy

# Option B: Git revert (if code change needed)
git revert HEAD --no-edit
git push origin main
# Coolify auto-deploys; verify healthz within 2 minutes
```

Announce rollback immediately in `#favo-ops`:
```
⚠️ FAVO deploy rolled back — <reason>. Investigating. ETA for re-deploy: <time>.
```

---

## Contacts

| Role | Person | Channel |
|---|---|---|
| Deploy lead | Gian | `#favo-ops` direct |
| Supabase support | — | https://supabase.com/dashboard/support |
| Yoco support | — | https://www.yoco.com/za/support/ |
| Cloudflare | — | https://dash.cloudflare.com/support |
