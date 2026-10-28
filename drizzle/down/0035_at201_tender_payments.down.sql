-- AT-201: DOWN for drizzle/0035_at201_tender_payments.sql (PRD §14, "Rollback
-- strategies": every Drizzle migration ships with a tested `down`). Exercised
-- by tests/db/0035-up-down.test.ts (up -> down -> up).
--
-- This file lives in drizzle/down/, which drizzle-kit never reads. Run it by
-- hand, in a transaction, against a database at 0035. It returns payments to
-- its 0034 shape (0034 itself, orders.notification_target, does not touch
-- payments, so that is also the 0033 shape).
--
-- It refuses, touching nothing, if any row is a fund top-up (0034 has no home
-- for it) or `unresolved` (0034's enum has no such value, and mapping it to
-- `pending` would hide money nobody has resolved). declined -> failed.
-- Dropping the new columns loses what they hold; that is the point of a down.
--
-- The last statement forgets 0035 in drizzle's own ledger, so a later
-- `drizzle-kit migrate` re-applies it. 1793192327600 is 0035's `when` in the
-- journal.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "payments" WHERE "fund_topup_id" IS NOT NULL OR "status" = 'unresolved') THEN
    RAISE EXCEPTION 'AT-201/0035 down: payments holds fund top-ups or unresolved rows, which 0034 cannot hold — not reverting, nothing changed';
  END IF;
END $$;--> statement-breakpoint
ALTER TABLE "payments" DROP CONSTRAINT "payments_exactly_one_subject";--> statement-breakpoint
ALTER TABLE "payments" DROP CONSTRAINT "payments_order_attempt_unique";--> statement-breakpoint
ALTER TABLE "payments" DROP CONSTRAINT "payments_client_reference_unique";--> statement-breakpoint
DROP INDEX "payments_one_successful_per_fund_topup";--> statement-breakpoint
DROP INDEX "payments_one_successful_per_order";--> statement-breakpoint
ALTER TABLE "payments" ALTER COLUMN "status" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "payments" ALTER COLUMN "status" SET DATA TYPE text;--> statement-breakpoint
DROP TYPE "public"."payment_status";--> statement-breakpoint
CREATE TYPE "public"."payment_status" AS ENUM('pending', 'successful', 'failed', 'refunded', 'deferred');--> statement-breakpoint
ALTER TABLE "payments" ALTER COLUMN "status" SET DATA TYPE "public"."payment_status" USING (CASE "status" WHEN 'declined' THEN 'failed' ELSE "status" END)::"public"."payment_status";--> statement-breakpoint
ALTER TABLE "payments" ALTER COLUMN "status" SET DEFAULT 'pending';--> statement-breakpoint
CREATE UNIQUE INDEX "payments_one_successful_per_order" ON "payments" USING btree ("order_id") WHERE status = 'successful';--> statement-breakpoint
ALTER TABLE "payments" DROP COLUMN "at";--> statement-breakpoint
ALTER TABLE "payments" DROP COLUMN "last_checked_at";--> statement-breakpoint
ALTER TABLE "payments" DROP COLUMN "sent_at";--> statement-breakpoint
ALTER TABLE "payments" DROP COLUMN "settlement_ref";--> statement-breakpoint
ALTER TABLE "payments" DROP COLUMN "receipt_no";--> statement-breakpoint
ALTER TABLE "payments" DROP COLUMN "tip_zar";--> statement-breakpoint
ALTER TABLE "payments" DROP COLUMN "fee_zar";--> statement-breakpoint
ALTER TABLE "payments" DROP COLUMN "charged_amount_zar";--> statement-breakpoint
ALTER TABLE "payments" DROP COLUMN "webpos_device_id";--> statement-breakpoint
ALTER TABLE "payments" DROP COLUMN "client_reference";--> statement-breakpoint
ALTER TABLE "payments" DROP COLUMN "attempt";--> statement-breakpoint
ALTER TABLE "payments" DROP COLUMN "fund_topup_id";--> statement-breakpoint
ALTER TABLE "payments" ALTER COLUMN "order_id" SET NOT NULL;--> statement-breakpoint
DO $$
BEGIN
  IF to_regclass('drizzle.__drizzle_migrations') IS NOT NULL THEN
    DELETE FROM "drizzle"."__drizzle_migrations" WHERE "created_at" = 1793192327600;
  END IF;
END $$;
