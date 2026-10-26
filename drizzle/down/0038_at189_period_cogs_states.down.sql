-- AT-189 / AT-190 / AT-192: DOWN for drizzle/0038_at189_period_cogs_states.sql
-- (PRD §14, "Rollback strategies"). drizzle-kit never reads drizzle/down/; run
-- it by hand, in a transaction, against a database at 0038 (after 0039's down).
--
-- Restoring NOT NULL fails if any weekly/monthly report was stored UNAVAILABLE
-- (cogs_zar NULL). That is deliberate: such a report has no number to restore,
-- and inventing a 0 is the silent zero the refusal rule forbids. Delete or
-- export those rows first.
--
-- v_daily_cogs is NOT recreated: no code reads it any more, and it computes the
-- period-rounded, absent-cost-dropping figure REQ-106/REQ-109 forbid. If a
-- rollback truly needs it, re-run its CREATE VIEW from drizzle/0004_cogs_views.sql.
--
-- The last statement forgets 0038 in drizzle's own ledger. 1793040427567 is
-- 0038's `when` in the journal (it travels with the entry if renumbered).

ALTER TABLE "weekly_reports" DROP CONSTRAINT "weekly_report_cogs_or_unavailable";--> statement-breakpoint
ALTER TABLE "monthly_reports" DROP CONSTRAINT "monthly_report_cogs_or_unavailable";--> statement-breakpoint
ALTER TABLE "weekly_reports" DROP COLUMN "orders_without_cost";--> statement-breakpoint
ALTER TABLE "monthly_reports" DROP COLUMN "orders_without_cost";--> statement-breakpoint
ALTER TABLE "weekly_reports" DROP COLUMN "cogs_absent_items";--> statement-breakpoint
ALTER TABLE "weekly_reports" DROP COLUMN "cost_state";--> statement-breakpoint
ALTER TABLE "monthly_reports" DROP COLUMN "cogs_absent_items";--> statement-breakpoint
ALTER TABLE "monthly_reports" DROP COLUMN "cost_state";--> statement-breakpoint
ALTER TABLE "weekly_reports" ALTER COLUMN "net_zar" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "weekly_reports" ALTER COLUMN "gross_margin_zar" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "weekly_reports" ALTER COLUMN "cogs_zar" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "monthly_reports" ALTER COLUMN "net_zar" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "monthly_reports" ALTER COLUMN "gross_margin_zar" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "monthly_reports" ALTER COLUMN "cogs_zar" SET NOT NULL;--> statement-breakpoint
DROP TYPE "public"."report_cost_state";--> statement-breakpoint
DO $$
BEGIN
  IF to_regclass('drizzle.__drizzle_migrations') IS NOT NULL THEN
    DELETE FROM "drizzle"."__drizzle_migrations" WHERE "created_at" = 1793040427567;
  END IF;
END $$;
