CREATE TYPE "public"."sync_conflict_kind" AS ENUM('payment_mismatch', 'state_collision', 'duplicate_order');--> statement-breakpoint
CREATE TYPE "public"."sync_conflict_status" AS ENUM('open', 'resolved', 'dismissed');--> statement-breakpoint
CREATE TYPE "public"."wallet_txn_kind" AS ENUM('topup', 'spend', 'refund', 'adjustment');--> statement-breakpoint
ALTER TYPE "public"."payment_status" ADD VALUE 'deferred';--> statement-breakpoint
CREATE TABLE "magic_link_tokens" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text DEFAULT 'hofmi' NOT NULL,
	"email" text NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	CONSTRAINT "magic_link_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "outbox_log" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text DEFAULT 'hofmi' NOT NULL,
	"client_uuid" text NOT NULL,
	"customer_id" text,
	"staff_id" text NOT NULL,
	"payload" jsonb NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"applied_at" timestamp with time zone,
	"conflict_id" text,
	CONSTRAINT "outbox_log_client_uuid_unique" UNIQUE("client_uuid")
);
--> statement-breakpoint
CREATE TABLE "sync_conflicts" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text DEFAULT 'hofmi' NOT NULL,
	"kind" "sync_conflict_kind" NOT NULL,
	"order_id" text,
	"client_payload" jsonb NOT NULL,
	"server_state" jsonb,
	"status" "sync_conflict_status" DEFAULT 'open' NOT NULL,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolved_by" text,
	"resolution_note" text
);
--> statement-breakpoint
CREATE TABLE "wallet_transactions" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text DEFAULT 'hofmi' NOT NULL,
	"customer_id" text NOT NULL,
	"delta_zar" integer NOT NULL,
	"kind" "wallet_txn_kind" NOT NULL,
	"related_order_id" text,
	"related_pending_charge_id" text,
	"description" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "payment_mode" text;--> statement-breakpoint
ALTER TABLE "outbox_log" ADD CONSTRAINT "outbox_log_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbox_log" ADD CONSTRAINT "outbox_log_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbox_log" ADD CONSTRAINT "outbox_log_conflict_id_sync_conflicts_id_fk" FOREIGN KEY ("conflict_id") REFERENCES "public"."sync_conflicts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_conflicts" ADD CONSTRAINT "sync_conflicts_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_conflicts" ADD CONSTRAINT "sync_conflicts_resolved_by_staff_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_transactions" ADD CONSTRAINT "wallet_transactions_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_transactions" ADD CONSTRAINT "wallet_transactions_related_order_id_orders_id_fk" FOREIGN KEY ("related_order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_transactions" ADD CONSTRAINT "wallet_transactions_related_pending_charge_id_pending_charges_id_fk" FOREIGN KEY ("related_pending_charge_id") REFERENCES "public"."pending_charges"("id") ON DELETE no action ON UPDATE no action;