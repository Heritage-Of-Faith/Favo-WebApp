-- AT-203 follow-up: DOWN for drizzle/0050_at203_fund_abandon_revenue.sql (PRD
-- §14, "Rollback strategies": every Drizzle migration ships with a tested
-- `down`). Exercised by tests/db/0050-up-down.test.ts (up -> down -> up).
--
-- This file lives in drizzle/down/, which drizzle-kit never reads. Run it by
-- hand, in a transaction, against a database at 0050.
--
-- It restores v_daily_revenue to its 0045 text (started states, plus a
-- cancelled order holding a successful payment). Only a view changes, so
-- there is no data to lose and nothing to refuse on.
--
-- The last statement forgets 0050 in drizzle's own ledger, so a later
-- `drizzle-kit migrate` re-applies it. 1793219900000 is 0050's `when` in the
-- journal.

CREATE OR REPLACE VIEW v_daily_revenue AS
SELECT
  (placed_at AT TIME ZONE 'Africa/Johannesburg')::date AS sast_date,
  SUM(total_zar)                                        AS revenue_zar
FROM orders
WHERE (orders.state IN ('in_progress', 'ready', 'collected') OR (orders.state = 'cancelled' AND EXISTS (SELECT 1 FROM payments rp WHERE rp.order_id = orders.id AND rp.status = 'successful')))
GROUP BY sast_date;--> statement-breakpoint
DO $$
BEGIN
  IF to_regclass('drizzle.__drizzle_migrations') IS NOT NULL THEN
    DELETE FROM "drizzle"."__drizzle_migrations" WHERE "created_at" = 1793219900000;
  END IF;
END $$;
