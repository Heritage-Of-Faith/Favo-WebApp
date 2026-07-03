-- F2 / L13: database-layer customer isolation via Row-Level Security.
--
-- GOAL: a signed-in customer can only ever read their OWN rows, enforced by
-- Postgres — not merely by app-code WHERE clauses.
--
-- SAFETY / how this cannot lock staff/admin/system out:
--   * Staff/admin/system code uses the main `db` connection, which is the
--     TABLE OWNER role. A table owner BYPASSES row-level security unless the
--     table is set to FORCE ROW LEVEL SECURITY. We deliberately DO NOT force
--     it. So enabling RLS here changes nothing for the owner connection —
--     every existing staff/admin/owner/system query keeps returning exactly
--     the same rows as today.
--   * The policies below apply ONLY `TO favo_customer`, a dedicated NOLOGIN,
--     NOINHERIT, non-owner role. Customer isolation kicks in solely when the
--     app opens a transaction and runs `SET LOCAL ROLE favo_customer`
--     (see src/lib/db-rls.ts → withCustomerScope). No other code path sets
--     that role, so no other code path is affected.
--   * The row predicate is current_setting('app.current_customer_id', true).
--     The `true` (missing_ok) means an unset GUC yields NULL, and `col = NULL`
--     is never true → a scoped session with no customer id set sees ZERO rows
--     (fail-closed), never everyone's rows.
--
-- Idempotent where practical (guards on role + policies), so re-running is safe.

-- ─── 1. Dedicated non-owner customer role ─────────────────────────────────────
-- NOLOGIN: cannot be used to connect directly. NOINHERIT: does not silently
-- pick up owner privileges. The app login role (whoever runs this migration —
-- on Supabase that is the project owner/`postgres` role that the pooled
-- DATABASE_URL authenticates as) is granted membership so it can
-- `SET LOCAL ROLE favo_customer` within a transaction.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'favo_customer') THEN
    CREATE ROLE favo_customer NOLOGIN NOINHERIT;
  END IF;
END
$$;
--> statement-breakpoint

-- Allow the current app login role to assume favo_customer via SET ROLE.
-- current_user = the role that authenticated this migration/session, i.e. the
-- same role the app connects as. GRANT ... TO current_user is dynamic so this
-- works regardless of the concrete Supabase role name.
DO $$
BEGIN
  EXECUTE format('GRANT favo_customer TO %I', current_user);
END
$$;
--> statement-breakpoint

-- Minimal privileges for the customer role: SELECT only on the tables its
-- dashboard reads. menu_items is public reference data (needed for the item-name
-- joins in listCustomerOrders / getPacks); the rest are row-filtered by policy.
GRANT USAGE ON SCHEMA public TO favo_customer;
--> statement-breakpoint
GRANT SELECT ON customers TO favo_customer;
--> statement-breakpoint
GRANT SELECT ON orders TO favo_customer;
--> statement-breakpoint
GRANT SELECT ON order_items TO favo_customer;
--> statement-breakpoint
GRANT SELECT ON loyalty_transactions TO favo_customer;
--> statement-breakpoint
GRANT SELECT ON wallet_transactions TO favo_customer;
--> statement-breakpoint
GRANT SELECT ON coffee_packs TO favo_customer;
--> statement-breakpoint
GRANT SELECT ON menu_items TO favo_customer;
--> statement-breakpoint

-- ─── 2. Enable RLS (NOT forced — owner still bypasses) ────────────────────────
ALTER TABLE customers             ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE orders                ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE order_items           ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE loyalty_transactions  ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE wallet_transactions   ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE coffee_packs          ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

-- ─── 3. Customer-isolation policies (SELECT only, TO favo_customer) ───────────
-- Own customer row.
DROP POLICY IF EXISTS customer_own_row ON customers;
--> statement-breakpoint
CREATE POLICY customer_own_row ON customers
  FOR SELECT TO favo_customer
  USING (id::text = current_setting('app.current_customer_id', true));
--> statement-breakpoint

-- Own orders.
DROP POLICY IF EXISTS customer_own_orders ON orders;
--> statement-breakpoint
CREATE POLICY customer_own_orders ON orders
  FOR SELECT TO favo_customer
  USING (customer_id::text = current_setting('app.current_customer_id', true));
--> statement-breakpoint

-- Own order_items — reachable only via an order the customer owns.
DROP POLICY IF EXISTS customer_own_order_items ON order_items;
--> statement-breakpoint
CREATE POLICY customer_own_order_items ON order_items
  FOR SELECT TO favo_customer
  USING (
    EXISTS (
      SELECT 1 FROM orders o
      WHERE o.id = order_items.order_id
        AND o.customer_id::text = current_setting('app.current_customer_id', true)
    )
  );
--> statement-breakpoint

-- Own loyalty transactions.
DROP POLICY IF EXISTS customer_own_loyalty ON loyalty_transactions;
--> statement-breakpoint
CREATE POLICY customer_own_loyalty ON loyalty_transactions
  FOR SELECT TO favo_customer
  USING (customer_id::text = current_setting('app.current_customer_id', true));
--> statement-breakpoint

-- Own wallet transactions.
DROP POLICY IF EXISTS customer_own_wallet ON wallet_transactions;
--> statement-breakpoint
CREATE POLICY customer_own_wallet ON wallet_transactions
  FOR SELECT TO favo_customer
  USING (customer_id::text = current_setting('app.current_customer_id', true));
--> statement-breakpoint

-- Own coffee packs.
DROP POLICY IF EXISTS customer_own_packs ON coffee_packs;
--> statement-breakpoint
CREATE POLICY customer_own_packs ON coffee_packs
  FOR SELECT TO favo_customer
  USING (customer_id::text = current_setting('app.current_customer_id', true));
--> statement-breakpoint

-- menu_items: public reference data (needed for item-name joins in
-- listCustomerOrders / getPacks). We intentionally do NOT enable RLS on it —
-- the SELECT grant above is sufficient and, with RLS off, favo_customer reads
-- all menu rows (menu is public). Enabling RLS here would add blast radius to
-- a heavily staff/admin-read table for no isolation benefit, so we leave it off.
