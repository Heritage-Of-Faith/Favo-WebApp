// AT-201 part 2b: 0037 (app_config) ships with a tested `down` (PRD §14).
// Spec: PRD v7.0 §10.4 — "One app_config table, keyed (tenant_id, key), values
// typed as jsonb".
//
// Runs against the CI test DB, which `bun db:migrate` has brought to 0037.
// Every case runs inside ONE transaction that is always rolled back.
//
// What it proves:
//   - the table matches the 0037 snapshot; down drops it; up recreates it;
//   - (tenant_id, key) is the key: a second row for one key is refused;
//   - down refuses, changing nothing, while a setting is stored.
//
// Requires a real Postgres (see tests/db/helpers.ts) — skips when none.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Sql, TransactionSql } from "postgres";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { connect, hasRealDb, migrationSql } from "./helpers";

const maybe = hasRealDb() ? describe : describe.skip;

const UP = "0037_at201_app_config.sql";
const DOWN = "down/0037_at201_app_config.down.sql";

function snapshotColumns(): string[] {
  const path = resolve(process.cwd(), "drizzle", "meta", "0037_snapshot.json");
  const snap = JSON.parse(readFileSync(path, "utf8")) as {
    tables: Record<string, { columns: Record<string, { name: string; notNull: boolean }> }>;
  };
  return Object.values(snap.tables["public.app_config"].columns)
    .map((c) => c.name + (c.notNull ? "!" : ""))
    .sort();
}

async function dbColumns(tx: TransactionSql): Promise<string[] | null> {
  const [exists] = await tx`SELECT to_regclass('public.app_config') AS t`;
  if (exists.t === null) return null;
  const cols = await tx`
    SELECT column_name, is_nullable FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'app_config'`;
  return cols.map((r) => (r.column_name as string) + (r.is_nullable === "NO" ? "!" : "")).sort();
}

class Rollback extends Error {}

maybe("0037 app_config: up → down → up, and the refusals (AT-201, §10.4)", () => {
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

  it("down drops app_config; up again recreates it as the snapshot says", async () => {
    await inRolledBackTx(async (tx) => {
      expect(await dbColumns(tx)).toEqual(snapshotColumns());
      await tx.unsafe(migrationSql(DOWN));
      expect(await dbColumns(tx)).toBeNull();
      await tx.unsafe(migrationSql(UP));
      expect(await dbColumns(tx)).toEqual(snapshotColumns());
    });
  });

  it("(tenant_id, key) is the key: one row per setting", async () => {
    await inRolledBackTx(async (tx) => {
      await tx`INSERT INTO app_config (key, value) VALUES ('webpos_device_id', '"dev-1"'::jsonb)`;
      await expect(
        tx.savepoint((sp) => sp`INSERT INTO app_config (key, value) VALUES ('webpos_device_id', '"dev-2"'::jsonb)`)
      ).rejects.toThrow(/app_config_pkey/);
    });
  });

  it("down refuses, changing nothing, while a setting is stored", async () => {
    await inRolledBackTx(async (tx) => {
      await tx`INSERT INTO app_config (key, value) VALUES ('webpos_device_id', '"dev-1"'::jsonb)`;
      await expect(tx.savepoint((sp) => sp.unsafe(migrationSql(DOWN)))).rejects.toThrow(/AT-201\/0037 down/);
      expect(await dbColumns(tx)).toEqual(snapshotColumns());
    });
  });
});
