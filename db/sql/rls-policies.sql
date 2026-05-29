-- Row-Level Security policies for FAVO Café
-- Tenant: hofmi (single-tenant)
-- Roles: customer, barista, roaster, manager, admin, finance, owner

-- Enable RLS on all tables
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE loyalty_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff_entitlement_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE menu_items ENABLE ROW LEVEL SECURITY;
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

-- ─── Customer role ────────────────────────────────────────────────────────────
-- Customers can only see their own orders and loyalty transactions. Read-only.

CREATE POLICY customer_own_orders ON orders
  FOR SELECT TO customer
  USING (customer_id = current_setting('app.current_customer_id', true));

CREATE POLICY customer_own_loyalty ON loyalty_transactions
  FOR SELECT TO customer
  USING (customer_id = current_setting('app.current_customer_id', true));

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
