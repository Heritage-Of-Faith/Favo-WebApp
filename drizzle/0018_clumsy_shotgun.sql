ALTER TYPE "public"."inventory_unit" ADD VALUE 'cup';--> statement-breakpoint
ALTER TYPE "public"."lot_state" ADD VALUE 'open';--> statement-breakpoint
ALTER TYPE "public"."lot_state" ADD VALUE 'closed';--> statement-breakpoint
ALTER TABLE "inventory_lots" ADD COLUMN "opened_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "inventory_lots" ADD COLUMN "closed_at" timestamp with time zone;