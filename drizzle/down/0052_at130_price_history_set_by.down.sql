-- REQ-130: DOWN for drizzle/0052_at130_price_history_set_by.sql (PRD §14,
-- "Rollback strategies": every Drizzle migration ships with a tested `down`).
-- Exercised by tests/db/0052-up-down.test.ts (up -> down -> up).
-- PROVISIONAL number 0052 — renumbered in merge order.
--
-- This file lives in drizzle/down/, which drizzle-kit never reads. Run it by
-- hand, in a transaction, against a database at 0052.
--
-- It refuses, touching nothing, while any price_history row exists: dropping
-- the column would lose who set each price, and nothing could recreate it.
--
-- The last statement forgets 0052 in drizzle's own ledger, so a later
-- `drizzle-kit migrate` re-applies it. 1793220100000 is 0052's `when` in the
-- journal.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "price_history") THEN
    RAISE EXCEPTION 'REQ-130/0052 down: price_history rows record who set each price — not reverting, nothing changed';
  END IF;
END $$;--> statement-breakpoint
ALTER TABLE "price_history" DROP CONSTRAINT "price_history_set_by_staff_id_staff_id_fk";--> statement-breakpoint
ALTER TABLE "price_history" DROP COLUMN "set_by_staff_id";--> statement-breakpoint
DO $$
BEGIN
  IF to_regclass('drizzle.__drizzle_migrations') IS NOT NULL THEN
    DELETE FROM "drizzle"."__drizzle_migrations" WHERE "created_at" = 1793220100000;
  END IF;
END $$;
