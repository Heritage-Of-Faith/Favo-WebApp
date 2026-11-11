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
// - Env: DATABASE_URL must be set, and the retired DATABASE_URL_SESSION must
//   not be (AT-168: one direct connection, PRD §9.2).
// - Never twice at once: a session advisory lock, held on the one connection
//   that runs the migrations (DATABASE_URL is a direct connection, so the
//   lock holds for the whole session).
// - Journal drift (the 0027 incident) aborts before any SQL runs.
// - Risky migrations need an opt-in (owner decision, Nikao, 21 Oct 2026): a
//   pending file marked `-- favo:requires-approval` (or, from GATED_FROM_IDX on,
//   matching a risky pattern) is refused unless FAVO_APPROVE_MIGRATION names
//   its exact tag. Refusal happens before any SQL — nothing is partly applied.
//   See src/server/deploy/migration-approval.ts.
// - drizzle applies all pending files in one transaction: a failure rolls back
//   and leaves the database as it was.
// - A database ahead of this image (applied migrations newer than every file
//   here, i.e. a rollback to an older image) is allowed with a warning: drizzle
//   applies nothing then.
// - SKIP_MIGRATIONS=<this image's SHA> skips the migrator for an emergency boot
//   against a hand-repaired database. One-shot: any other value is ignored, so
//   a value left in Infisical expires on the next deploy. The env check still
//   runs.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import {
  findJournalDrift,
  missingDatabaseEnv,
  retiredDatabaseEnv,
  skipMigrationsDecision,
  type AppliedMigration,
  type JournalEntry,
} from "../src/server/deploy/startup-checks";
import {
  APPROVAL_ENV,
  checkPendingApprovals,
  refusalMessage,
} from "../src/server/deploy/migration-approval";

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
    `${missing.join(", ")} not set. Refusing to start.`,
  );
}

const retired = retiredDatabaseEnv(process.env);
if (retired.length > 0) {
  fatal(
    `${retired.join(", ")} is still set, but FAVO now uses one direct DATABASE_URL (AT-168). Remove it from Infisical so a stale pooler config cannot linger.`,
  );
}

const skip = skipMigrationsDecision(process.env);
if (skip.warning) console.warn(`[migrate] WARNING: ${skip.warning}`);
if (skip.skip) process.exit(0);

const journal: (JournalEntry & { idx: number })[] = JSON.parse(
  readFileSync(join(MIGRATIONS_FOLDER, "meta", "_journal.json"), "utf8"),
).entries;

const sql = postgres(process.env.DATABASE_URL!, {
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
  if (drift.problems.length > 0) {
    fatal(
      `drizzle journal drift, repair it before releasing (see scripts/repair-drizzle-journal-0027.ts):\n  - ${drift.problems.join("\n  - ")}`,
    );
  }
  if (drift.ahead.length > 0) {
    console.warn(
      `[migrate] WARNING: database is AHEAD of this image — ${drift.ahead.length} applied migration(s) newer than every file in this image (created_at ${drift.ahead.join(", ")}). Expected after a rollback; nothing will be applied. This image's code must tolerate the newer schema.`,
    );
  }

  const appliedWhens = new Set(applied.map((r) => Number(r.created_at)));
  const pendingEntries = journal.filter((e) => !appliedWhens.has(e.when));
  const pending = pendingEntries.length;

  const approval = checkPendingApprovals(
    pendingEntries.map((e) => ({
      idx: e.idx,
      tag: e.tag,
      sql: readFileSync(join(MIGRATIONS_FOLDER, `${e.tag}.sql`), "utf8"),
    })),
    process.env,
  );
  if (approval.refused.length > 0) fatal(refusalMessage(approval.refused));
  for (const tag of approval.approved) {
    console.warn(`[migrate] WARNING: applying risky migration ${tag}, approved via ${APPROVAL_ENV}`);
  }
  if (approval.unused.length > 0) {
    console.warn(
      `[migrate] WARNING: ${APPROVAL_ENV} names ${approval.unused.join(", ")}, which is not pending. Remove it so it cannot be mistaken for a standing approval.`,
    );
  }
  console.log(`[migrate] ${applied.length} applied, ${pending} pending (image ${process.env.IMAGE_SHA || "unknown"})`);
  await migrate(drizzle(sql), { migrationsFolder: MIGRATIONS_FOLDER });
  console.log(`[migrate] done — schema at ${journal.at(-1)?.tag ?? "(empty journal)"}`);
} catch (err) {
  fatal(err instanceof Error ? err.message : String(err));
} finally {
  // Ending the session releases the advisory lock.
  await sql.end({ timeout: 5 });
}
