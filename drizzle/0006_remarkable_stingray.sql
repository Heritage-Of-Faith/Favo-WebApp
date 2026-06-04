CREATE TABLE "monthly_reports" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text DEFAULT 'hofmi' NOT NULL,
	"month" text NOT NULL,
	"revenue_zar" integer NOT NULL,
	"cogs_zar" integer NOT NULL,
	"expenses_zar" integer NOT NULL,
	"gross_margin_zar" integer NOT NULL,
	"net_zar" integer NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"admin_sig" jsonb,
	"finance_sig" jsonb,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	CONSTRAINT "monthly_reports_month_unique" UNIQUE("month"),
	CONSTRAINT "monthly_report_closed_requires_both_sigs" CHECK (status != 'closed' OR (admin_sig IS NOT NULL AND finance_sig IS NOT NULL))
);
