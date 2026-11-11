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
  // CHANGED (L28 merge): 0042 now follows 0041, so 0041 is no longer the last
  // entry. It must still be present at idx 41 with a `when` strictly greater
  // than every entry before it (and smaller than every entry after it).
  it("is present at idx 41 and its `when` is strictly greater than every earlier one", () => {
    const journal = JSON.parse(readFileSync(resolve(process.cwd(), "drizzle/meta/_journal.json"), "utf8")) as {
      entries: { idx: number; when: number; tag: string }[];
    };
    const at = journal.entries.findIndex((e) => e.tag === "0041_at205_expense_note");
    expect(at).toBeGreaterThanOrEqual(0);
    const entry = journal.entries[at];
    expect(entry.idx).toBe(41);
    for (const e of journal.entries.slice(0, at)) expect(entry.when).toBeGreaterThan(e.when);
    for (const e of journal.entries.slice(at + 1)) expect(entry.when).toBeLessThan(e.when);
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
