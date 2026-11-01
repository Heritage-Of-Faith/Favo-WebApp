-- AT-203: DOWN for drizzle/0046_at203_blessing_fund.sql (PRD §14, "Rollback
-- strategies": every Drizzle migration ships with a tested `down`).
-- Exercised by tests/db/0046-up-down.test.ts (up -> down -> up).
--
-- This file lives in drizzle/down/, which drizzle-kit never reads. Run it by
-- hand, in a transaction, against a database at 0046.
--
-- It refuses, touching nothing, while any blessing fund exists, or any order
-- is marked payment_mode = 'donor_fund', or any payment points at a fund
-- top-up. Dropping the ledger would lose money the café owes in coffee (DEC-15)
-- and leave fund-paid orders with no record of who paid; nothing could
-- recreate either.
--
-- The last statement forgets 0046 in drizzle's own ledger, so a later
-- `drizzle-kit migrate` re-applies it. 1793219500000 is 0046's `when` in the
-- journal.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "donor_funds")
     OR EXISTS (SELECT 1 FROM "orders" WHERE "payment_mode" = 'donor_fund')
     OR EXISTS (SELECT 1 FROM "payments" WHERE "fund_topup_id" IS NOT NULL) THEN
    RAISE EXCEPTION 'AT-203/0046 down: blessing-fund records exist — not reverting, nothing changed';
  END IF;
END $$;--> statement-breakpoint
ALTER TABLE "payments" DROP CONSTRAINT "payments_fund_topup_attempt_unique";--> statement-breakpoint
ALTER TABLE "payments" DROP CONSTRAINT "payments_fund_topup_id_donor_fund_entries_id_fk";--> statement-breakpoint
DROP TABLE "donor_fund_members";--> statement-breakpoint
DROP TABLE "donor_fund_entries";--> statement-breakpoint
DROP FUNCTION "donor_fund_entries_append_only"();--> statement-breakpoint
DROP TABLE "donor_funds";--> statement-breakpoint
DROP TYPE "public"."funding_method";--> statement-breakpoint
DROP TYPE "public"."donor_fund_entry_kind";--> statement-breakpoint
DO $$
BEGIN
  IF to_regclass('drizzle.__drizzle_migrations') IS NOT NULL THEN
    DELETE FROM "drizzle"."__drizzle_migrations" WHERE "created_at" = 1793219500000;
  END IF;
END $$;
