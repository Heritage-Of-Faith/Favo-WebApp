# Backup & Disaster Recovery Runbook — AT-85 (G27)

**Owner:** Gian | **PRD references:** §10 (R2 — data loss tolerance: 24h max)

---

## Backup strategy

| Layer | Method | Cadence | Retention | Location |
|---|---|---|---|---|
| PostgreSQL | Supabase PITR (point-in-time recovery) | Continuous WAL archiving | 7 days PITR + 30-day daily snapshots | Supabase-managed S3 (eu-west-1) |
| Application files | Cloudflare R2 (`hofmi-favo`) | None — app is stateless | N/A | — |
| Schema / migrations | Git + GitHub | Every commit | Forever | `Heritage-Of-Faith/Favo-WebApp` |
| Secrets | Infisical | Versioned | Forever | Infisical project `hofmi/favo` |

**Recovery point objective (RPO):** 24 hours maximum data loss (PRD §10 R2). Supabase PITR
exceeds this (continuous WAL archiving achieves near-zero RPO for recent writes).

**Recovery time objective (RTO):** 2 hours to full operational state (new DB instance
provisioned + app redeployed + smoke passing).

---

## Supabase point-in-time recovery

### When to use
- Accidental mass-delete or data corruption
- Bug that wrote incorrect data to many rows
- Ransom/compromise scenario (if DB credentials are rotated first)

### Steps

1. **Notify the team** — post in `#favo-ops`: "DB restore in progress — service is degraded"

2. **Determine the recovery timestamp** (SAST = UTC+2):
   ```bash
   # Find the last known-good transaction before the incident
   # Check audit_log for the last clean row:
   psql $DATABASE_URL -c "SELECT MAX(at) FROM audit_log WHERE at < '<incident-time>'::timestamptz"
   ```

3. **Initiate PITR in Supabase dashboard:**
   - Navigate to: Dashboard → Project → Database → Backups → Point in Time Recovery
   - Enter the target timestamp (UTC)
   - Confirm restore — this creates a **new** Supabase project; the original is preserved

4. **Update Infisical / Coolify** with the new project's `DATABASE_URL` and `DATABASE_URL_SESSION`

5. **Redeploy** via Coolify → force a fresh container start (picks up new env vars)

6. **Verify:**
   ```bash
   curl -s https://favo.hofmi.org/api/healthz | python3 -c "import json,sys; d=json.load(sys.stdin); print('Postgres:', 'OK' if d['checks']['postgres']['ok'] else 'FAIL')"
   ```

7. **Run smoke + audit coverage check** (see deploy-runbook.md steps 4–5)

8. **Post resolution notice** in `#favo-ops` with root cause and actions taken

---

## Warden R2 snapshot restoration

Warden takes nightly snapshots of `hofmi-favo` R2 bucket to a secondary location.

```bash
# List available snapshots
warden snapshots list --project hofmi-favo

# Restore a specific snapshot
warden snapshots restore --project hofmi-favo --date 2026-06-12 --target hofmi-favo
```

---

## Full DR drill template (run quarterly)

Run this drill on the second Tuesday of each quarter during off-peak hours (07:00 SAST,
before café opens at 09:00).

**Prerequisites:**
- Create a temporary `favo-dr-drill` Supabase project (separate from production)
- Set `DRILL_DATABASE_URL` pointing to the drill project

```bash
# 1. Export current schema + seed data from production
pg_dump $DATABASE_URL --schema-only > /tmp/favo-schema.sql
bun db:seed  # verify seed script runs cleanly

# 2. Restore to drill project
psql $DRILL_DATABASE_URL < /tmp/favo-schema.sql
DATABASE_URL=$DRILL_DATABASE_URL bun db:seed

# 3. Start the app against the drill DB
DATABASE_URL=$DRILL_DATABASE_URL DATABASE_URL_SESSION=$DRILL_DATABASE_URL bun dev

# 4. Run full smoke suite
PUBLIC_BASE_URL=http://localhost:3000 bun test:e2e:ci tests/e2e/prod-smoke.spec.ts

# 5. Time the recovery
# Record: drill start time → smoke passing time → total RTO
echo "DR drill RTO: <X> minutes"

# 6. Clean up
# Delete the drill Supabase project from the dashboard
```

**Acceptance criteria:**
- Smoke suite passes against drill DB within 30 minutes of starting the drill
- All pre-deploy checklist items are verified against drill environment
- Document results in Confluence under "FAVO DR Drill Log"

**Schedule:** Second Tuesday of March, June, September, December.

---

## Incident severity matrix

| Severity | Condition | Response | SLA |
|---|---|---|---|
| P0 | Audit coverage gap > 0 OR orders being lost | Halt new orders, rollback immediately | Resolve in < 30 min |
| P1 | Service down (healthz 503) OR payments failing | Rollback or hotfix, all hands | Resolve in < 1 hour |
| P2 | Push latency > 10s OR deferred payments > 5 | Investigate next business hour | Resolve in < 4 hours |
| P3 | Dashboard stale OR minor UI bug | Scheduled fix | Next working day |
