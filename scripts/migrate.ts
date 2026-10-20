// Production migration step — AT-170.
//
// Run by docker-entrypoint.sh before the server starts, so nothing serves
// traffic on an old schema. It can also run one-shot ahead of a container swap:
//   docker run --rm <image> bun migrate.js
// after which the entrypoint's own run finds nothing pending.
//
// In the image this is bundled to /app/migrate.js (Dockerfile builder stage);
// locally and in CI: bun scripts/migrate.ts
//
// Exit 0 = schema is current. Any failure exits 1 with one "[migrate] FATAL"
// line, and the entrypoint does not start the server.
//
// - Env: DATABASE_URL and DATABASE_URL_SESSION must both be set.
// - Never twice at once: a session advisory lock, held on the one connection
//   that runs the migrations. That is why it uses DATABASE_URL_SESSION — an
//   advisory lock is not reliable through the 6543 transaction pooler.
// - Journal drift (the 0027 incident) aborts before any SQL runs.
// - drizzle applies all pending files in one transaction: a failure rolls back
//   and leaves the database as it was.
// - SKIP_MIGRATIONS=1 skips the migrator (emergency boot against a hand-repaired
//   database). The env check still runs.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import {
  findJournalDrift,
  missingDatabaseEnv,
  type AppliedMigration,
  type JournalEntry,
} from "../src/server/deploy/startup-checks";

// Arbitrary, fixed: every FAVO migration runner contends for this one key.
const MIGRATION_LOCK_KEY = 170_170_170;
const LOCK_WAIT_MS = 5 * 60_000;
const LOCK_POLL_MS = 2_000;

const MIGRATIONS_FOLDER = process.env.MIGRATIONS_FOLDER ?? join(process.cwd(), "drizzle");

function fatal(message: string): never {
  console.error(`[migrate] FATAL: ${message}`);
  process.exit(1);
}

const missing = missingDatabaseEnv(process.env);
if (missing.length > 0) {
  fatal(
    `${missing.join(", ")} not set. Refusing to start: without DATABASE_URL_SESSION the live order queue (SSE) degrades to heartbeats while the app looks healthy.`,
  );
}

if (process.env.SKIP_MIGRATIONS === "1") {
  console.warn("[migrate] SKIP_MIGRATIONS=1 — migrations NOT run. Schema may be behind this image.");
  process.exit(0);
}

const journal: JournalEntry[] = JSON.parse(
  readFileSync(join(MIGRATIONS_FOLDER, "meta", "_journal.json"), "utf8"),
).entries;

const sql = postgres(process.env.DATABASE_URL_SESSION!, {
  max: 1, // the lock, the drift check and the migrator all share this one session
  connect_timeout: 10,
  onnotice: () => {}, // "schema already exists, skipping" etc.
});

async function acquireLock() {
  const deadline = Date.now() + LOCK_WAIT_MS;
  for (;;) {
    const [{ locked }] = await sql<{ locked: boolean }[]>`
      SELECT pg_try_advisory_lock(${MIGRATION_LOCK_KEY}) AS locked`;
    if (locked) return;
    if (Date.now() > deadline) {
      fatal(`another migration run held the lock for over ${LOCK_WAIT_MS / 1000}s`);
    }
    console.log("[migrate] another migration run holds the lock; waiting");
    await new Promise((r) => setTimeout(r, LOCK_POLL_MS));
  }
}

async function appliedMigrations(): Promise<AppliedMigration[]> {
  const [{ exists }] = await sql<{ exists: boolean }[]>`
    SELECT to_regclass('drizzle.__drizzle_migrations') IS NOT NULL AS exists`;
  if (!exists) return [];
  return sql<AppliedMigration[]>`SELECT created_at FROM drizzle.__drizzle_migrations`;
}

try {
  await acquireLock();

  const applied = await appliedMigrations();
  const drift = findJournalDrift(applied, journal);
  if (drift.length > 0) {
    fatal(
      `drizzle journal drift, repair it before releasing (see scripts/repair-drizzle-journal-0027.ts):\n  - ${drift.join("\n  - ")}`,
    );
  }

  const pending = journal.length - applied.length;
  console.log(`[migrate] ${applied.length} applied, ${pending} pending`);
  await migrate(drizzle(sql), { migrationsFolder: MIGRATIONS_FOLDER });
  console.log(`[migrate] done — schema at ${journal.at(-1)?.tag ?? "(empty journal)"}`);
} catch (err) {
  fatal(err instanceof Error ? err.message : String(err));
} finally {
  // Ending the session releases the advisory lock.
  await sql.end({ timeout: 5 });
}
