// AT-205: 0041 (expenses.note) ships with a tested down (PRD §14, "Rollback
// strategies").
//
// MIGRATION NUMBER IS PROVISIONAL — see the header of
// drizzle/0041_at205_expense_note.sql. Renumber this file with it.
//
// Runs against the CI test DB, already migrated through 0041. Every case runs
// in ONE transaction that is always rolled back.
//
// Requires a real Postgres (see tests/db/helpers.ts) — skips when none.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Sql, TransactionSql } from "postgres";
import { connect, hasRealDb, migrationSql } from "./helpers";

const maybe = hasRealDb() ? describe : describe.skip;

class Rollback extends Error {}

async function columns(tx: TransactionSql, table: string): Promise<Record<string, string>> {
  const rows = await tx`
    SELECT column_name, is_nullable FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = ${table}`;
  return Object.fromEntries(rows.map((r) => [r.column_name as string, r.is_nullable as string]));
}

describe("0041 journal entry (AT-205)", () => {
  it("is the last entry and its `when` is strictly greater than every earlier one", () => {
    const journal = JSON.parse(readFileSync(resolve(process.cwd(), "drizzle/meta/_journal.json"), "utf8")) as {
      entries: { idx: number; when: number; tag: string }[];
    };
    const last = journal.entries[journal.entries.length - 1];
    expect(last.tag).toBe("0041_at205_expense_note");
    expect(last.idx).toBe(41);
    for (const e of journal.entries.slice(0, -1)) expect(last.when).toBeGreaterThan(e.when);
  });
});

maybe("0041: up → down → up (AT-205)", () => {
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

  beforeAll(() => {
    sql = connect();
  });
  afterAll(async () => {
    await sql.end();
  });

  it("migrated: expenses.note exists and is nullable", async () => {
    await inRolledBackTx(async (tx) => {
      expect((await columns(tx, "expenses")).note).toBe("YES");
    });
  });

  it("down 0041 → up 0041 round-trips", async () => {
    await inRolledBackTx(async (tx) => {
      await tx.unsafe(migrationSql("down/0041_at205_expense_note.down.sql"));
      expect((await columns(tx, "expenses")).note).toBeUndefined();
      await tx.unsafe(migrationSql("0041_at205_expense_note.sql"));
      expect((await columns(tx, "expenses")).note).toBe("YES");
    });
  });
});
