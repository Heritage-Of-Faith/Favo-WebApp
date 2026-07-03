-- Row-Level Security policies for FAVO Café
-- Tenant: hofmi (single-tenant)
--
-- CANONICAL SOURCE: the CUSTOMER-isolation surface (the part actually applied
-- to the live DB) now lives in drizzle/0023_rls_customer_isolation.sql and is
-- applied via `bun db:migrate`. This file is kept IN SYNC with that migration
-- for the customer section and additionally documents the intended
-- staff/barista/admin/finance/owner policy design (aspirational — the live app
-- runs staff/admin/system on the OWNER connection, which bypasses non-forced
-- RLS, so those role policies are not required for correctness today).
--
-- Roles: favo_customer (enforced), barista, admin, finance, owner (design)

-- ─── Customer isolation (ENFORCED — mirrors 0023 migration) ───────────────────
-- Dedicated non-owner, NOLOGIN role. The app SET LOCAL ROLE's to it inside a
-- transaction (src/lib/db-rls.ts → withCustomerScope) and sets
-- app.current_customer_id. RLS is ENABLED (not FORCED) so the owner connection
-- used by staff/admin/system is unaffected.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'favo_customer') THEN
    CREATE ROLE favo_customer NOLOGIN NOINHERIT;
  END IF;
END
$$;
DO $$ BEGIN EXECUTE format('GRANT favo_customer TO %I', current_user); END $$;

GRANT USAGE ON SCHEMA public TO favo_customer;
GRANT SELECT ON customers, orders, order_items, loyalty_transactions,
  wallet_transactions, coffee_packs, menu_items TO favo_customer;

ALTER TABLE customers            ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders               ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_items          ENABLE ROW LEVEL SECURITY;
ALTER TABLE loyalty_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE wallet_transactions  ENABLE ROW LEVEL SECURITY;
ALTER TABLE coffee_packs         ENABLE ROW LEVEL SECURITY;
-- menu_items: public reference data — RLS intentionally NOT enabled (SELECT
-- grant is enough; menu is public). See 0023 migration for rationale.

CREATE POLICY customer_own_row ON customers
  FOR SELECT TO favo_customer
  USING (id::text = current_setting('app.current_customer_id', true));

CREATE POLICY customer_own_orders ON orders
  FOR SELECT TO favo_customer
  USING (customer_id::text = current_setting('app.current_customer_id', true));

CREATE POLICY customer_own_order_items ON order_items
  FOR SELECT TO favo_customer
  USING (EXISTS (
    SELECT 1 FROM orders o
    WHERE o.id = order_items.order_id
      AND o.customer_id::text = current_setting('app.current_customer_id', true)
  ));

CREATE POLICY customer_own_loyalty ON loyalty_transactions
  FOR SELECT TO favo_customer
  USING (customer_id::text = current_setting('app.current_customer_id', true));

CREATE POLICY customer_own_wallet ON wallet_transactions
  FOR SELECT TO favo_customer
  USING (customer_id::text = current_setting('app.current_customer_id', true));

CREATE POLICY customer_own_packs ON coffee_packs
  FOR SELECT TO favo_customer
  USING (customer_id::text = current_setting('app.current_customer_id', true));

-- ─── Staff/admin/finance/owner (DESIGN reference only — not applied) ──────────
-- The live app runs these on the owner connection which bypasses non-forced
-- RLS, so the policies below are documentation of intent, not enforced today.
ALTER TABLE staff ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff_entitlement_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE menu_customisations ENABLE ROW LEVEL SECURITY;
ALTER TABLE price_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_lots ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_takes ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_take_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE waste_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchases ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE refunds ENABLE ROW LEVEL SECURITY;
ALTER TABLE operating_hours ENABLE ROW LEVEL SECURITY;
ALTER TABLE expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;

-- ─── Barista role ─────────────────────────────────────────────────────────────
-- Baristas: RW on orders, order_items, waste_log, staff_entitlement_log
-- RO on customers (name + phone only). No DELETE anywhere.

CREATE POLICY barista_orders_rw ON orders
  FOR ALL TO barista
  USING (true) WITH CHECK (true);

CREATE POLICY barista_order_items_rw ON order_items
  FOR ALL TO barista
  USING (true) WITH CHECK (true);

CREATE POLICY barista_customers_ro ON customers
  FOR SELECT TO barista
  USING (true);

CREATE POLICY barista_waste_log_rw ON waste_log
  FOR ALL TO barista
  USING (true) WITH CHECK (true);

CREATE POLICY barista_entitlement_rw ON staff_entitlement_log
  FOR ALL TO barista
  USING (true) WITH CHECK (true);

CREATE POLICY barista_menu_ro ON menu_items
  FOR SELECT TO barista
  USING (true);

CREATE POLICY barista_customisations_ro ON menu_customisations
  FOR SELECT TO barista
  USING (true);

-- ─── Admin role ───────────────────────────────────────────────────────────────
-- Admins: everything barista has + price_history, operating_hours, refund approval

CREATE POLICY admin_all ON orders FOR ALL TO admin USING (true) WITH CHECK (true);
CREATE POLICY admin_customers_all ON customers FOR ALL TO admin USING (true) WITH CHECK (true);
CREATE POLICY admin_menu_rw ON menu_items FOR ALL TO admin USING (true) WITH CHECK (true);
CREATE POLICY admin_price_history_rw ON price_history FOR ALL TO admin USING (true) WITH CHECK (true);
CREATE POLICY admin_operating_hours_rw ON operating_hours FOR ALL TO admin USING (true) WITH CHECK (true);
CREATE POLICY admin_refunds_rw ON refunds FOR ALL TO admin USING (true) WITH CHECK (true);
CREATE POLICY admin_staff_rw ON staff FOR ALL TO admin USING (true) WITH CHECK (true);
CREATE POLICY admin_inventory_rw ON inventory_items FOR ALL TO admin USING (true) WITH CHECK (true);
CREATE POLICY admin_lots_rw ON inventory_lots FOR ALL TO admin USING (true) WITH CHECK (true);
CREATE POLICY admin_purchases_rw ON purchases FOR ALL TO admin USING (true) WITH CHECK (true);
CREATE POLICY admin_expenses_rw ON expenses FOR ALL TO admin USING (true) WITH CHECK (true);
CREATE POLICY admin_audit_ro ON audit_log FOR SELECT TO admin USING (true);

-- ─── Finance role ─────────────────────────────────────────────────────────────
-- Finance: SELECT-only across all financial tables

CREATE POLICY finance_orders_ro ON orders FOR SELECT TO finance USING (true);
CREATE POLICY finance_payments_ro ON payments FOR SELECT TO finance USING (true);
CREATE POLICY finance_refunds_ro ON refunds FOR SELECT TO finance USING (true);
CREATE POLICY finance_expenses_ro ON expenses FOR SELECT TO finance USING (true);
CREATE POLICY finance_audit_ro ON audit_log FOR SELECT TO finance USING (true);
CREATE POLICY finance_loyalty_ro ON loyalty_transactions FOR SELECT TO finance USING (true);

-- ─── Owner role ───────────────────────────────────────────────────────────────
-- Owner: all admin permissions + finance permissions

CREATE POLICY owner_all_orders ON orders FOR ALL TO owner USING (true) WITH CHECK (true);
CREATE POLICY owner_all_customers ON customers FOR ALL TO owner USING (true) WITH CHECK (true);
CREATE POLICY owner_all_staff ON staff FOR ALL TO owner USING (true) WITH CHECK (true);
CREATE POLICY owner_all_menu ON menu_items FOR ALL TO owner USING (true) WITH CHECK (true);
CREATE POLICY owner_all_inventory ON inventory_items FOR ALL TO owner USING (true) WITH CHECK (true);
CREATE POLICY owner_all_payments ON payments FOR ALL TO owner USING (true) WITH CHECK (true);
CREATE POLICY owner_all_refunds ON refunds FOR ALL TO owner USING (true) WITH CHECK (true);
CREATE POLICY owner_all_expenses ON expenses FOR ALL TO owner USING (true) WITH CHECK (true);
CREATE POLICY owner_audit_ro ON audit_log FOR SELECT TO owner USING (true);
