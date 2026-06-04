ALTER TABLE "purchases" DROP CONSTRAINT "emergency_requires_approval";--> statement-breakpoint
ALTER TABLE "purchases" ADD COLUMN "status" text DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "purchases" ADD CONSTRAINT "emergency_requires_approval" CHECK (kind != 'emergency' OR status = 'pending_admin_approval' OR admin_approved_by IS NOT NULL);