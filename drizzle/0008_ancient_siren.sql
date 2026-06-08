CREATE TYPE "public"."charge_kind" AS ENUM('wallet_topup', 'coffee_pack');--> statement-breakpoint
CREATE TABLE "coffee_packs" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text DEFAULT 'hofmi' NOT NULL,
	"customer_id" text NOT NULL,
	"menu_item_id" text NOT NULL,
	"qty_original" integer NOT NULL,
	"qty_remaining" integer NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"pending_charge_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pending_charges" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text DEFAULT 'hofmi' NOT NULL,
	"yoco_checkout_id" text NOT NULL,
	"kind" charge_kind NOT NULL,
	"customer_id" text NOT NULL,
	"amount_zar" integer NOT NULL,
	"status" "payment_status" DEFAULT 'pending' NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pending_charges_yoco_checkout_id_unique" UNIQUE("yoco_checkout_id")
);
--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "wallet_zar" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "coffee_packs" ADD CONSTRAINT "coffee_packs_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coffee_packs" ADD CONSTRAINT "coffee_packs_menu_item_id_menu_items_id_fk" FOREIGN KEY ("menu_item_id") REFERENCES "public"."menu_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coffee_packs" ADD CONSTRAINT "coffee_packs_pending_charge_id_pending_charges_id_fk" FOREIGN KEY ("pending_charge_id") REFERENCES "public"."pending_charges"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pending_charges" ADD CONSTRAINT "pending_charges_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;