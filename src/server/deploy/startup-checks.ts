// Release-time checks — AT-170.
//
// Pure functions shared by the container's migration step (scripts/migrate.ts,
// run by docker-entrypoint.sh before the server starts) and /api/healthz, so the
// two can never disagree about what a correctly configured instance looks like.

/** Env vars the server cannot run correctly without. */
export const REQUIRED_DATABASE_ENV = ["DATABASE_URL", "DATABASE_URL_SESSION"] as const;

/**
 * Names of required database env vars that are unset or blank.
 *
 * DATABASE_URL_SESSION is here because without it the SSE brokers
 * (src/server/queue/broker.ts) silently fall back to heartbeats: the POS board
 * goes stale while the container still reports healthy.
 */
export function missingDatabaseEnv(env: Record<string, string | undefined>): string[] {
  return REQUIRED_DATABASE_ENV.filter((name) => !env[name]?.trim());
}

export interface JournalEntry {
  tag: string;
  when: number;
}

export interface AppliedMigration {
  created_at: string | number;
}

/**
 * Compare drizzle.__drizzle_migrations against drizzle/meta/_journal.json and
 * return a human-readable problem for every way the two have drifted. Empty
 * means it is safe to run the migrator.
 *
 * drizzle's migrator only applies files whose `when` is newer than the newest
 * applied row, matching nothing else. So:
 * - an applied row with a `created_at` no journal entry has (a renumbered or
 *   regenerated file, the 0027 incident behind
 *   scripts/repair-drizzle-journal-0027.ts) makes it re-run SQL that is
 *   already in the database;
 * - a journal entry older than the newest applied row but never applied (a
 *   file inserted out of order) is skipped silently, forever.
 * Both have to stop the release instead.
 */
export function findJournalDrift(
  applied: readonly AppliedMigration[],
  journal: readonly JournalEntry[],
): string[] {
  const problems: string[] = [];
  const journalWhens = new Set(journal.map((e) => e.when));
  const appliedWhens = new Set(applied.map((r) => Number(r.created_at)));

  for (const when of appliedWhens) {
    if (!journalWhens.has(when)) {
      problems.push(
        `database has an applied migration (created_at ${when}) that drizzle/meta/_journal.json does not list`,
      );
    }
  }

  if (appliedWhens.size > 0) {
    const newestApplied = Math.max(...appliedWhens);
    for (const entry of journal) {
      if (entry.when < newestApplied && !appliedWhens.has(entry.when)) {
        problems.push(
          `${entry.tag} (when ${entry.when}) is older than the newest applied migration and was never applied; drizzle would skip it silently`,
        );
      }
    }
  }

  return problems;
}
