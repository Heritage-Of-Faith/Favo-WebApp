-- COGS SQL views — task G13
-- Used by GET /api/cogs/live and the Phase 4 Grafana dashboard.
-- All timestamps are cast to Africa/Johannesburg (SAST = UTC+2) per
-- BUSINESS_RULES.md L07: midnight SAST is the day boundary.
-- Docs: FAVO_PRD_v3.md §04 §07 §10 R10

-- ─── v_daily_revenue ─────────────────────────────────────────────────────────

CREATE OR REPLACE VIEW v_daily_revenue AS
SELECT
  (placed_at AT TIME ZONE 'Africa/Johannesburg')::date AS sast_date,
  SUM(total_zar)                                        AS revenue_zar
FROM orders
WHERE state IN ('in_progress', 'ready', 'collected')
GROUP BY sast_date;

-- ─── v_daily_cogs ─────────────────────────────────────────────────────────────
-- COGS = SUM( -delta * unit_cost_zar ) for deduction movements.
-- unit_cost_zar is numeric(10,4) cents per base unit; delta is integer.
-- Result is cast to integer (ROUND) for storage as integer cents.

CREATE OR REPLACE VIEW v_daily_cogs AS
SELECT
  (sm.at AT TIME ZONE 'Africa/Johannesburg')::date           AS sast_date,
  ROUND(SUM(-sm.delta::numeric * il.unit_cost_zar))::bigint  AS cogs_zar
FROM stock_movements sm
JOIN inventory_lots il ON sm.inventory_lot_id = il.id
WHERE sm.kind = 'deduction'
  AND il.unit_cost_zar IS NOT NULL
GROUP BY sast_date;

-- ─── v_daily_expenses ─────────────────────────────────────────────────────────

CREATE OR REPLACE VIEW v_daily_expenses AS
SELECT
  (incurred_at AT TIME ZONE 'Africa/Johannesburg')::date AS sast_date,
  SUM(amount_zar)                                         AS expenses_zar
FROM expenses
GROUP BY sast_date;

-- ─── v_weekly_variance ───────────────────────────────────────────────────────
-- Weekly margin variance vs previous week — used by Phase 4 Grafana.

CREATE OR REPLACE VIEW v_weekly_variance AS
SELECT
  date_trunc('week', (placed_at AT TIME ZONE 'Africa/Johannesburg'))::date AS week_starting,
  SUM(total_zar) AS revenue_zar
FROM orders
WHERE state IN ('in_progress', 'ready', 'collected')
GROUP BY week_starting;
