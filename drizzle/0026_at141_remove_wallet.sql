-- AT-141: remove the stored-value wallet entirely (locked decision, see
-- docs/POS_REBUILD_DECISIONS.md). Verified against prod before writing this:
-- 0 of 6 customers have wallet_zar > 0, 0 wallet_transactions rows ever,
-- 0 pending_charges rows (any status) with kind = 'wallet_topup', 0 orders
-- with payment_mode = 'wallet' — clean deletion, no data migration needed.

ALTER TABLE "wallet_transactions" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "wallet_transactions" CASCADE;--> statement-breakpoint
ALTER TABLE "customers" DROP CONSTRAINT "customers_wallet_zar_non_negative";--> statement-breakpoint
ALTER TABLE "customers" DROP COLUMN "wallet_zar";--> statement-breakpoint
ALTER TABLE "public"."pending_charges" ALTER COLUMN "kind" SET DATA TYPE text;--> statement-breakpoint
DROP TYPE "public"."charge_kind";--> statement-breakpoint
CREATE TYPE "public"."charge_kind" AS ENUM('coffee_pack');--> statement-breakpoint
ALTER TABLE "public"."pending_charges" ALTER COLUMN "kind" SET DATA TYPE "public"."charge_kind" USING "kind"::"public"."charge_kind";--> statement-breakpoint
DROP TYPE "public"."wallet_txn_kind";