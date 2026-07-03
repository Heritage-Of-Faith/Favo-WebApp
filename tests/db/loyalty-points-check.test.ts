// F7 / L06: customers.loyalty_points must be >= 0 (CHECK constraint).
// Requires a real Postgres — skips when none is reachable.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Sql } from "postgres";
import { connect, hasRealDb, migrationSql } from "./helpers";

const maybe = hasRealDb() ? describe : describe.skip;

maybe("customers.loyalty_points >= 0 CHECK (F7)", () => {
  let sql: Sql;

  beforeAll(async () => {
    sql = connect();
    // Idempotent-ish: add the constraint if the DB hasn't run the migration.
    // Wrapped so a duplicate-constraint error on an already-migrated DB is fine.
    try {
      await sql.unsafe(migrationSql("0020_loyalty_points_check.sql"));
    } catch (e) {
      const msg = String(e);
      if (!/already exists|duplicate/i.test(msg)) throw e;
    }
  });

  afterAll(async () => {
    await sql?.end({ timeout: 5 });
  });

  it("rejects a negative loyalty_points on INSERT", async () => {
    await expect(
      sql`
        INSERT INTO customers (name, loyalty_points)
        VALUES ('Negative Nelly', -1)
      `
    ).rejects.toThrow(/loyalty_points_non_negative|check/i);
  });

  it("rejects an UPDATE that drives loyalty_points negative", async () => {
    const inserted = await sql`
      INSERT INTO customers (name, loyalty_points) VALUES ('Zero Zoe', 0)
      RETURNING id
    `;
    const id = inserted[0].id as string;
    await expect(
      sql`UPDATE customers SET loyalty_points = -5 WHERE id = ${id}`
    ).rejects.toThrow(/loyalty_points_non_negative|check/i);
    await sql`DELETE FROM customers WHERE id = ${id}`;
  });

  it("accepts zero and positive values", async () => {
    const rows = await sql`
      INSERT INTO customers (name, loyalty_points) VALUES ('Positive Pat', 50)
      RETURNING loyalty_points
    `;
    expect(rows[0].loyalty_points).toBe(50);
    await sql`DELETE FROM customers WHERE name = 'Positive Pat'`;
  });
});
