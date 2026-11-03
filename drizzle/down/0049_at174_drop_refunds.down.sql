-- AT-174: DOWN for drizzle/0049_at174_drop_refunds.sql (PRD §14, "Rollback
-- strategies": every Drizzle migration ships with a tested `down`).
-- Exercised by tests/db/0049-up-down.test.ts (up -> down -> up).
--
-- This file lives in drizzle/down/, which drizzle-kit never reads. Run it by
-- hand, in a transaction, against a database at 0049.
--
-- It recreates refund_status and refunds exactly as 0048 left them (0000's
-- definition; tenant_id included), empty. Up refused to drop a table with
-- rows, so there is no data to bring back. It refuses, touching nothing, if
-- either object already exists — that database is not at 0049.
--
-- The last statement forgets 0049 in drizzle's own ledger, so a later
-- `drizzle-kit migrate` re-applies it. 1793219800000 is 0049's `when` in the
-- journal.

DO $$
BEGIN
  IF to_regclass('public.refunds') IS NOT NULL
     OR to_regtype('public.refund_status') IS NOT NULL THEN
    RAISE EXCEPTION 'AT-174/0049 down: refunds or refund_status already exists — not reverting, nothing changed';
  END IF;
END $$;--> statement-breakpoint
CREATE TYPE "public"."refund_status" AS ENUM('pending', 'approved', 'rejected');--> statement-breakpoint
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
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_requested_by_staff_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_approved_by_staff_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
DO $$
BEGIN
  IF to_regclass('drizzle.__drizzle_migrations') IS NOT NULL THEN
    DELETE FROM "drizzle"."__drizzle_migrations" WHERE "created_at" = 1793219800000;
  END IF;
END $$;
