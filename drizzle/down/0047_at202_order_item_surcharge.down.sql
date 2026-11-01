-- AT-202: DOWN for drizzle/0047_at202_order_item_surcharge.sql (PRD §14,
-- "Rollback strategies": every Drizzle migration ships with a tested `down`).
-- Exercised by tests/db/0047-up-down.test.ts (up -> down -> up).
--
-- This file lives in drizzle/down/, which drizzle-kit never reads. Run it by
-- hand, in a transaction, against a database at 0047.
--
-- It refuses, touching nothing, while any order line carries a surcharge:
-- dropping the column would lose which part of a charged total was the
-- extra-shot surcharge, and nothing could recreate it.
--
-- It removes only the three shot settings that still hold the value 0047
-- seeded. A setting an Admin has changed is kept (0037's down drops it with
-- the rest of app_config).
--
-- The last statement forgets 0047 in drizzle's own ledger, so a later
-- `drizzle-kit migrate` re-applies it. 1793219600000 is 0047's `when` in the
-- journal.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "order_items" WHERE "surcharge_zar" <> 0) THEN
    RAISE EXCEPTION 'AT-202/0047 down: order lines carry an extra-shot surcharge — not reverting, nothing changed';
  END IF;
END $$;--> statement-breakpoint
DELETE FROM "app_config" WHERE "tenant_id" = 'hofmi' AND ("key", "value") IN (
  ('extra_shot_zar', '1000'::jsonb),
  ('max_shots_per_line', '4'::jsonb),
  ('max_shots_weekday', '2'::jsonb)
);--> statement-breakpoint
ALTER TABLE "order_items" DROP CONSTRAINT "order_items_surcharge_nonnegative";--> statement-breakpoint
ALTER TABLE "order_items" DROP COLUMN "surcharge_zar";--> statement-breakpoint
DO $$
BEGIN
  IF to_regclass('drizzle.__drizzle_migrations') IS NOT NULL THEN
    DELETE FROM "drizzle"."__drizzle_migrations" WHERE "created_at" = 1793219600000;
  END IF;
END $$;
