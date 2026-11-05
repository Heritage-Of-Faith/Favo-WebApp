UPDATE "staff" SET "role" = 'admin' WHERE "role" IN ('roaster', 'manager', 'finance', 'owner');--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "auth_id" uuid;--> statement-breakpoint
ALTER TABLE "customers" DROP COLUMN "password_hash";--> statement-breakpoint
ALTER TABLE "monthly_reports" DROP COLUMN "finance_sig";--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_auth_id_unique" UNIQUE("auth_id");--> statement-breakpoint
-- G1 (GO_LIVE_RUNBOOK §8): the FK to Supabase's auth.users is added only where
-- that table exists. A clean Postgres with no auth schema (Transformate, PRD §9)
-- skips it. Already-applied databases never re-run this file (drizzle skips by
-- created_at). Guard asserted by tests/unit/db/migration-0013-auth-guard.test.ts.
DO $$
BEGIN
  IF to_regclass('auth.users') IS NOT NULL THEN
    ALTER TABLE "customers" ADD CONSTRAINT "customers_auth_id_fk" FOREIGN KEY ("auth_id") REFERENCES auth.users(id) ON DELETE CASCADE;
  ELSE
    RAISE NOTICE '0013: auth.users not found, customers_auth_id_fk not created';
  END IF;
END $$;--> statement-breakpoint
ALTER TABLE "public"."staff" ALTER COLUMN "role" SET DATA TYPE text;--> statement-breakpoint
DROP TYPE "public"."staff_role";--> statement-breakpoint
CREATE TYPE "public"."staff_role" AS ENUM('barista', 'admin');--> statement-breakpoint
ALTER TABLE "public"."staff" ALTER COLUMN "role" SET DATA TYPE "public"."staff_role" USING "role"::"public"."staff_role";