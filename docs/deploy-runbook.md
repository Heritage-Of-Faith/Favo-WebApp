# Deploy Runbook

**Spec of record:** `docs/FAVO_PRD_v7.md` §9. **The ordered path to go-live is `docs/GO_LIVE_RUNBOOK.md`.** Use that page for the order of steps, the owners and the environment variable names. This page is the routine deploy and rollback once the path is done.

> This page replaces an older Coolify and Hetzner-era runbook (a wrong domain, Supabase PITR, Grafana and Sentinel). It is superseded. Nothing from it applies.

Nothing here has been run against a live system. Where the repo does not say, it is marked **to confirm with Nikao** or **to confirm with Matt**.

---

## 1. Where FAVO runs

- An always-on VM on Transformate infrastructure. The Next.js server runs all the time (PRD §9.1, §9.2).
- Postgres on the same host, on a **direct** connection. No pooler.
- Secrets in Infisical. Never committed.
- Public URL: `https://favo.hofmi.net`, through Cloudflare for SaaS custom hostnames (PRD §9.3).
- Timezone `Africa/Johannesburg`. The Dockerfile sets it.
- One instance only.

---

## 2. Get the image

CI builds the image on every push to `main` and pushes it to GHCR (`.github/workflows/docker-publish.yml`):

- `ghcr.io/heritage-of-faith/favo-webapp:<commit sha>`
- `ghcr.io/heritage-of-faith/favo-webapp:latest`

CI does **not** deploy it. Pull the **sha tag**, not `latest`, so a rollback is exact. How the VM pulls and restarts the container, and whether that is automatic (PRD §9.7 says merge to `main` deploys automatically): **to confirm with Nikao and Matt**.

Before you deploy, check:

1. CI is green on `main`.
2. The security scan is clean (`.github/workflows/security.yml`).
3. `docs/production-env-checklist.md` is complete. Check it against `docs/GO_LIVE_RUNBOOK.md` section 4.

If any is not true, stop.

---

## 3. Migrations

**The container runs the migrator for you.** `docker-entrypoint.sh` runs `bun /app/migrate.js`. Only if it exits 0 does it start `bun /app/server.js`. A failed migration means the server never starts.

To migrate ahead of the swap (optional, needs the same environment variables):

```
docker run --rm <image> bun migrate.js
```

The entrypoint's own run then finds nothing pending.

All pending files apply in one transaction. A failure rolls back and leaves the database as it was.

### The approval rule

From the header of `scripts/migrate.ts`:

> Risky migrations need an opt-in (owner decision, Nikao, 21 Oct 2026): a pending file marked `-- favo:requires-approval` (or, from GATED_FROM_IDX on, matching a risky pattern) is refused unless FAVO_APPROVE_MIGRATION names its exact tag. Refusal happens before any SQL — nothing is partly applied.

How to use it:

1. List the marked files: `grep -l 'favo:requires-approval' drizzle/*.sql`. Do this on the release day. New ones may have landed.
2. **Take a full backup and verify it restores first.** See `docs/backup-restore.md` section 5.
3. Set `FAVO_APPROVE_MIGRATION` to the exact tag or tags, comma-separated, for example `0043_at201_tender_payments`. One approval does not cover a later risky migration.
4. Deploy.
5. **Remove** the variable after it applies.

On a new empty database, all marked migrations are pending in one run. List all their tags.

**Emergency only:** `SKIP_MIGRATIONS=<the image's own commit sha>` skips the migrator. Any other value is ignored with a warning. Use it only against a database repaired by hand.

Approving a migration is a Nikao decision. It is not done by Claude.

---

## 4. Check the deploy

1. Watch the container log. You want `[migrate] done`, then the server starting. Any `[migrate] FATAL` line means the server did not start. Read it.
2. `GET https://favo.hofmi.net/api/healthz` returns 200 and `{"ok":true,...}`. It is cached for 5 seconds. Yoco is shown but advisory. Leave `LOKI_URL` unset.
3. Load a page that reads the database.
4. After the first boot, confirm `[scheduler] started: checkLowStock` appears in the log.
5. Open the queue on a tablet and check that it updates.

Who polls `/api/healthz` from Transformate's monitoring (PRD §9.8): **to confirm with Matt**.

---

## 5. The scheduler

The scheduler runs inside the app. `src/instrumentation.ts` starts it with the server. Unset `SCHEDULER_ENABLED` means on in production. It runs on SAST whatever the container clock says. One instance only. A restart inside a job's window means that run does not happen, except jobs that catch up on startup (PRD §9.6.2).

PRD §9.6.2 lists seven jobs. `docs/GO_LIVE_RUNBOOK.md` section 5 shows which are wired today. No job may start a payment or create revenue.

---

## 6. Roll back

### The image

1. Start the **previous image by its sha tag**.
2. If the database is ahead of that image, the migrator allows it with a warning and applies nothing. The older code must tolerate the newer schema.
3. Check health as in section 4.
4. Tell the team in the café group channel. **Which channel: to confirm with Mia.**

Do not roll back by editing `main` while an image still works. Use the previous sha tag first.

### A migration

Each migration from `0033` to `0050` has a hand-run down file in `drizzle/down/`. `0040` has none and is absent from the journal (to confirm with Nikao that this is intended). Migrations before `0033` have no down file.

To use one:

1. Stop the app so nothing writes.
2. Take and verify a backup.
3. Run the down file by hand, **in a transaction**, against a database that is at that migration. Each file says this in its header.
4. Start the previous image.

Down files for migrations that drop data cannot bring the data back. For that, restore from backup (`docs/backup-restore.md`). Example: `0049_at174_drop_refunds.down.sql` recreates the dropped tables empty.

### Database lost or corrupt

Go to `docs/backup-restore.md`. Targets are RPO 5 minutes or less and RTO 4 hours or less. The RTO has no contractually responsible party until OPEN-08 is answered.

---

## 7. Before the first real deploy

These are in `docs/GO_LIVE_RUNBOOK.md`, in this order: OPEN-08, VM and Postgres, secrets in Infisical, backups and restore drill, `favo.hofmi.net`, the first image and migration, the PR #262 connection change, the scheduler, the 4-hour queue test through the edge, and the rest. Sunday card sales stay on the Yoco machine until that path is complete.

---

## 8. Contacts

Names and channels for Transformate (Matt), the Cloudflare hostname, Yoco support and the deploy lead: **to confirm with Nikao**. This page does not invent them.
