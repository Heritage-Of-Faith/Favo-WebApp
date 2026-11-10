-- DOWN for drizzle/0054_deferred_mode_settlement.sql (PRD §14, "Rollback
-- strategies": every Drizzle migration ships with a tested `down`).
-- Exercised by tests/db/0054-up-down.test.ts (up -> down -> up).
-- PROVISIONAL number 0054 — renumbered in merge order.
--
-- This file lives in drizzle/down/, which drizzle-kit never reads. Run it by
-- hand, in a transaction, against a database at 0054.
--
-- It refuses, touching nothing, while any order is settled (settled_at or
-- settlement_ref set) or any session records a deferred entry. Dropping them
-- would lose which deferred orders were settled and by which standalone
-- reference, and the next close would write a settled order off as unpaid.
--
-- The last statement forgets 0054 in drizzle's own ledger, so a later
-- `drizzle-kit migrate` re-applies it. 1793220300000 is 0054's `when` in the
-- journal.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "orders" WHERE "settled_at" IS NOT NULL OR "settlement_ref" IS NOT NULL)
     OR EXISTS (SELECT 1 FROM "opening_sessions" WHERE "deferred_since" IS NOT NULL OR "deferred_entered_by" IS NOT NULL) THEN
    RAISE EXCEPTION '0054 down: settled orders or deferred sessions exist — not reverting, nothing changed';
  END IF;
END $$;--> statement-breakpoint
ALTER TABLE "orders" DROP CONSTRAINT "orders_settled_xor_written_off";--> statement-breakpoint
DROP INDEX "orders_settlement_ref_unique";--> statement-breakpoint
ALTER TABLE "opening_sessions" DROP CONSTRAINT "opening_sessions_deferred_by_staff_id_staff_id_fk";--> statement-breakpoint
ALTER TABLE "orders" DROP COLUMN "settlement_ref";--> statement-breakpoint
ALTER TABLE "orders" DROP COLUMN "settled_at";--> statement-breakpoint
ALTER TABLE "opening_sessions" DROP COLUMN "deferred_entered_by";--> statement-breakpoint
ALTER TABLE "opening_sessions" DROP COLUMN "deferred_by_staff_id";--> statement-breakpoint
ALTER TABLE "opening_sessions" DROP COLUMN "deferred_reason";--> statement-breakpoint
ALTER TABLE "opening_sessions" DROP COLUMN "deferred_since";--> statement-breakpoint
DROP TYPE "public"."deferred_entered_by";--> statement-breakpoint
DO $$
BEGIN
  IF to_regclass('drizzle.__drizzle_migrations') IS NOT NULL THEN
    DELETE FROM "drizzle"."__drizzle_migrations" WHERE "created_at" = 1793220300000;
  END IF;
END $$;
