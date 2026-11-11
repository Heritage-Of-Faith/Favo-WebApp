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
 * machine (and in production) points at the LIVE Supabase database. Without this
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

/**
 * Step 0054 (deferred mode: orders.settled_at / settlement_ref and the
 * opening_sessions.deferred_* columns, PRD §10.3) down inside the caller's
 * always-rolled-back transaction. Its down refuses while a settled order or a
 * deferred session exists, so any are cleared first — inside the same
 * transaction, so the rollback restores them. It is the newest migration, so
 * it steps down before 0053.
 */
export async function stepDown0054(tx: { unsafe: (q: string) => PromiseLike<unknown> }): Promise<void> {
  await tx.unsafe(
    `UPDATE orders SET settled_at = NULL, settlement_ref = NULL WHERE settled_at IS NOT NULL OR settlement_ref IS NOT NULL;
     UPDATE opening_sessions SET deferred_since = NULL, deferred_reason = NULL, deferred_by_staff_id = NULL, deferred_entered_by = NULL
       WHERE deferred_since IS NOT NULL OR deferred_entered_by IS NOT NULL;`
  );
  await tx.unsafe(migrationSql("down/0054_deferred_mode_settlement.down.sql"));
}

/**
 * Step 0053 (REQ-127: inventory_items.is_lid, app_config variance_bands, and
 * v_weekly_variance judging lids against T08) down inside the caller's
 * always-rolled-back transaction. Its view reads app_config, which 0037 down
 * drops, so it steps down first. It steps down after 0054, before 0052.
 */
export async function stepDown0053(tx: { unsafe: (q: string) => PromiseLike<unknown> }): Promise<void> {
  await tx.unsafe(migrationSql("down/0053_at127_lid_variance_band.down.sql"));
}

/**
 * Step 0052 (REQ-130: price_history.set_by_staff_id) down inside the caller's
 * always-rolled-back transaction. Its down refuses while any price_history row
 * exists; no tests/db suite commits one. Steps down after 0053, before 0051.
 */
export async function stepDown0052(tx: { unsafe: (q: string) => PromiseLike<unknown> }): Promise<void> {
  await tx.unsafe(migrationSql("down/0052_at130_price_history_set_by.down.sql"));
}

/**
 * Step 0051 (orders.payment_mode NOT NULL, §10.3 L2499) down inside the
 * caller's always-rolled-back transaction. It only drops the NOT NULL, so the
 * older suites' fixtures that insert an order without naming its mode keep
 * working at their own migration. It is the newest migration, so it steps
 * down before 0050.
 */
export async function stepDown0051(tx: { unsafe: (q: string) => PromiseLike<unknown> }): Promise<void> {
  await tx.unsafe(migrationSql("down/0051_payment_mode_not_null.down.sql"));
}

/**
 * Step 0050 (AT-203 follow-up: v_daily_revenue also counts an abandoned
 * fund-paid order) down inside the caller's always-rolled-back transaction.
 * It restores 0045's view text, which no longer reads donor_fund_entries, so
 * 0046 down can drop that table. It is the newest migration, so it steps down
 * before 0049.
 */
export async function stepDown0050(tx: { unsafe: (q: string) => PromiseLike<unknown> }): Promise<void> {
  await tx.unsafe(migrationSql("down/0050_at203_fund_abandon_revenue.down.sql"));
}

/**
 * Step 0049 (AT-174: refunds + refund_status dropped) down inside the caller's
 * always-rolled-back transaction. It recreates the empty table and enum, and
 * steps down before 0048 (after 0050).
 */
export async function stepDown0049(tx: { unsafe: (q: string) => PromiseLike<unknown> }): Promise<void> {
  await tx.unsafe(migrationSql("down/0049_at174_drop_refunds.down.sql"));
}

/**
 * Step 0048 (AT-207: daily_closes + orders.written_off_at) down inside the
 * caller's always-rolled-back transaction. Its down refuses while a close
 * record or a written-off order exists, and tests/db/scheduled-jobs.test.ts
 * commits both (closeDaily on past days), so they are cleared first — inside
 * the same transaction, so the rollback restores them.
 */
export async function stepDown0048(tx: { unsafe: (q: string) => PromiseLike<unknown> }): Promise<void> {
  await tx.unsafe(`DELETE FROM daily_closes; UPDATE orders SET written_off_at = NULL WHERE written_off_at IS NOT NULL;`);
  await tx.unsafe(migrationSql("down/0048_at207_daily_closes_writeoffs.down.sql"));
}
