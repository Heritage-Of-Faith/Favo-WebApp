# Production Environment Checklist — AT-83 (G25)

**Go/no-go sign-off:** Gian signs this document at 09:00 on launch day after
verifying every ✅ row. Any ❌ blocks the deploy.

Last updated: 2026-06-13 | Branch: `feat/g-g25-prod-env`

---

## Pre-deploy gate

| Gate | Command / Check | Expected | Status |
|---|---|---|---|
| CI green | All GitHub Actions checks on `main` | All green | |
| Security scan | `.github/workflows/security.yml` | 0 critical findings | |
| Pre-flight | `bash scripts/preflight.sh` | `overall: pass` in preflight.json | |
| Healthz | `curl https://favo.hofmi.org/api/healthz` | `{"ok":true,...}` | |
| Cloudflare Access | `curl -I https://favo.hofmi.org/admin` | `302` to Cloudflare Access | |

---

## Environment variables

All variables are stored in **Infisical** (`hofmi/favo`, environment: `production`).
Coolify resolves them at container start. Do not store values in this file.

| Variable | Source | Owner | Required | Rotation cadence | Notes |
|---|---|---|---|---|---|
| `DATABASE_URL` | Supabase dashboard → Project settings → Database → Connection string (Transaction pooler port 6543) | Gian | ✅ | On team member departure | `postgres://...@aws-0-eu-west-1.pooler.supabase.com:6543/postgres?sslmode=require&pgbouncer=true` |
| `DATABASE_URL_SESSION` | Supabase dashboard → Session pooler port 5432 | Gian | ✅ | On team member departure | Used by SSE queue (LISTEN/NOTIFY requires non-pooled connection) |
| `AUTH_SECRET` | `openssl rand -hex 32` | Gian | ✅ | Annually | Auth.js signing secret — rotate requires re-login for all staff |
| `AUTH_URL` | Manual | Gian | ✅ | On domain change | Must be `https://favo.hofmi.org` (no trailing slash) |
| `YOCO_SECRET_KEY` | Yoco dashboard → Developers → API Keys | Gian | ✅ | On Yoco key compromise | Server-side only. NEVER commit or log. |
| `YOCO_WEBHOOK_SECRET` | Yoco dashboard → Developers → Webhooks | Gian | ✅ | On compromise | Used to verify HMAC signatures on incoming webhooks. |
| `NEXT_PUBLIC_YOCO_PUBLIC_KEY` | Yoco dashboard → Developers → API Keys | Gian | ✅ | On Yoco key compromise | Embedded in browser bundle — safe to expose. |
| `VAPID_PUBLIC_KEY` | `web-push generate-vapid-keys` | Gian | ✅ | On compromise (requires re-subscription from all devices) | |
| `VAPID_PRIVATE_KEY` | Same keygen | Gian | ✅ | Same as public | Server-side only. |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | Same as `VAPID_PUBLIC_KEY` | Gian | ✅ | Same | Embedded in browser SW — must match server-side key. |
| `CRON_SECRET` | `openssl rand -hex 32` | Gian | ✅ | Annually | Bearer token for `GET /api/crons/retry-deferred` and similar. |
| `LOKI_URL` | Coolify internal network | Gian | ⚠️ optional | On Loki migration | `http://loki.hofmi-internal:3100` — healthz skips Loki check if absent. |
| `TZ` | Hardcoded | — | ✅ | Never | Must be `Africa/Johannesburg` for all wall-clock logic. |
| `PUBLIC_BASE_URL` | Manual | Gian | ✅ | On domain change | `https://favo.hofmi.org` — used by preflight.sh and E2E. |
| `TEST_AUDIT_SECRET` | `openssl rand -hex 16` | Gian | ⚠️ staging only | Per staging cycle | Only set on staging. Must NOT be set in production. |

---

## Infisical setup

1. Log into [Infisical](https://app.infisical.com) → `hofmi` → `favo` project
2. Select environment: **production**
3. Verify all ✅ rows from the table above are present and non-empty
4. Confirm Coolify has the Infisical service token configured under  
   **Project → hofmi-eu-open → favo-webapp → Secrets → Infisical**

---

## Cloudflare verification

```bash
# 1. Confirm /admin redirects to Cloudflare Access (302)
curl -sI https://favo.hofmi.org/admin | grep -E "HTTP|location"
# Expected: HTTP/2 302 + location: https://hofmi.cloudflareaccess.com/cdn-cgi/access/login/...

# 2. Confirm landing page is public (200)
curl -sI https://favo.hofmi.org/ | grep "HTTP"
# Expected: HTTP/2 200

# 3. Confirm POS is public (200)
curl -sI https://favo.hofmi.org/pos | grep "HTTP"
# Expected: HTTP/2 200 or 307 (redirect to /pos)

# 4. Confirm WAF rate limit on auth endpoint (manual burst test — 15 req in 30s)
for i in $(seq 1 15); do
  STATUS=$(curl -so /dev/null -w "%{http_code}" -X POST https://favo.hofmi.org/api/auth/callback/credentials)
  echo "Request $i: $STATUS"
done
# Expected: requests 11-15 should return 429
```

---

## Database

```bash
# Verify migration is up to date (run from local with DATABASE_URL set)
bun db:migrate  # should print "No migrations to run"

# Verify seed data
psql $DATABASE_URL -c "SELECT COUNT(*) FROM staff WHERE active = true;"
# Expected: ≥ 2 (Sam Barista + Mia Manager)
```

---

## Launch day runbook

1. **09:00 SAST** — Gian runs `bash scripts/preflight.sh` against staging. All gates green.
2. **09:15** — Merge last stacked PRs to `main` in order (#90 → #91 → #92 → #93 → #94 → #95 → #96 + AT-82 + AT-83).
3. **09:20** — Coolify auto-deploys from `main`. Monitor deploy log in Coolify dashboard.
4. **09:25** — Verify `https://favo.hofmi.org/api/healthz` → `{"ok":true}`.
5. **09:30** — Run this checklist's pre-deploy gate manually against production.
6. **09:35** — Discord `#favo-ops`: "FAVO is live 🟢"
7. Stay on-call for 4 hours post-launch.

---

## Rollback

```bash
# In Coolify: navigate to favo-webapp → Deployments → select previous → Redeploy
# Or force a git revert:
git revert HEAD --no-edit
git push origin main  # triggers Coolify auto-deploy
```
