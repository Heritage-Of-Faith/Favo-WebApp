# Backup and Restore

**Spec of record:** `docs/FAVO_PRD_v7.md` §9.4 (DEC-05). The ordered go-live path is in `docs/GO_LIVE_RUNBOOK.md` (steps 4 and 5).

> This page replaces an older version that described Supabase point-in-time recovery, an RPO of 24 hours and an RTO of 2 hours. Those numbers and that host are superseded. Do not use them.

Nothing here has been run against a live system. FAVO's database is on Transformate infrastructure, and the backup tooling is not built yet. Anything the repo and the PRD do not state is marked **to confirm with Nikao** or **to confirm with Matt**.

---

## 1. Targets

| Target | Value | Source |
|---|---|---|
| **RPO** (most data we may lose) | **5 minutes or less** | PRD §9.4 |
| **RTO** (time to the café transacting again) | **4 hours or less** | PRD §9.4 |

The RTO is measured from the decision to restore until the café can take orders again. The café runs on paper in the meantime.

**The four-hour promise has no contractually responsible party until OPEN-08 is answered** (PRD §9.4, §16.2). The fourth OPEN-08 question is the gate: who is on the hook if the server dies at 08:00 on a Sunday. Do not treat the RTO as a commitment until that is answered in writing.

Nightly-only backups were rejected. They would put a whole Sunday's takings inside the loss window.

---

## 2. What is backed up

| What | How | How often | Kept for | Where |
|---|---|---|---|---|
| The Postgres database, as a stream | **Continuous WAL archiving**, to encrypted off-site storage (PRD §9.4) | Continuous | To confirm with Nikao and Matt | Destination: **to confirm with Matt** |
| The Postgres database, as a base | **Nightly full base backup** (PRD §9.4) | Nightly | At least 5 years, because financial records are kept for 5 years or more (PRD §9.4) | **To confirm with Matt** |
| Code and migrations | Git and GitHub | Every commit | Forever | `Heritage-Of-Faith/Favo-WebApp` |
| The app image | GHCR, tagged by commit sha | Every push to `main` | **To confirm with Nikao** | `ghcr.io/heritage-of-faith/favo-webapp` |
| Secrets | Infisical | n/a | n/a | Infisical. Not part of a database restore. |

Residency is EU (PRD §9.4).

**To confirm with Nikao and Matt:**

- Which backup tool is used (the repo does not name one).
- The WAL archive destination, and who holds its credentials.
- Who holds the encryption key, and where a copy is kept.
- Who gets the alert when archiving stops or a rehearsal fails.

Backups are sized for retention, not for data volume. The database stays small (PRD §9.9).

---

## 3. Restore to a point in time

The commands depend on the tool Matt sets up (go-live step 4). The steps below are the shape of it. Fill in the commands once the tool is chosen.

1. **Decide to restore.** Write down the time of the decision. The RTO clock starts here. Tell the baristas to run on paper.
2. **Pick the recovery time.** Use the last moment you know the data was good. Times in the database are UTC. The café works in SAST (UTC+2). Write both down.
3. **Provision a fresh Postgres** on the Transformate host. Do not restore over the damaged one. Keep it for inspection. **To confirm with Matt:** who does this and how fast.
4. **Restore the latest base backup, then replay the WAL archive up to the recovery time.** Commands: **to confirm with Matt**.
5. **Open the restored database and check it.** Row counts look right. The newest `orders` and `payments` rows are near the recovery time.
6. **Point the app at it.** Change `DATABASE_URL` in Infisical to the restored database. It must be a **direct** connection, never a pooler. Leave `DATABASE_URL_SESSION` as `docs/GO_LIVE_RUNBOOK.md` step 8 says for the PR #262 state.
7. **Restart the container.** The entrypoint runs the migrator first. On a restored database it normally finds nothing pending. Read the `[migrate] FATAL` line if it refuses.
8. **Check health.** `GET https://favo.hofmi.net/api/healthz` returns `{"ok":true,...}`. Load a page that reads the database.
9. **Reconcile.** Orders taken on paper, and anything after the recovery time, have to be re-entered or accounted for. Card payments in that window must be checked against Yoco. **Who does this: to confirm with Mia.**
10. **Write down the elapsed time** and what went wrong.

No scheduled job may start a payment or create revenue (PRD §9.6.2). So nothing re-sends a card payment after a restore. A person checks.

---

## 4. The restore drill (before go-live)

A backup that has never been restored is not a backup (PRD §9.4). The drill is go-live step 5. It must pass before the Friday go/no-go. Without a verified restore, Sunday runs on the Yoco machine.

1. Restore the latest backup onto a **fresh** database, away from production.
2. Use the steps in section 3, up to step 5.
3. Time it from start to "database opens and row counts match". **This is the first measurement of RTO.** The target is 4 hours or less.
4. Do it once with a point-in-time target, to prove the WAL replay works, not only the base backup.
5. Write down the date, the elapsed time and who did it. Nikao signs.

**A failed rehearsal is an immediate alert** (PRD §9.6.3), not a line in a report. Who receives it: **to confirm with Nikao**.

**Quarterly.** Redo the drill every quarter (PRD §9.4, §9.8). It is a calendared item with an owner. The owner and the dates are **to confirm with Nikao**. No drill has been run yet.

---

## 5. Backups and risky migrations (`FAVO_APPROVE_MIGRATION`)

A risky migration needs a **verified backup first**.

The rule, from the header of `scripts/migrate.ts`:

> Risky migrations need an opt-in (owner decision, Nikao, 21 Oct 2026): a pending file marked `-- favo:requires-approval` (or, from GATED_FROM_IDX on, matching a risky pattern) is refused unless FAVO_APPROVE_MIGRATION names its exact tag. Refusal happens before any SQL — nothing is partly applied.

The operator message in `src/server/deploy/migration-approval.ts` says: "Take a full backup AND verify it restores."

So, before setting `FAVO_APPROVE_MIGRATION`:

1. Take a full backup of the database.
2. Verify it restores (a drill as in section 4, or the latest passed drill plus a fresh base backup. **To confirm with Nikao** which one counts).
3. Only then set `FAVO_APPROVE_MIGRATION` to the exact tag or tags, for this deploy only. It is a comma-separated list.
4. After the migration applies, **remove** the variable.

On a brand-new empty database the backup holds nothing. "Verified" then means the backup tooling works (`docs/GO_LIVE_RUNBOOK.md` section 3).

A migration that drops data cannot be undone by its down file. The data comes back only from a backup. See `docs/deploy-runbook.md`.

---

## 6. If the server or database is lost

Follow section 3. Paper trading meanwhile. Who fixes it and how fast is what OPEN-08 question 4 must answer. Until it is answered, there is no contractually responsible party.
