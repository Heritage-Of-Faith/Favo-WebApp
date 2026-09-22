// F2 / L13: database-layer customer isolation via RLS.
//
// Proves that under `SET LOCAL ROLE favo_customer` +
// app.current_customer_id = A, a SELECT over orders / customers
// returns ONLY customer A's rows and never customer B's — even with no
// app-code WHERE clause. Requires a real Postgres — skips when none reachable.
//
// (loyalty_transactions coverage was dropped along with the loyalty_transactions
// table itself in the v7 deletion pass — see CLAUDE.md §"Deleted by v7".)
//
// The RLS migration grants favo_customer TO current_user; in CI current_user
// is `favo` (table owner). Owner bypasses non-forced RLS, so the raw fixtures
// below (run as owner) are unaffected; isolation only bites after SET ROLE.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Sql } from "postgres";
import { connect, hasRealDb } from "./helpers";

const maybe = hasRealDb() ? describe : describe.skip;

maybe("RLS customer isolation (F2)", () => {
  let sql: Sql;
  let staffId: string;
  let custA: string;
  let custB: string;
  let orderA: string;
  let orderB: string;

  beforeAll(async () => {
    sql = connect();
    // The RLS migration (0023) is already applied by the CI "Migrate test DB"
    // step (bun db:migrate) that runs before this suite — no need to replay it
    // here. (It used to be re-applied inline for idempotency insurance, but
    // that raw-SQL replay broke once a later migration dropped a table 0023
    // also referenced — migrations are immutable, so the fix is to rely on
    // the real migrate step instead of re-running historical SQL.)

    // Fixtures created as owner (bypasses RLS).
    const staff = await sql`
      INSERT INTO staff (name, role, pin_hash) VALUES ('RLS Barista', 'barista', 'x')
      RETURNING id`;
    staffId = staff[0].id as string;

    const a = await sql`INSERT INTO customers (name) VALUES ('RLS Cust A') RETURNING id`;
    const b = await sql`INSERT INTO customers (name) VALUES ('RLS Cust B') RETURNING id`;
    custA = a[0].id as string;
    custB = b[0].id as string;

    const oa = await sql`
      INSERT INTO orders (customer_id, staff_id, total_zar) VALUES (${custA}, ${staffId}, 1000)
      RETURNING id`;
    const ob = await sql`
      INSERT INTO orders (customer_id, staff_id, total_zar) VALUES (${custB}, ${staffId}, 2000)
      RETURNING id`;
    orderA = oa[0].id as string;
    orderB = ob[0].id as string;
  });

  afterAll(async () => {
    // Cleanup as owner.
    if (sql) {
      await sql`DELETE FROM orders WHERE id IN (${orderA}, ${orderB})`;
      await sql`DELETE FROM customers WHERE id IN (${custA}, ${custB})`;
      await sql`DELETE FROM staff WHERE id = ${staffId}`;
      await sql.end({ timeout: 5 });
    }
  });

  it("scoped to A: orders returns only A's order", async () => {
    const rows = await sql.begin(async (tx) => {
      await tx`SET LOCAL ROLE favo_customer`;
      await tx`SELECT set_config('app.current_customer_id', ${custA}, true)`;
      return tx`SELECT id, customer_id FROM orders`;
    });
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(orderA);
    expect(ids).not.toContain(orderB);
    expect(rows.every((r) => r.customer_id === custA)).toBe(true);
  });

  it("scoped to B: cannot see A's order", async () => {
    const rows = await sql.begin(async (tx) => {
      await tx`SET LOCAL ROLE favo_customer`;
      await tx`SELECT set_config('app.current_customer_id', ${custB}, true)`;
      return tx`SELECT id FROM orders`;
    });
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(orderB);
    expect(ids).not.toContain(orderA);
  });

  it("no customer id set: fail-closed (zero rows)", async () => {
    const rows = await sql.begin(async (tx) => {
      await tx`SET LOCAL ROLE favo_customer`;
      // app.current_customer_id intentionally not set → NULL → col = NULL never true
      return tx`SELECT id FROM orders WHERE customer_id IN (${custA}, ${custB})`;
    });
    expect(rows.length).toBe(0);
  });

  it("own customers row visible; other customer hidden under scope A", async () => {
    const rows = await sql.begin(async (tx) => {
      await tx`SET LOCAL ROLE favo_customer`;
      await tx`SELECT set_config('app.current_customer_id', ${custA}, true)`;
      return tx`SELECT id FROM customers WHERE id IN (${custA}, ${custB})`;
    });
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(custA);
    expect(ids).not.toContain(custB);
  });
});
