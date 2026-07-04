-- Custom SQL migration file, put your code below! --

-- SC03 / SC04: order-to-cup fulfilment percentiles.
--
-- PRD §04 "How verified": measured from orders.placed_at to orders.completed_at.
--   SC03 (normal day)  — p50 must be ≤ 5 minutes.
--   SC04 (Sunday peak) — p95 must not exceed 10 minutes.
-- Previously there was NO query for this; this view IS the verification query.
-- Duration is minutes between placed_at and completed_at; grouped per SAST
-- revenue day (L07) so a normal weekday and a Sunday-peak day can be read off
-- separately. Only collected/completed orders (completed_at NOT NULL) count.

CREATE OR REPLACE VIEW v_order_fulfillment_percentiles AS
SELECT
  (placed_at AT TIME ZONE 'Africa/Johannesburg')::date                        AS sast_date,
  COUNT(*)                                                                     AS completed_orders,
  ROUND(
    percentile_cont(0.5) WITHIN GROUP (
      ORDER BY EXTRACT(EPOCH FROM (completed_at - placed_at)) / 60.0
    )::numeric, 2)                                                             AS p50_minutes,
  ROUND(
    percentile_cont(0.95) WITHIN GROUP (
      ORDER BY EXTRACT(EPOCH FROM (completed_at - placed_at)) / 60.0
    )::numeric, 2)                                                             AS p95_minutes
FROM orders
WHERE completed_at IS NOT NULL
  AND placed_at IS NOT NULL
GROUP BY sast_date;