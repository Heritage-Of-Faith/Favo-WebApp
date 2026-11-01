-- AT-205: DOWN for drizzle/0041_at205_expense_note.sql (PRD §14, "Rollback
-- strategies"). drizzle-kit never reads drizzle/down/; run it by hand, in a
-- transaction, against a database at 0041.
--
-- Dropping the column forgets every expense note. Export expenses(id, note)
-- first if any row has one.
--
-- The last statement forgets 0041 in drizzle's own ledger. 1793195043526 is
-- 0041's `when` in the journal (it travels with the entry if renumbered).

ALTER TABLE "expenses" DROP COLUMN "note";--> statement-breakpoint
DO $$
BEGIN
  IF to_regclass('drizzle.__drizzle_migrations') IS NOT NULL THEN
    DELETE FROM "drizzle"."__drizzle_migrations" WHERE "created_at" = 1793195043526;
  END IF;
END $$;
