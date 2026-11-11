// Release-time checks — AT-170.
//
// Pure functions shared by the container's migration step (scripts/migrate.ts,
// run by docker-entrypoint.sh before the server starts) and /api/healthz, so the
// two can never disagree about what a correctly configured instance looks like.

/**
 * Env vars the server cannot run correctly without. AT-168 collapsed the two
 * database URLs into one direct connection (PRD §9.2): DATABASE_URL now serves
 * queries, the SSE LISTEN brokers and the migrator alike.
 */
export const REQUIRED_DATABASE_ENV = ["DATABASE_URL"] as const;

/**
 * Env vars that no longer mean anything. Still being set is a sign of a stale
 * two-URL (pooler) config, so the release step refuses to start rather than
 * silently ignore it — see AT-170 / AT-168.
 */
export const RETIRED_DATABASE_ENV = ["DATABASE_URL_SESSION"] as const;

/** Names of required database env vars that are unset or blank. */
export function missingDatabaseEnv(env: Record<string, string | undefined>): string[] {
  return REQUIRED_DATABASE_ENV.filter((name) => !env[name]?.trim());
}

/** Names of retired database env vars that are still set. */
export function retiredDatabaseEnv(env: Record<string, string | undefined>): string[] {
  return RETIRED_DATABASE_ENV.filter((name) => env[name]?.trim());
}

export interface JournalEntry {
  tag: string;
  when: number;
}

export interface AppliedMigration {
  created_at: string | number;
}

export interface JournalDrift {
  /** Mismatches that must stop the release. */
  problems: string[];
  /**
   * Applied `created_at`s newer than every journal entry: the database is
   * ahead of this image, which is what a rollback to an older image looks like.
   * Safe — drizzle applies nothing then — so it is reported, not refused.
   */
  ahead: number[];
}

/**
 * Compare drizzle.__drizzle_migrations against drizzle/meta/_journal.json.
 *
 * drizzle's migrator only applies files whose `when` is newer than the newest
 * applied row, matching nothing else. So:
 * - an applied row with a `created_at` no journal entry has, inside the
 *   journal's range (a renumbered or regenerated file, the 0027 incident behind
 *   scripts/repair-drizzle-journal-0027.ts), makes it re-run SQL that is
 *   already in the database;
 * - a journal entry older than the newest applied row but never applied (a
 *   file inserted out of order) is skipped silently, forever.
 * Both are `problems` and stop the release. An unknown row newer than every
 * journal entry is `ahead` instead: refusing it would restart-loop a rollback.
 */
export function findJournalDrift(
  applied: readonly AppliedMigration[],
  journal: readonly JournalEntry[],
): JournalDrift {
  const problems: string[] = [];
  const ahead: number[] = [];
  const journalWhens = new Set(journal.map((e) => e.when));
  const newestJournal = journal.length > 0 ? Math.max(...journalWhens) : -Infinity;
  const appliedWhens = new Set(applied.map((r) => Number(r.created_at)));

  for (const when of [...appliedWhens].sort((a, b) => a - b)) {
    if (journalWhens.has(when)) continue;
    if (when > newestJournal) {
      ahead.push(when);
    } else {
      problems.push(
        `database has an applied migration (created_at ${when}) inside the journal's range that drizzle/meta/_journal.json does not list`,
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

  return { problems, ahead };
}

export type SkipMigrations =
  | { skip: false; warning?: string }
  | { skip: true; warning: string };

/**
 * SKIP_MIGRATIONS is one-shot: it only takes effect when its value is the SHA
 * of the image being started (IMAGE_SHA, baked in at build time). Left set in
 * Infisical, it expires by itself on the next deploy — the new image's SHA no
 * longer matches, so migrations run again and a warning says to remove it.
 * A bare "1" (or any non-matching value) never skips.
 */
export function skipMigrationsDecision(env: Record<string, string | undefined>): SkipMigrations {
  const requested = env.SKIP_MIGRATIONS?.trim();
  if (!requested) return { skip: false };
  const image = env.IMAGE_SHA?.trim();
  if (image && requested === image) {
    return {
      skip: true,
      warning: `SKIP_MIGRATIONS matches this image (${image}) — migrations NOT run. Schema may be behind this image. Remove it from Infisical once the database is repaired.`,
    };
  }
  return {
    skip: false,
    warning: `SKIP_MIGRATIONS=${requested} ignored: it must equal this image's SHA (${image || "unknown"}). Migrations run as normal. Remove the stale value from Infisical.`,
  };
}
