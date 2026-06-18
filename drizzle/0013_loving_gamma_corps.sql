UPDATE "staff" SET "role" = 'admin' WHERE "role" IN ('roaster', 'manager', 'finance', 'owner');--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "auth_id" uuid;--> statement-breakpoint
ALTER TABLE "customers" DROP COLUMN "password_hash";--> statement-breakpoint
ALTER TABLE "monthly_reports" DROP COLUMN "finance_sig";--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_auth_id_unique" UNIQUE("auth_id");--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_auth_id_fk" FOREIGN KEY ("auth_id") REFERENCES auth.users(id) ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "public"."staff" ALTER COLUMN "role" SET DATA TYPE text;--> statement-breakpoint
DROP TYPE "public"."staff_role";--> statement-breakpoint
CREATE TYPE "public"."staff_role" AS ENUM('barista', 'admin');--> statement-breakpoint
ALTER TABLE "public"."staff" ALTER COLUMN "role" SET DATA TYPE "public"."staff_role" USING "role"::"public"."staff_role";