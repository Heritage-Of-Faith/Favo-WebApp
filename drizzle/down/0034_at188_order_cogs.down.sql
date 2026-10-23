-- AT-188: DOWN for drizzle/0034_at188_order_cogs.sql (PRD §14, "Rollback
-- strategies": every Drizzle migration ships with a tested `down`). Exercised
-- by tests/db/0034-up-down.test.ts (up -> down -> up).
--
-- This file lives in drizzle/down/, which drizzle-kit never reads: the
-- migrator applies only the files named in drizzle/meta/_journal.json.
-- Run it by hand, in a transaction, against a database at 0034.
--
-- Dropping the table discards every frozen order_cogs row. Those figures are
-- the cost AT THE SALE and cannot be rebuilt later from today's lot costs, so
-- export the table first if it holds real orders.
--
-- The last statement forgets 0034 in drizzle's own ledger, so a later
-- `drizzle-kit migrate` re-applies it. 1792752696811 is 0034's `when` in the
-- journal. (If 0034 is renumbered, update this comment, the file name and
-- nothing else — the `when` travels with the journal entry.)

DROP TABLE "order_cogs";--> statement-breakpoint
DO $$
BEGIN
  IF to_regclass('drizzle.__drizzle_migrations') IS NOT NULL THEN
    DELETE FROM "drizzle"."__drizzle_migrations" WHERE "created_at" = 1792752696811;
  END IF;
END $$;
