-- DEC-28 (d): DOWN for drizzle/0054_at204_orders_event_window.sql (PRD §14,
-- "Rollback strategies": every Drizzle migration ships with a tested `down`).
-- Exercised by tests/db/0054-up-down.test.ts (up -> down -> up).
-- PROVISIONAL number 0054 — renumbered in merge order.
--
-- This file lives in drizzle/down/, which drizzle-kit never reads. Run it by
-- hand, in a transaction, against a database at 0054.
--
-- It drops the FK and the column. The event attribution of every order rung
-- since 0054 is lost with it (the order itself, its total and its payments are
-- untouched); 0054 up brings the column back empty.
--
-- The last statement forgets 0054 in drizzle's own ledger, so a later
-- `drizzle-kit migrate` re-applies it. 1793220400000 is 0054's `when` in the
-- journal.

ALTER TABLE "orders" DROP CONSTRAINT "orders_event_window_id_event_windows_id_fk";--> statement-breakpoint
ALTER TABLE "orders" DROP COLUMN "event_window_id";--> statement-breakpoint
DO $$
BEGIN
  IF to_regclass('drizzle.__drizzle_migrations') IS NOT NULL THEN
    DELETE FROM "drizzle"."__drizzle_migrations" WHERE "created_at" = 1793220400000;
  END IF;
END $$;
