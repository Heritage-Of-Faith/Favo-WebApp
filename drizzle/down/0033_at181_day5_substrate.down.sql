-- AT-181: DOWN for drizzle/0033_at181_day5_substrate.sql (PRD §14, "Rollback strategies": every
-- Drizzle migration ships with a tested `down`). Exercised by
-- tests/db/0033-up-down.test.ts (up -> down -> up).
--
-- This file lives in drizzle/down/, which drizzle-kit never reads: the
-- migrator applies only the files named in drizzle/meta/_journal.json.
-- Run it by hand, in a transaction, against a database at 0033.
--
-- Schema only. It does not bring back the `Extra Shot` menu_customisations
-- rows that 0033 deleted (data, not schema — re-seed if they are wanted).
-- It refuses (FK error) if staff_entitlement_log holds rows whose
-- customer_id is not also a staff id — those rows cannot go back to 0032.
--
-- The last statement forgets 0033 in drizzle's own ledger, so a later
-- `drizzle-kit migrate` re-applies it. 1791463736190 is 0033's `when` in the
-- journal.

ALTER TABLE "order_items" DROP CONSTRAINT "order_items_quantity_positive";--> statement-breakpoint
ALTER TABLE "order_items" DROP CONSTRAINT "order_items_discount_within_line";--> statement-breakpoint
ALTER TABLE "order_items" DROP COLUMN "comp_reason";--> statement-breakpoint
ALTER TABLE "order_items" DROP COLUMN "discount_zar";--> statement-breakpoint
DROP TYPE "public"."comp_reason";--> statement-breakpoint
DROP INDEX "payments_one_successful_per_order";--> statement-breakpoint
ALTER TABLE "staff_entitlement_log" DROP CONSTRAINT "staff_entitlement_log_customer_id_day_unique";--> statement-breakpoint
ALTER TABLE "staff_entitlement_log" DROP CONSTRAINT "staff_entitlement_log_customer_id_customers_id_fk";--> statement-breakpoint
ALTER TABLE "staff_entitlement_log" RENAME COLUMN "customer_id" TO "staff_id";--> statement-breakpoint
ALTER TABLE "staff_entitlement_log" ADD CONSTRAINT "staff_entitlement_log_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_entitlement_log" ADD CONSTRAINT "staff_entitlement_log_staff_id_day_unique" UNIQUE("staff_id","day");--> statement-breakpoint
ALTER TABLE "orders" DROP COLUMN "revenue_day";--> statement-breakpoint
ALTER TABLE "order_items" DROP CONSTRAINT "order_items_shots_range";--> statement-breakpoint
ALTER TABLE "order_items" DROP COLUMN "shots";--> statement-breakpoint
ALTER TABLE "opening_sessions" DROP COLUMN "mode";--> statement-breakpoint
ALTER TABLE "customers" DROP COLUMN "status";--> statement-breakpoint
ALTER TABLE "customers" DROP COLUMN "surname";--> statement-breakpoint
DROP TYPE "public"."session_mode";--> statement-breakpoint
DROP TYPE "public"."customer_status";--> statement-breakpoint
DO $$
BEGIN
  IF to_regclass('drizzle.__drizzle_migrations') IS NOT NULL THEN
    DELETE FROM "drizzle"."__drizzle_migrations" WHERE "created_at" = 1791463736190;
  END IF;
END $$;
