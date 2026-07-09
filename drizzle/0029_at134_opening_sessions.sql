CREATE TABLE "opening_sessions" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text DEFAULT 'hofmi' NOT NULL,
	"session_date" text NOT NULL,
	"opens_at" text NOT NULL,
	"closes_at" text,
	"via_pos" boolean DEFAULT false NOT NULL,
	"created_by_staff_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"notified_at" timestamp with time zone,
	CONSTRAINT "opening_sessions_date_opens_unique" UNIQUE("session_date","opens_at")
);
--> statement-breakpoint
ALTER TABLE "opening_sessions" ADD CONSTRAINT "opening_sessions_created_by_staff_id_staff_id_fk" FOREIGN KEY ("created_by_staff_id") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;