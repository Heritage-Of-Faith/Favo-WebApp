// F1 / L08 · L12: audit_log is append-only, trigger-enforced.
// Proves an UPDATE and a DELETE on audit_log both raise. Requires a real
// Postgres (see tests/db/helpers.ts) — skips when none is reachable.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Sql } from "postgres";
import { connect, hasRealDb, migrationSql } from "./helpers";

const maybe = hasRealDb() ? describe : describe.skip;

maybe("audit_log append-only trigger (F1)", () => {
  let sql: Sql;
  let rowId: string;

  beforeAll(async () => {
    sql = connect();
    // Ensure the triggers exist (idempotent migrations). Safe on a DB that
    // already ran them via db:migrate.
    await sql.unsafe(migrationSql("0021_audit_log_append_only.sql"));
    await sql.unsafe(migrationSql("0025_audit_log_no_truncate.sql"));
    // Insert one audit row to attempt to mutate.
    const inserted = await sql`
      INSERT INTO audit_log (entity_kind, entity_id, action)
      VALUES ('test', 'trigger-test', 'insert')
      RETURNING id
    `;
    rowId = inserted[0].id as string;
  });

  afterAll(async () => {
    await sql?.end({ timeout: 5 });
  });

  it("allows INSERT (append)", () => {
    expect(rowId).toBeTruthy();
  });

  it("rejects UPDATE with the append-only error", async () => {
    await expect(
      sql`UPDATE audit_log SET action = 'tampered' WHERE id = ${rowId}`
    ).rejects.toThrow(/append-only/i);
  });

  it("rejects DELETE with the append-only error", async () => {
    await expect(
      sql`DELETE FROM audit_log WHERE id = ${rowId}`
    ).rejects.toThrow(/append-only/i);
  });

  it("rejects TRUNCATE with the append-only error (statement-level guard, 0025)", async () => {
    // Row-level triggers don't fire on TRUNCATE — the statement-level guard must.
    await expect(sql`TRUNCATE audit_log`).rejects.toThrow(/append-only/i);
  });

  it("row still present after failed mutations", async () => {
    const rows = await sql`SELECT id FROM audit_log WHERE id = ${rowId}`;
    expect(rows.length).toBe(1);
  });
});
