-- DOWN for drizzle/0056_barista_rota.sql (PRD §14, "Rollback strategies":
-- every Drizzle migration ships with a tested `down`).
-- Exercised by tests/db/0056-up-down.test.ts (up -> down -> up).
--
-- This file lives in drizzle/down/, which drizzle-kit never reads. Run it by
-- hand, in a transaction, against a database at 0056.
--
-- It drops the barista_shifts table (its three FKs go with it). The rota and
-- the record of which shift-start pushes were sent are lost; sessions, staff
-- and the audit_log rows the rota actions wrote are untouched. 0056 up brings
-- the table back empty.
--
-- The last statement forgets 0056 in drizzle's own ledger, so a later
-- `drizzle-kit migrate` re-applies it. 1793220500000 is 0056's `when` in the
-- journal.

DROP TABLE "barista_shifts";--> statement-breakpoint
DO $$
BEGIN
  IF to_regclass('drizzle.__drizzle_migrations') IS NOT NULL THEN
    DELETE FROM "drizzle"."__drizzle_migrations" WHERE "created_at" = 1793220500000;
  END IF;
END $$;
