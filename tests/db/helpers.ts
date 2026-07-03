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
 * True when DATABASE_URL points at a reachable, non-placeholder Postgres.
 * We treat the vitest dummy url and the .env.local placeholder as "no DB".
 */
export function hasRealDb(): boolean {
  if (!REAL_DB_URL) return false;
  if (REAL_DB_URL.includes("placeholder")) return false;
  if (REAL_DB_URL.includes("test:test@localhost")) return false; // vitest dummy
  return REAL_DB_URL.startsWith("postgres");
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
