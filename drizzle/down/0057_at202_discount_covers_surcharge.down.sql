-- AT-202 part 2: DOWN for drizzle/0057_at202_discount_covers_surcharge.sql
-- (PRD §14, "Rollback strategies": every Drizzle migration ships with a
-- tested `down`). Exercised by tests/db/0057-up-down.test.ts (up -> down -> up).
--
-- This file lives in drizzle/down/, which drizzle-kit never reads. Run it by
-- hand, in a transaction, against a database at 0057.
--
-- It puts back 0033's narrower floor,
--   discount_zar <= quantity * (unit_price_zar + mods_zar).
-- It refuses, touching nothing, while any order line is discounted past that
-- floor — a voucher or comp that zeroed an extra-shot surcharge. Those
-- discounts are real money decisions already booked; the narrow CHECK cannot
-- hold them and nothing here may rewrite them.
--
-- The last statement forgets 0057 in drizzle's own ledger, so a later
-- `drizzle-kit migrate` re-applies it. 1793220600000 is 0057's `when` in the
-- journal.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "order_items" WHERE "discount_zar" > "quantity" * ("unit_price_zar" + "mods_zar")
  ) THEN
    RAISE EXCEPTION 'AT-202/0057 down: order lines carry a discount that covers an extra-shot surcharge — not reverting, nothing changed';
  END IF;
END $$;--> statement-breakpoint
ALTER TABLE "order_items" DROP CONSTRAINT "order_items_discount_within_line";--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_discount_within_line" CHECK (discount_zar <= quantity * (unit_price_zar + mods_zar));--> statement-breakpoint
DO $$
BEGIN
  IF to_regclass('drizzle.__drizzle_migrations') IS NOT NULL THEN
    DELETE FROM "drizzle"."__drizzle_migrations" WHERE "created_at" = 1793220600000;
  END IF;
END $$;
