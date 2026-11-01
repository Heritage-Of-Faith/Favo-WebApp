-- AT-209: DOWN for drizzle/0045_at209_comps_cancel_abandon.sql (PRD §14,
-- "Rollback strategies": every Drizzle migration ships with a tested `down`).
-- Exercised by tests/db/0045-up-down.test.ts (up -> down -> up).
--
-- This file lives in drizzle/down/, which drizzle-kit never reads. Run it by
-- hand, in a transaction, against a database at 0045.
--
-- It refuses, touching nothing, while any row uses what 0045 added: an
-- 'abandoned' waste row or a waste row naming its order (the per-barista
-- abandoned count would be lost), or an audit row naming an overriding admin
-- (audit_log is append-only forever, PRD §10.3.2 — dropping the column would
-- erase who authorised an override).
--
-- It restores v_daily_revenue to its 0004 text (started states only).
--
-- The last statement forgets 0045 in drizzle's own ledger, so a later
-- `drizzle-kit migrate` re-applies it. 1793215000000 is 0045's `when` in the
-- journal.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "waste_log" WHERE "category"::text = 'abandoned' OR "order_id" IS NOT NULL)
     OR EXISTS (SELECT 1 FROM "audit_log" WHERE "on_behalf_of_staff_id" IS NOT NULL) THEN
    RAISE EXCEPTION 'AT-209/0045 down: abandoned waste rows or admin-override audit rows exist — not reverting, nothing changed';
  END IF;
END $$;--> statement-breakpoint
CREATE OR REPLACE VIEW v_daily_revenue AS
SELECT
  (placed_at AT TIME ZONE 'Africa/Johannesburg')::date AS sast_date,
  SUM(total_zar)                                        AS revenue_zar
FROM orders
WHERE state IN ('in_progress', 'ready', 'collected')
GROUP BY sast_date;--> statement-breakpoint
ALTER TABLE "waste_log" DROP CONSTRAINT "waste_log_order_id_orders_id_fk";--> statement-breakpoint
ALTER TABLE "audit_log" DROP CONSTRAINT "audit_log_on_behalf_of_staff_id_staff_id_fk";--> statement-breakpoint
ALTER TABLE "waste_log" DROP COLUMN "order_id";--> statement-breakpoint
ALTER TABLE "audit_log" DROP COLUMN "on_behalf_of_staff_id";--> statement-breakpoint
ALTER TABLE "waste_log" ALTER COLUMN "category" SET DATA TYPE text;--> statement-breakpoint
DROP TYPE "public"."waste_category";--> statement-breakpoint
CREATE TYPE "public"."waste_category" AS ENUM('expired', 'damaged', 'spilled', 'overproduction', 'other');--> statement-breakpoint
ALTER TABLE "waste_log" ALTER COLUMN "category" SET DATA TYPE "public"."waste_category" USING "category"::"public"."waste_category";--> statement-breakpoint
DO $$
BEGIN
  IF to_regclass('drizzle.__drizzle_migrations') IS NOT NULL THEN
    DELETE FROM "drizzle"."__drizzle_migrations" WHERE "created_at" = 1793215000000;
  END IF;
END $$;
