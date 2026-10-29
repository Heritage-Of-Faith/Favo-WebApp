-- AT-207: DOWN for drizzle/0047_at207_daily_closes_writeoffs.sql (PRD §14,
-- "Rollback strategies": every Drizzle migration ships with a tested `down`).
-- Exercised by tests/db/0047-up-down.test.ts (up -> down -> up).
--
-- This file lives in drizzle/down/, which drizzle-kit never reads. Run it by
-- hand, in a transaction, against a database at 0047.
--
-- It refuses, touching nothing, while any close record exists or any order is
-- written off. Dropping either would lose which days were closed and which
-- orders were written off as a loss, and nothing could recreate them (the
-- next close would sweep the same orders again as if new).
--
-- The last statement forgets 0047 in drizzle's own ledger, so a later
-- `drizzle-kit migrate` re-applies it. 1793219700000 is 0047's `when` in the
-- journal.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "daily_closes")
     OR EXISTS (SELECT 1 FROM "orders" WHERE "written_off_at" IS NOT NULL) THEN
    RAISE EXCEPTION 'AT-207/0047 down: close records or written-off orders exist — not reverting, nothing changed';
  END IF;
END $$;--> statement-breakpoint
ALTER TABLE "orders" DROP COLUMN "written_off_at";--> statement-breakpoint
DROP TABLE "daily_closes";--> statement-breakpoint
DO $$
BEGIN
  IF to_regclass('drizzle.__drizzle_migrations') IS NOT NULL THEN
    DELETE FROM "drizzle"."__drizzle_migrations" WHERE "created_at" = 1793219700000;
  END IF;
END $$;
