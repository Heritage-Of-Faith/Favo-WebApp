-- AT-201: DOWN for drizzle/0036_at201_orders_client_uuid.sql (PRD §14,
-- "Rollback strategies": every Drizzle migration ships with a tested `down`).
-- Exercised by tests/db/0036-up-down.test.ts (up -> down -> up).
--
-- This file lives in drizzle/down/, which drizzle-kit never reads. Run it by
-- hand, in a transaction, against a database at 0036. It returns orders to its
-- 0035 shape.
--
-- It refuses, touching nothing, if any payment's client_reference was derived
-- from an orders.client_uuid (anything not 'legacy:…'): dropping the column
-- would leave those references pointing at a root that no longer exists, and
-- a re-run of 0036 would mint a different one.
--
-- The last statement forgets 0036 in drizzle's own ledger, so a later
-- `drizzle-kit migrate` re-applies it. 1793195383149 is 0036's `when` in the
-- journal.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "payments" WHERE "client_reference" NOT LIKE 'legacy:%') THEN
    RAISE EXCEPTION 'AT-201/0036 down: payments hold client_references derived from orders.client_uuid — not reverting, nothing changed';
  END IF;
END $$;--> statement-breakpoint
ALTER TABLE "orders" DROP CONSTRAINT "orders_client_uuid_unique";--> statement-breakpoint
ALTER TABLE "orders" DROP COLUMN "client_uuid";--> statement-breakpoint
DO $$
BEGIN
  IF to_regclass('drizzle.__drizzle_migrations') IS NOT NULL THEN
    DELETE FROM "drizzle"."__drizzle_migrations" WHERE "created_at" = 1793195383149;
  END IF;
END $$;
