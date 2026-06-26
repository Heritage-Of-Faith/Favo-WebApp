-- Container model enum changes.
-- We recreate the enums (CREATE TYPE) instead of using ALTER TYPE ... ADD VALUE
-- so the new values are usable in the SAME migration transaction — the partial
-- unique index in 0019 references 'open', and drizzle-kit applies the pending
-- migrations in one transaction (a fresh CI DB runs 0000..0019 together).
-- ADD VALUE would raise "unsafe use of new value" there.

-- lot_state += open, closed
ALTER TABLE "inventory_lots" ALTER COLUMN "state" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "public"."inventory_lots" ALTER COLUMN "state" SET DATA TYPE text;--> statement-breakpoint
DROP TYPE "public"."lot_state";--> statement-breakpoint
CREATE TYPE "public"."lot_state" AS ENUM('active', 'depleted', 'expired', 'quarantined', 'open', 'closed');--> statement-breakpoint
ALTER TABLE "public"."inventory_lots" ALTER COLUMN "state" SET DATA TYPE "public"."lot_state" USING "state"::"public"."lot_state";--> statement-breakpoint
ALTER TABLE "inventory_lots" ALTER COLUMN "state" SET DEFAULT 'active';--> statement-breakpoint

-- inventory_unit += cup
ALTER TABLE "public"."inventory_items" ALTER COLUMN "unit" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "public"."recipe_ingredients" ALTER COLUMN "unit" SET DATA TYPE text;--> statement-breakpoint
DROP TYPE "public"."inventory_unit";--> statement-breakpoint
CREATE TYPE "public"."inventory_unit" AS ENUM('g', 'kg', 'ml', 'l', 'unit', 'bag', 'cup');--> statement-breakpoint
ALTER TABLE "public"."inventory_items" ALTER COLUMN "unit" SET DATA TYPE "public"."inventory_unit" USING "unit"::"public"."inventory_unit";--> statement-breakpoint
ALTER TABLE "public"."recipe_ingredients" ALTER COLUMN "unit" SET DATA TYPE "public"."inventory_unit" USING "unit"::"public"."inventory_unit";--> statement-breakpoint

-- Container open/close timestamps
ALTER TABLE "inventory_lots" ADD COLUMN "opened_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "inventory_lots" ADD COLUMN "closed_at" timestamp with time zone;
