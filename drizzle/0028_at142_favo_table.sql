CREATE TABLE "favos" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text DEFAULT 'hofmi' NOT NULL,
	"customer_id" text NOT NULL,
	"items" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by_staff_id" text,
	CONSTRAINT "favos_customer_id_unique" UNIQUE("customer_id")
);
--> statement-breakpoint
ALTER TABLE "favos" ADD CONSTRAINT "favos_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "favos" ADD CONSTRAINT "favos_updated_by_staff_id_staff_id_fk" FOREIGN KEY ("updated_by_staff_id") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;