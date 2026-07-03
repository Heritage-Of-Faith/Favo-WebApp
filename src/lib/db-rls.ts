// Customer-scoped DB access (F2 / L13).
//
// withCustomerScope(customerId, fn) runs `fn` inside a transaction whose role
// is switched to the non-owner `favo_customer` role and whose
// `app.current_customer_id` GUC is set to `customerId`. The RLS policies added
// in drizzle/0023_rls_customer_isolation.sql then restrict every SELECT to that
// customer's own rows at the DATABASE layer — even if app-code WHERE clauses
// were wrong or omitted, a customer can never read another customer's data.
//
// WHY SET LOCAL: Supabase's pooled connection is a PgBouncer *transaction*
// pooler. Session-level `SET` would leak across pooled clients; `SET LOCAL`
// (and set_config(..., is_local => true)) is scoped to the current transaction
// and is reset on COMMIT/ROLLBACK, so it is pooler-safe.
//
// The role name is a hardcoded constant (never user input); the customer id is
// passed as a bound parameter to set_config — no string interpolation.

import { sql } from "drizzle-orm";
import { db, type DB } from "@db/index";

/**
 * Run `fn` under the `favo_customer` role with RLS scoped to `customerId`.
 * Opens a single transaction (matches db/index.ts postgres-js client,
 * prepare: false). The passed `tx` is a Drizzle transaction typed as DB.
 */
export async function withCustomerScope<T>(
  customerId: string,
  fn: (tx: DB) => Promise<T>
): Promise<T> {
  return db.transaction(async (tx) => {
    // Switch to the restricted, RLS-governed role for the rest of the txn.
    // SET LOCAL ROLE cannot take a bind parameter, but the identifier is a
    // trusted compile-time constant, so this is not an injection surface.
    await tx.execute(sql`SET LOCAL ROLE favo_customer`);

    // Bind the customer id as a parameter (is_local => true keeps it txn-scoped).
    await tx.execute(
      sql`SELECT set_config('app.current_customer_id', ${customerId}, true)`
    );

    return fn(tx as unknown as DB);
  });
}
