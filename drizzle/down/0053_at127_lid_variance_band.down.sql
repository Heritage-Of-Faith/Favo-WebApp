-- REQ-127: DOWN for drizzle/0053_at127_lid_variance_band.sql (PRD §14,
-- "Rollback strategies": every Drizzle migration ships with a tested `down`).
-- Exercised by tests/db/0053-up-down.test.ts (up -> down -> up).
-- PROVISIONAL number 0053 — renumbered in merge order.
--
-- This file lives in drizzle/down/, which drizzle-kit never reads. Run it by
-- hand, in a transaction, against a database at 0053.
--
-- It restores v_weekly_variance to its 0022 text (the view loses four trailing
-- columns, so CREATE OR REPLACE cannot do it: DROP, then CREATE), removes the
-- variance_bands row only while it still holds the value 0053 seeded (an
-- Admin's change is kept; 0037's down drops it with the rest of app_config),
-- and drops inventory_items.is_lid (only the seeded lid carries it; 0053 up
-- sets it again).
--
-- The last statement forgets 0053 in drizzle's own ledger, so a later
-- `drizzle-kit migrate` re-applies it. 1793220200000 is 0053's `when` in the
-- journal.

DROP VIEW IF EXISTS v_weekly_variance;--> statement-breakpoint
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
GROUP BY week_starting;--> statement-breakpoint
DELETE FROM "app_config" WHERE "tenant_id" = 'hofmi' AND "key" = 'variance_bands' AND "value" = '{"lid": 25}'::jsonb;--> statement-breakpoint
ALTER TABLE "inventory_items" DROP COLUMN "is_lid";--> statement-breakpoint
DO $$
BEGIN
  IF to_regclass('drizzle.__drizzle_migrations') IS NOT NULL THEN
    DELETE FROM "drizzle"."__drizzle_migrations" WHERE "created_at" = 1793220200000;
  END IF;
END $$;
