// Shared helpers for tests/db/* — real-Postgres integration tests.
//
// These tests require a live Postgres (CI provisions one at
// postgresql://favo:favo@localhost:5432/favo_test). They are NOT part of the
// `bun test:unit` merge gate (which uses a dummy DATABASE_URL and never
// connects); they run via `bun test:db` against a real DB (see package.json
// and vitest.db.config.ts). Locally, with no real DB reachable, they SKIP.

import postgres from "postgres";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const REAL_DB_URL = process.env.DATABASE_URL ?? "";

/**
 * PRODUCTION SAFETY RAIL. These tests apply migrations and insert fixture rows —
 * including an `audit_log` row that the append-only trigger under test makes
 * PERMANENTLY UNDELETABLE. Vitest auto-loads `.env.local`, which on a dev
 * machine (and in Vercel) points at the LIVE Supabase database. Without this
 * guard, `bun test:db` locally would run the suite against production.
 *
 * We therefore refuse any Supabase/managed host outright unless the operator
 * has explicitly opted in with FAVO_DB_TEST_OK=1 (CI's throwaway Postgres, or a
 * developer who has knowingly pointed DATABASE_URL at a scratch database).
 */
function isManagedProdHost(url: string): boolean {
  return /(?:^|@|\/\/)[^/]*\b(?:supabase\.co|supabase\.com|pooler\.supabase\.com)\b/i.test(url);
}

/**
 * True when DATABASE_URL points at a reachable, non-placeholder Postgres that is
 * SAFE to mutate. The vitest dummy url and the .env.local placeholder count as
 * "no DB"; a managed/prod host is refused unless FAVO_DB_TEST_OK=1 is set.
 */
export function hasRealDb(): boolean {
  if (!REAL_DB_URL) return false;
  if (REAL_DB_URL.includes("placeholder")) return false;
  if (REAL_DB_URL.includes("test:test@localhost")) return false; // vitest dummy
  if (!REAL_DB_URL.startsWith("postgres")) return false;
  if (isManagedProdHost(REAL_DB_URL) && process.env.FAVO_DB_TEST_OK !== "1") {
    throw new Error(
      "tests/db refused to run: DATABASE_URL points at a Supabase/managed host " +
        "(likely PRODUCTION). These tests mutate the DB and write an undeletable " +
        "audit_log row. Set FAVO_DB_TEST_OK=1 only if this is a disposable database."
    );
  }
  return true;
}

/** Open a raw postgres-js client (prepare:false to match db/index.ts / PgBouncer). */
export function connect() {
  return postgres(REAL_DB_URL, { max: 1, prepare: false, onnotice: () => {} });
}

/** Read a migration file's SQL and strip drizzle's statement-breakpoint markers. */
export function migrationSql(file: string): string {
  const path = resolve(process.cwd(), "drizzle", file);
  return readFileSync(path, "utf8").replaceAll("--> statement-breakpoint", "");
}
