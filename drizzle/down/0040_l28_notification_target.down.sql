-- L28 / REQ-046: DOWN for drizzle/0040_l28_notification_target.sql (PRD §14,
-- "Rollback strategies": every Drizzle migration ships with a tested `down`).
-- Exercised by tests/db/0040-up-down.test.ts (up -> down -> up).
--
-- This file lives in drizzle/down/, which drizzle-kit never reads: the
-- migrator applies only the files named in drizzle/meta/_journal.json.
-- Run it by hand, in a transaction, against a database at 0040.
--
-- The last statement forgets 0040 in drizzle's own ledger, so a later
-- `drizzle-kit migrate` re-applies it. 1793100000000 is 0040's `when` in the
-- journal.

ALTER TABLE "orders" DROP CONSTRAINT "orders_notification_target_customer";--> statement-breakpoint
ALTER TABLE "orders" DROP COLUMN "notification_target";--> statement-breakpoint
DROP TYPE "public"."notification_target";--> statement-breakpoint
DO $$
BEGIN
  IF to_regclass('drizzle.__drizzle_migrations') IS NOT NULL THEN
    DELETE FROM "drizzle"."__drizzle_migrations" WHERE "created_at" = 1793100000000;
  END IF;
END $$;
