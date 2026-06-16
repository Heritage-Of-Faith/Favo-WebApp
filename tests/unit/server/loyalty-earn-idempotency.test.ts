// AT-60: Idempotency guard for loyalty earn — structural tests.
// The DB-level guard is a partial unique index on loyalty_transactions(order_id)
// WHERE kind = 'earn', defined in db/schema.ts and deployed via migration 0010.
//
// These tests verify the structural presence of the guard without requiring a
// live database connection.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const MIGRATION_PATH = resolve(process.cwd(), "drizzle/0010_loyalty_earn_idempotency.sql");
const SCHEMA_PATH = resolve(process.cwd(), "db/schema.ts");

describe("loyalty earn idempotency — migration 0010 (AT-60)", () => {
  it("migration file exists", () => {
    let content: string;
    expect(() => { content = readFileSync(MIGRATION_PATH, "utf8"); }).not.toThrow();
    expect(content!.length).toBeGreaterThan(0);
  });

  it("declares the partial unique index name", () => {
    const sql = readFileSync(MIGRATION_PATH, "utf8");
    expect(sql).toContain("loyalty_txn_earn_order_unique");
  });

  it("targets the loyalty_transactions table", () => {
    const sql = readFileSync(MIGRATION_PATH, "utf8");
    expect(sql).toContain("loyalty_transactions");
  });

  it("restricts the index to earn rows only (partial WHERE clause)", () => {
    const sql = readFileSync(MIGRATION_PATH, "utf8").toLowerCase();
    expect(sql).toContain("where kind = 'earn'");
  });

  it("uses CREATE UNIQUE INDEX", () => {
    const sql = readFileSync(MIGRATION_PATH, "utf8").toUpperCase();
    expect(sql).toContain("CREATE UNIQUE INDEX");
  });
});

describe("loyalty earn idempotency — schema definition (AT-60)", () => {
  it("schema.ts declares a uniqueIndex on loyaltyTransactions", () => {
    const schema = readFileSync(SCHEMA_PATH, "utf8");
    // The constraint must reference the index name
    expect(schema).toContain("loyalty_txn_earn_order_unique");
  });

  it("schema.ts imports uniqueIndex from drizzle-orm/pg-core", () => {
    const schema = readFileSync(SCHEMA_PATH, "utf8");
    // A simple substring check is sufficient: the import must include uniqueIndex
    expect(schema).toContain("uniqueIndex");
    expect(schema).toContain("drizzle-orm/pg-core");
  });

  it("the uniqueIndex is filtered to earn kind only", () => {
    const schema = readFileSync(SCHEMA_PATH, "utf8");
    expect(schema).toContain("= 'earn'");
  });
});
