-- favo:requires-approval rewrites the v_daily_revenue view over orders, payments and donor_fund_entries (reads only; no row, column or constraint changes)
-- AT-203 follow-up: an abandoned fund-paid order is revenue.
-- Spec: docs/FAVO_PRD_v7.md §6.10.4 ("Each draw recognises its own revenue at
-- normal margin"), §6.10.5 and REQ-168 (cancelOrder gives a draw back with a
-- compensating `adjustment` entry), L47 (a fund draw is a tender and writes no
-- payments row), §6.0.7 T6 step 2b (abandon "reverses nothing"). Owner
-- decision, Mia, 3 Nov 2026: a fund draw on an order that is then abandoned
-- counts as revenue, exactly like an abandoned card-paid order.
--
-- v_daily_revenue (0045) also counts a CANCELLED order that holds a
-- donor_fund_entries `spend` entry and no `adjustment` entry for it. A
-- cancelled order whose draw was given back still never counts. Same
-- predicate as src/server/reports/revenue-scope.ts (hand-written; drizzle-kit
-- does not track views, so the 0050 snapshot equals 0049's).
--
-- Re-runnable (CREATE OR REPLACE). The reverse is
-- drizzle/down/0050_at203_fund_abandon_revenue.down.sql.

CREATE OR REPLACE VIEW v_daily_revenue AS
SELECT
  (placed_at AT TIME ZONE 'Africa/Johannesburg')::date AS sast_date,
  SUM(total_zar)                                        AS revenue_zar
FROM orders
WHERE (orders.state IN ('in_progress', 'ready', 'collected') OR (orders.state = 'cancelled' AND EXISTS (SELECT 1 FROM payments rp WHERE rp.order_id = orders.id AND rp.status = 'successful')) OR (orders.state = 'cancelled' AND EXISTS (SELECT 1 FROM donor_fund_entries fs WHERE fs.order_id = orders.id AND fs.kind = 'spend') AND NOT EXISTS (SELECT 1 FROM donor_fund_entries fa WHERE fa.order_id = orders.id AND fa.kind = 'adjustment')))
GROUP BY sast_date;
