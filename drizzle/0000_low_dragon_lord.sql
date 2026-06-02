CREATE TYPE "public"."expense_category" AS ENUM('rent', 'utilities', 'staff', 'maintenance', 'marketing', 'other');--> statement-breakpoint
CREATE TYPE "public"."inventory_kind" AS ENUM('bean', 'milk', 'syrup', 'packaging', 'equipment', 'other');--> statement-breakpoint
CREATE TYPE "public"."inventory_unit" AS ENUM('g', 'kg', 'ml', 'l', 'unit', 'bag');--> statement-breakpoint
CREATE TYPE "public"."lot_state" AS ENUM('active', 'depleted', 'expired', 'quarantined');--> statement-breakpoint
CREATE TYPE "public"."loyalty_kind" AS ENUM('earn', 'redeem', 'adjustment', 'expiry');--> statement-breakpoint
CREATE TYPE "public"."menu_category" AS ENUM('coffee', 'tea', 'cold_brew', 'food', 'merchandise', 'other');--> statement-breakpoint
CREATE TYPE "public"."order_state" AS ENUM('ordered', 'in_progress', 'ready', 'collected', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."payment_status" AS ENUM('pending', 'successful', 'failed', 'refunded');--> statement-breakpoint
CREATE TYPE "public"."purchase_kind" AS ENUM('planned', 'emergency');--> statement-breakpoint
CREATE TYPE "public"."refund_status" AS ENUM('pending', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."staff_role" AS ENUM('barista', 'roaster', 'manager', 'admin', 'finance', 'owner');--> statement-breakpoint
CREATE TYPE "public"."stock_movement_kind" AS ENUM('deduction', 'restock', 'waste', 'adjustment', 'stock_take');--> statement-breakpoint
CREATE TYPE "public"."stock_take_kind" AS ENUM('full', 'spot');--> statement-breakpoint
CREATE TYPE "public"."waste_category" AS ENUM('expired', 'damaged', 'spilled', 'overproduction', 'other');--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text DEFAULT 'hofmi' NOT NULL,
	"entity_kind" text NOT NULL,
	"entity_id" text NOT NULL,
	"action" text NOT NULL,
	"actor_id" text,
	"actor_role" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"reason" text
);
--> statement-breakpoint
CREATE TABLE "customers" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text DEFAULT 'hofmi' NOT NULL,
	"email" text,
	"name" text NOT NULL,
	"phone" text,
	"push_subscription" jsonb,
	"loyalty_points" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customers_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "expenses" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text DEFAULT 'hofmi' NOT NULL,
	"category" "expense_category" NOT NULL,
	"amount_zar" integer NOT NULL,
	"incurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"logged_by" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inventory_items" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text DEFAULT 'hofmi' NOT NULL,
	"name" text NOT NULL,
	"kind" "inventory_kind" NOT NULL,
	"unit" "inventory_unit" NOT NULL,
	"low_stock_threshold" integer DEFAULT 0 NOT NULL,
	"origin" text
);
--> statement-breakpoint
CREATE TABLE "inventory_lots" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text DEFAULT 'hofmi' NOT NULL,
	"inventory_item_id" text NOT NULL,
	"source_name" text,
	"batch_number" text,
	"roast_date" timestamp with time zone,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"state" "lot_state" DEFAULT 'active' NOT NULL,
	"origin" text
);
--> statement-breakpoint
CREATE TABLE "loyalty_transactions" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text DEFAULT 'hofmi' NOT NULL,
	"customer_id" text NOT NULL,
	"order_id" text,
	"delta" integer NOT NULL,
	"kind" "loyalty_kind" NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "menu_customisations" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text DEFAULT 'hofmi' NOT NULL,
	"menu_item_id" text NOT NULL,
	"name" text NOT NULL,
	"price_delta_zar" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "menu_items" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text DEFAULT 'hofmi' NOT NULL,
	"name" text NOT NULL,
	"category" "menu_category" NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"current_price_zar" integer NOT NULL,
	"recipe_id" text
);
--> statement-breakpoint
CREATE TABLE "operating_hours" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" text DEFAULT 'hofmi' NOT NULL,
	"day_of_week" integer NOT NULL,
	"open_time" text NOT NULL,
	"close_time" text NOT NULL,
	"is_closed" boolean DEFAULT false NOT NULL,
	"note" text
);
--> statement-breakpoint
CREATE TABLE "order_items" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" text NOT NULL,
	"menu_item_id" text NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"unit_price_zar" integer NOT NULL,
	"modifications" jsonb DEFAULT '[]'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text DEFAULT 'hofmi' NOT NULL,
	"customer_id" text,
	"staff_id" text NOT NULL,
	"state" "order_state" DEFAULT 'ordered' NOT NULL,
	"placed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"total_zar" integer NOT NULL,
	"yoco_payment_id" text,
	"is_staff_discount" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text DEFAULT 'hofmi' NOT NULL,
	"order_id" text NOT NULL,
	"yoco_payment_id" text NOT NULL,
	"amount_zar" integer NOT NULL,
	"status" "payment_status" DEFAULT 'pending' NOT NULL,
	"webhook_received_at" timestamp with time zone,
	CONSTRAINT "payments_yoco_payment_id_unique" UNIQUE("yoco_payment_id")
);
--> statement-breakpoint
CREATE TABLE "price_history" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text DEFAULT 'hofmi' NOT NULL,
	"menu_item_id" text NOT NULL,
	"price_zar" integer NOT NULL,
	"effective_from" timestamp with time zone DEFAULT now() NOT NULL,
	"effective_until" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "purchases" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text DEFAULT 'hofmi' NOT NULL,
	"source_name" text NOT NULL,
	"inventory_lot_id" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"total_zar" integer NOT NULL,
	"kind" "purchase_kind" NOT NULL,
	"admin_approved_by" text,
	CONSTRAINT "emergency_requires_approval" CHECK (kind != 'emergency' OR admin_approved_by IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "recipe_ingredients" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"recipe_id" text NOT NULL,
	"inventory_item_id" text NOT NULL,
	"quantity" integer NOT NULL,
	"unit" "inventory_unit" NOT NULL,
	"tolerance_pct" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recipes" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text DEFAULT 'hofmi' NOT NULL,
	"menu_item_id" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "refunds" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text DEFAULT 'hofmi' NOT NULL,
	"order_id" text NOT NULL,
	"amount_zar" integer NOT NULL,
	"reason" text NOT NULL,
	"requested_by" text NOT NULL,
	"approved_by" text,
	"status" "refund_status" DEFAULT 'pending' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "staff" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text DEFAULT 'hofmi' NOT NULL,
	"name" text NOT NULL,
	"role" "staff_role" NOT NULL,
	"pin_hash" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "staff_entitlement_log" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text DEFAULT 'hofmi' NOT NULL,
	"staff_id" text NOT NULL,
	"applied_by_staff_id" text NOT NULL,
	"order_id" text NOT NULL,
	"day" text NOT NULL,
	CONSTRAINT "staff_entitlement_log_staff_id_day_unique" UNIQUE("staff_id","day")
);
--> statement-breakpoint
CREATE TABLE "stock_alert_recipients" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text DEFAULT 'hofmi' NOT NULL,
	"inventory_item_id" text,
	"staff_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stock_movements" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text DEFAULT 'hofmi' NOT NULL,
	"inventory_lot_id" text NOT NULL,
	"delta" integer NOT NULL,
	"kind" "stock_movement_kind" NOT NULL,
	"related_order_id" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"by_staff_id" text
);
--> statement-breakpoint
CREATE TABLE "stock_take_lines" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"stock_take_id" text NOT NULL,
	"inventory_lot_id" text NOT NULL,
	"expected" integer NOT NULL,
	"counted" integer NOT NULL,
	"variance" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stock_takes" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text DEFAULT 'hofmi' NOT NULL,
	"kind" "stock_take_kind" NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"by_staff_id" text NOT NULL,
	"variance_pct" integer
);
--> statement-breakpoint
CREATE TABLE "waste_log" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text DEFAULT 'hofmi' NOT NULL,
	"category" "waste_category" NOT NULL,
	"inventory_lot_id" text,
	"quantity" integer NOT NULL,
	"reason" text,
	"by_staff_id" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_logged_by_staff_id_fk" FOREIGN KEY ("logged_by") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_lots" ADD CONSTRAINT "inventory_lots_inventory_item_id_inventory_items_id_fk" FOREIGN KEY ("inventory_item_id") REFERENCES "public"."inventory_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loyalty_transactions" ADD CONSTRAINT "loyalty_transactions_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loyalty_transactions" ADD CONSTRAINT "loyalty_transactions_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "menu_customisations" ADD CONSTRAINT "menu_customisations_menu_item_id_menu_items_id_fk" FOREIGN KEY ("menu_item_id") REFERENCES "public"."menu_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_menu_item_id_menu_items_id_fk" FOREIGN KEY ("menu_item_id") REFERENCES "public"."menu_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_history" ADD CONSTRAINT "price_history_menu_item_id_menu_items_id_fk" FOREIGN KEY ("menu_item_id") REFERENCES "public"."menu_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_inventory_lot_id_inventory_lots_id_fk" FOREIGN KEY ("inventory_lot_id") REFERENCES "public"."inventory_lots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_admin_approved_by_staff_id_fk" FOREIGN KEY ("admin_approved_by") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe_ingredients" ADD CONSTRAINT "recipe_ingredients_recipe_id_recipes_id_fk" FOREIGN KEY ("recipe_id") REFERENCES "public"."recipes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipes" ADD CONSTRAINT "recipes_menu_item_id_menu_items_id_fk" FOREIGN KEY ("menu_item_id") REFERENCES "public"."menu_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_requested_by_staff_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_approved_by_staff_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_entitlement_log" ADD CONSTRAINT "staff_entitlement_log_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_entitlement_log" ADD CONSTRAINT "staff_entitlement_log_applied_by_staff_id_staff_id_fk" FOREIGN KEY ("applied_by_staff_id") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_entitlement_log" ADD CONSTRAINT "staff_entitlement_log_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_alert_recipients" ADD CONSTRAINT "stock_alert_recipients_inventory_item_id_inventory_items_id_fk" FOREIGN KEY ("inventory_item_id") REFERENCES "public"."inventory_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_alert_recipients" ADD CONSTRAINT "stock_alert_recipients_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_inventory_lot_id_inventory_lots_id_fk" FOREIGN KEY ("inventory_lot_id") REFERENCES "public"."inventory_lots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_by_staff_id_staff_id_fk" FOREIGN KEY ("by_staff_id") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_take_lines" ADD CONSTRAINT "stock_take_lines_stock_take_id_stock_takes_id_fk" FOREIGN KEY ("stock_take_id") REFERENCES "public"."stock_takes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_take_lines" ADD CONSTRAINT "stock_take_lines_inventory_lot_id_inventory_lots_id_fk" FOREIGN KEY ("inventory_lot_id") REFERENCES "public"."inventory_lots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_takes" ADD CONSTRAINT "stock_takes_by_staff_id_staff_id_fk" FOREIGN KEY ("by_staff_id") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waste_log" ADD CONSTRAINT "waste_log_inventory_lot_id_inventory_lots_id_fk" FOREIGN KEY ("inventory_lot_id") REFERENCES "public"."inventory_lots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waste_log" ADD CONSTRAINT "waste_log_by_staff_id_staff_id_fk" FOREIGN KEY ("by_staff_id") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_log_entity_idx" ON "audit_log" USING btree ("entity_kind","entity_id");--> statement-breakpoint
CREATE INDEX "audit_log_actor_idx" ON "audit_log" USING btree ("actor_id");--> statement-breakpoint
CREATE INDEX "audit_log_at_idx" ON "audit_log" USING btree ("at");