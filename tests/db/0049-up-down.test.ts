// AT-174: 0049 (drop refunds + refund_status) ships with a tested `down`
// (PRD §14). Spec: PRD v7.0 L02, §10.1, REQ-060.
//
// Runs against the CI test DB, which `bun db:migrate` has brought to 0049.
// Every case runs inside ONE transaction that is always rolled back.
//
// What it proves:
//   - at 0049 neither refunds nor refund_status exists, as the 0049 snapshot says;
//   - down recreates both exactly as the 0048 snapshot says (and 0049 is gone
//     from drizzle's ledger); up drops them again; a second up is a no-op;
//   - up refuses, changing nothing, while refunds holds a row;
//   - down refuses, changing nothing, against a database not at 0049.
//
// Requires a real Postgres (see tests/db/helpers.ts) — skips when none.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Sql, TransactionSql } from "postgres";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { connect, hasRealDb, migrationSql } from "./helpers";

const maybe = hasRealDb() ? describe : describe.skip;

const UP = "0049_at174_drop_refunds.sql";
const DOWN = "down/0049_at174_drop_refunds.down.sql";
const WHEN_0049 = 1793219800000; // drizzle/meta/_journal.json, idx 49

type Snap = {
  tables: Record<string, { columns: Record<string, { name: string; notNull: boolean }> }>;
  enums: Record<string, { values: string[] }>;
};

function snapshot(file: string): Snap {
  return JSON.parse(readFileSync(resolve(process.cwd(), "drizzle", "meta", file), "utf8")) as Snap;
}

function snapshotColumns(file: string, table: string): string[] | null {
  const t = snapshot(file).tables[`public.${table}`];
  if (!t) return null;
  return Object.values(t.columns).map((c) => c.name + (c.notNull ? "!" : "")).sort();
}

function snapshotEnum(file: string, name: string): string[] | null {
  return snapshot(file).enums[`public.${name}`]?.values ?? null;
}

async function ledgerHas0049(tx: TransactionSql): Promise<boolean | null> {
  const [reg] = await tx`SELECT to_regclass('drizzle.__drizzle_migrations') AS t`;
  if (reg.t === null) return null; // no drizzle ledger in this DB
  const rows = await tx`SELECT 1 FROM drizzle.__drizzle_migrations WHERE created_at = ${WHEN_0049}`;
  return rows.length > 0;
}

async function dbColumns(tx: TransactionSql, table: string): Promise<string[] | null> {
  const [exists] = await tx`SELECT to_regclass(${"public." + table}) AS t`;
  if (exists.t === null) return null;
  const cols = await tx`
    SELECT column_name, is_nullable FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = ${table}`;
  return cols.map((r) => (r.column_name as string) + (r.is_nullable === "NO" ? "!" : "")).sort();
}

async function dbEnum(tx: TransactionSql, name: string): Promise<string[] | null> {
  const rows = await tx`
    SELECT e.enumlabel FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public' AND t.typname = ${name}
    ORDER BY e.enumsortorder`;
  return rows.length === 0 ? null : rows.map((r) => r.enumlabel as string);
}

class Rollback extends Error {}

maybe("0049 drop refunds + refund_status: up → down → up, and the refusals (AT-174, L02)", () => {
  let sql: Sql;

  async function inRolledBackTx(fn: (tx: TransactionSql) => Promise<void>) {
    try {
      await sql.begin(async (tx) => {
        await fn(tx);
        throw new Rollback();
      });
    } catch (err) {
      if (!(err instanceof Rollback)) throw err;
    }
  }

  beforeAll(() => { sql = connect(); });
  afterAll(async () => { await sql?.end({ timeout: 5 }); });

  it("down recreates refunds and refund_status as 0048 had them; up drops them again", async () => {
    await inRolledBackTx(async (tx) => {
      expect(snapshotColumns("0049_snapshot.json", "refunds")).toBeNull();
      expect(snapshotEnum("0049_snapshot.json", "refund_status")).toBeNull();
      expect(await dbColumns(tx, "refunds")).toBeNull();
      expect(await dbEnum(tx, "refund_status")).toBeNull();

      const ledgerBefore = await ledgerHas0049(tx);
      if (ledgerBefore !== null) expect(ledgerBefore).toBe(true);
      await tx.unsafe(migrationSql(DOWN));
      expect(await dbColumns(tx, "refunds")).toEqual(snapshotColumns("0048_snapshot.json", "refunds"));
      expect(await dbEnum(tx, "refund_status")).toEqual(["pending", "approved", "rejected"]);
      expect(await dbEnum(tx, "refund_status")).toEqual(snapshotEnum("0048_snapshot.json", "refund_status"));
      if (ledgerBefore !== null) expect(await ledgerHas0049(tx)).toBe(false);

      await tx.unsafe(migrationSql(UP));
      expect(await dbColumns(tx, "refunds")).toBeNull();
      expect(await dbEnum(tx, "refund_status")).toBeNull();
      // Re-runnable: a second up changes nothing and does not fail.
      await tx.unsafe(migrationSql(UP));
    });
  });

  it("up refuses, changing nothing, while refunds holds a row", async () => {
    await inRolledBackTx(async (tx) => {
      await tx.unsafe(migrationSql(DOWN));
      const [s] = await tx`INSERT INTO staff (name, role, pin_hash) VALUES ('AT-174 Barista', 'barista', 'x') RETURNING id`;
      const [o] = await tx`INSERT INTO orders (staff_id, total_zar, revenue_day, notification_target, payment_mode) VALUES (${s.id}, 2500, '2026-10-25', 'none', 'yoco') RETURNING id`;
      await tx`INSERT INTO refunds (order_id, amount_zar, reason, requested_by) VALUES (${o.id}, 2500, 'x', ${s.id})`;
      await expect(tx.savepoint((sp) => sp.unsafe(migrationSql(UP)))).rejects.toThrow(/AT-174\/0049: refunds holds rows/);
      expect(await dbColumns(tx, "refunds")).toEqual(snapshotColumns("0048_snapshot.json", "refunds"));
      expect(await dbEnum(tx, "refund_status")).toEqual(["pending", "approved", "rejected"]);
    });
  });

  it("down refuses, changing nothing, when refunds already exists", async () => {
    await inRolledBackTx(async (tx) => {
      await tx.unsafe(migrationSql(DOWN));
      await expect(tx.savepoint((sp) => sp.unsafe(migrationSql(DOWN)))).rejects.toThrow(/AT-174\/0049 down/);
      expect(await dbColumns(tx, "refunds")).toEqual(snapshotColumns("0048_snapshot.json", "refunds"));
    });
  });
});
