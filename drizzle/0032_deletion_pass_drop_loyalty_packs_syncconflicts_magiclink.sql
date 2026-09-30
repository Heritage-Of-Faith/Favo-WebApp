ALTER TABLE "coffee_packs" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "loyalty_transactions" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "magic_link_tokens" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "pack_redemptions" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "pending_charges" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sync_conflicts" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "coffee_packs" CASCADE;--> statement-breakpoint
DROP TABLE "loyalty_transactions" CASCADE;--> statement-breakpoint
DROP TABLE "magic_link_tokens" CASCADE;--> statement-breakpoint
DROP TABLE "pack_redemptions" CASCADE;--> statement-breakpoint
DROP TABLE "pending_charges" CASCADE;--> statement-breakpoint
DROP TABLE "sync_conflicts" CASCADE;--> statement-breakpoint
ALTER TABLE "customers" DROP CONSTRAINT "customers_loyalty_points_non_negative";--> statement-breakpoint
ALTER TABLE "customers" DROP COLUMN "loyalty_points";--> statement-breakpoint
ALTER TABLE "outbox_log" DROP COLUMN "conflict_id";--> statement-breakpoint
DROP TYPE "public"."charge_kind";--> statement-breakpoint
DROP TYPE "public"."loyalty_kind";--> statement-breakpoint
DROP TYPE "public"."sync_conflict_kind";--> statement-breakpoint
DROP TYPE "public"."sync_conflict_status";