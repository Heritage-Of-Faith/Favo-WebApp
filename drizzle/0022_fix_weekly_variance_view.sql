-- F10 / SC07: v_weekly_variance now reports real INVENTORY variance per ISO week.
--
-- The prior definition (drizzle/0004_cogs_views.sql) summed order revenue and
-- mislabelled it "variance" — it exposed columns (week_starting, revenue_zar)
-- that have nothing to do with stock variance. SC07's target is inventory
-- variance under 5% weekly; the source of truth is stock_takes.variance_pct.
--
-- Column set changes (revenue_zar dropped), so CREATE OR REPLACE is not enough
-- (Postgres only allows adding trailing columns via REPLACE). DROP first.
-- Only external Grafana reads this view — no app code selects from it
-- (verified: grep of src/ finds v_daily_revenue usage only, never
-- v_weekly_variance). Timestamps cast to Africa/Johannesburg per L07.

DROP VIEW IF EXISTS v_weekly_variance;
--> statement-breakpoint

CREATE VIEW v_weekly_variance AS
SELECT
  date_trunc(
    'week',
    (completed_at AT TIME ZONE 'Africa/Johannesburg')
  )::date                                              AS week_starting,
  COUNT(*)                                             AS stock_take_count,
  ROUND(AVG(ABS(variance_pct)), 2)                     AS avg_abs_variance_pct,
  MAX(ABS(variance_pct))                               AS max_abs_variance_pct,
  bool_or(ABS(variance_pct) >= 5)                      AS breaches_threshold
FROM stock_takes
WHERE completed_at IS NOT NULL
  AND variance_pct IS NOT NULL
GROUP BY week_starting;
