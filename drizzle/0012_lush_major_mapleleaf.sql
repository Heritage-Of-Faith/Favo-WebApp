ALTER TABLE "payments" ALTER COLUMN "yoco_payment_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "yoco_checkout_id" text;