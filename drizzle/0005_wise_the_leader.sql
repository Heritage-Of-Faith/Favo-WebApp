CREATE TABLE "low_stock_pings" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text DEFAULT 'hofmi' NOT NULL,
	"inventory_item_id" text NOT NULL,
	"staff_id" text NOT NULL,
	"fired_at" timestamp with time zone DEFAULT now() NOT NULL,
	"stock_at_fire" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "weekly_reports" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text DEFAULT 'hofmi' NOT NULL,
	"week_starting" text NOT NULL,
	"revenue_zar" integer NOT NULL,
	"cogs_zar" integer NOT NULL,
	"expenses_zar" integer NOT NULL,
	"gross_margin_zar" integer NOT NULL,
	"net_zar" integer NOT NULL,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "weekly_reports_week_starting_unique" UNIQUE("week_starting")
);
--> statement-breakpoint
ALTER TABLE "staff" ADD COLUMN "push_subscription" jsonb;--> statement-breakpoint
ALTER TABLE "low_stock_pings" ADD CONSTRAINT "low_stock_pings_inventory_item_id_inventory_items_id_fk" FOREIGN KEY ("inventory_item_id") REFERENCES "public"."inventory_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "low_stock_pings" ADD CONSTRAINT "low_stock_pings_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;