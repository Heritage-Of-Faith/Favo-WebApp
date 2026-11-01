-- AT-191: DOWN for drizzle/0039_at191_lot_cost_source.sql (PRD §14, "Rollback
-- strategies"). drizzle-kit never reads drizzle/down/; run it by hand, in a
-- transaction, against a database at 0039.
--
-- Dropping the column forgets which lots an Admin recosted against an invoice.
-- Export inventory_lots(id, cost_source) first if any lot reads 'invoice'.
--
-- The last statement forgets 0039 in drizzle's own ledger. 1793040474308 is
-- 0039's `when` in the journal (it travels with the entry if renumbered).

ALTER TABLE "inventory_lots" DROP COLUMN "cost_source";--> statement-breakpoint
DROP TYPE "public"."cost_source";--> statement-breakpoint
DO $$
BEGIN
  IF to_regclass('drizzle.__drizzle_migrations') IS NOT NULL THEN
    DELETE FROM "drizzle"."__drizzle_migrations" WHERE "created_at" = 1793040474308;
  END IF;
END $$;
