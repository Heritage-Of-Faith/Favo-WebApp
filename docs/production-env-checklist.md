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
| Healthz | `curl https://favo.hofmi.net/api/healthz` | `{"ok":true,...}` | |
| Cloudflare Access | `curl -I https://favo.hofmi.net/admin` | `302` to Cloudflare Access | |

---

## Environment variables

All variables are stored in **Infisical** (`hofmi/favo`, environment: `production`).
Coolify resolves them at container start. Do not store values in this file.

| Variable | Source | Owner | Required | Rotation cadence | Notes |
|---|---|---|---|---|---|
| `DATABASE_URL` | The Postgres co-located on the Transformate host (PRD §9.2) — a **direct** connection, no pooler | Nikao | ✅ | On team member departure | One URL for queries, the SSE LISTEN brokers and the release migrator (AT-168). Prepared statements are on, so a PgBouncer transaction pooler breaks every query. Unset → the container exits before starting and `/api/healthz` reports `sse_config` failing (AT-170). `sse_config` only checks the variable is set, not that LISTEN connected. |
| `DATABASE_URL_SESSION` | — | — | ❌ retired | — | Collapsed into `DATABASE_URL` by AT-168. **Must be deleted from Infisical**: if it is still set the container refuses to start, so a stale pooler config cannot linger. |
| `SKIP_MIGRATIONS` | The image's commit SHA | — | ❌ emergency only | — | Skips the release migration step for an emergency boot against a hand-repaired DB. **One-shot:** it only takes effect when it equals the running image's SHA (`IMAGE_SHA`); any other value, including `1`, is ignored with a warning, so a leftover value expires on the next deploy. Not needed for a rollback (AT-170). |
| `FAVO_APPROVE_MIGRATION` | Exact migration tag(s), comma-separated, e.g. `0034_drop_legacy_note` | Nikao | ❌ per deploy only | — | Approves a **risky** migration (marked `-- favo:requires-approval`) for this deploy. Without it the container refuses to start while that migration is pending. Only exact tags count, so one approval cannot cover a later risky migration. Set it only after a verified backup; remove it once applied. See "Risky migrations" below (AT-170, owner decision 21 Oct 2026). |
| `AUTH_SECRET` | `openssl rand -hex 32` | Gian | ✅ | Annually | Auth.js signing secret — rotate requires re-login for all staff |
| `AUTH_URL` | Manual | Gian | ✅ | On domain change | Must be `https://favo.hofmi.net` (no trailing slash) |
| `YOCO_SECRET_KEY` | Yoco dashboard → Developers → API Keys | Gian | ✅ | On Yoco key compromise | Server-side only. NEVER commit or log. |
| `YOCO_WEBHOOK_SECRET` | Yoco dashboard → Developers → Webhooks | Gian | ✅ | On compromise | Used to verify HMAC signatures on incoming webhooks. |
| `NEXT_PUBLIC_YOCO_PUBLIC_KEY` | Yoco dashboard → Developers → API Keys | Gian | ✅ | On Yoco key compromise | Embedded in browser bundle — safe to expose. |
| `VAPID_PUBLIC_KEY` | `web-push generate-vapid-keys` | Gian | ✅ | On compromise (requires re-subscription from all devices) | |
| `VAPID_PRIVATE_KEY` | Same keygen | Gian | ✅ | Same as public | Server-side only. |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | Same as `VAPID_PUBLIC_KEY` | Gian | ✅ | Same | Embedded in browser SW — must match server-side key. |
| `SCHEDULER_ENABLED` | `true` / `false` | — | optional | — | Overrides the in-app job scheduler (AT-169). Unset → on when `NODE_ENV=production`, off otherwise. Set `false` on any instance that must not run jobs. |
| `LOKI_URL` | Coolify internal network | Gian | ⚠️ optional | On Loki migration | `http://loki.hofmi-internal:3100` — healthz skips Loki check if absent. |
| `TZ` | Hardcoded | — | ✅ | Never | Must be `Africa/Johannesburg` for all wall-clock logic. |
| `PUBLIC_BASE_URL` | Manual | Gian | ✅ | On domain change | `https://favo.hofmi.net` — used by preflight.sh and E2E. |
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
curl -sI https://favo.hofmi.net/admin | grep -E "HTTP|location"
# Expected: HTTP/2 302 + location: https://hofmi.cloudflareaccess.com/cdn-cgi/access/login/...

# 2. Confirm landing page is public (200)
curl -sI https://favo.hofmi.net/ | grep "HTTP"
# Expected: HTTP/2 200

# 3. Confirm POS is public (200)
curl -sI https://favo.hofmi.net/pos | grep "HTTP"
# Expected: HTTP/2 200 or 307 (redirect to /pos)

# 4. Confirm WAF rate limit on auth endpoint (manual burst test — 15 req in 30s)
for i in $(seq 1 15); do
  STATUS=$(curl -so /dev/null -w "%{http_code}" -X POST https://favo.hofmi.net/api/auth/callback/credentials)
  echo "Request $i: $STATUS"
done
# Expected: requests 11-15 should return 429
```

---

## Database

```bash
# Migrations run automatically on every container start (docker-entrypoint.sh → migrate.js, AT-170).
# Check the container log for "[migrate] ... 0 pending" / "[migrate] done". To run it by hand:
#   docker run --rm --env-file <env> <image> bun migrate.js

# Verify seed data
psql $DATABASE_URL -c "SELECT COUNT(*) FROM staff WHERE active = true;"
# Expected: ≥ 2 (Sam Barista + Mia Manager)
```

### Risky migrations — explicit opt-in (owner decision, Nikao, 21 Oct 2026)

Ordinary migrations auto-apply on start. A migration is **risky** if it is destructive (any `DROP` except `DROP DEFAULT` / `DROP NOT NULL`, a column type change, `DELETE` / `TRUNCATE` / `UPDATE … SET`) or touches `payments`, `orders` or `order_items` (CLAUDE.md §2.2).

- **Author:** put `-- favo:requires-approval <one-line reason>` in the migration's leading comment block. CI (`bun scripts/check-migration-approval.ts`, also a `verify-v7` gate) fails any risky migration from 0034 on that lacks it. 0000–0033 predate the rule.
- **Deploy:** the container refuses to start while a marked migration is pending. Nothing is applied, and the log names each tag. Then:
  1. Take a full backup **and verify it restores** (PRD §13.3 step 1).
  2. Set `FAVO_APPROVE_MIGRATION=<tag>` in Infisical, naming exactly the refused tag(s).
  3. Restart. The log shows `applying risky migration <tag>, approved via FAVO_APPROVE_MIGRATION`.
  4. Remove `FAVO_APPROVE_MIGRATION`. Left set, it does nothing once applied (it names a tag no longer pending) and the log warns.

---

## Launch day runbook

1. **09:00 SAST** — Gian runs `bash scripts/preflight.sh` against staging. All gates green.
2. **09:15** — Merge last stacked PRs to `main` in order (#90 → #91 → #92 → #93 → #94 → #95 → #96 + AT-82 + AT-83).
3. **09:20** — Coolify auto-deploys from `main`. Monitor deploy log in Coolify dashboard.
4. **09:25** — Verify `https://favo.hofmi.net/api/healthz` → `{"ok":true}`.
5. **09:30** — Run this checklist's pre-deploy gate manually against production.
6. **09:35** — Record "FAVO is live" on the work-item record
7. Stay on-call for 4 hours post-launch.

---

## Rollback

```bash
# In Coolify: navigate to favo-webapp → Deployments → select previous → Redeploy
# Or force a git revert:
git revert HEAD --no-edit
git push origin main  # triggers Coolify auto-deploy
```
