-- DOWN for drizzle/0051_payment_mode_not_null.sql (PRD §14, "Rollback
-- strategies": every Drizzle migration ships with a tested `down`).
-- Exercised by tests/db/0051-up-down.test.ts (up -> down -> up).
--
-- This file lives in drizzle/down/, which drizzle-kit never reads. Run it by
-- hand, in a transaction, against a database at 0051.
--
-- It drops the NOT NULL. It does NOT put the backfilled NULLs back: up wrote
-- 'yoco' where NULL stood, and NULL meant 'yoco' by convention (§10.3 L2499),
-- so the rows mean the same either way and nothing records which ones were
-- NULL. Reverting the constraint loses no data.
--
-- The last statement forgets 0051 in drizzle's own ledger, so a later
-- `drizzle-kit migrate` re-applies it. 1793220000000 is 0051's `when` in the
-- journal.

ALTER TABLE "orders" ALTER COLUMN "payment_mode" DROP NOT NULL;--> statement-breakpoint
DO $$
BEGIN
  IF to_regclass('drizzle.__drizzle_migrations') IS NOT NULL THEN
    DELETE FROM "drizzle"."__drizzle_migrations" WHERE "created_at" = 1793220000000;
  END IF;
END $$;
