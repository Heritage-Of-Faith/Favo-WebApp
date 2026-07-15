ALTER TABLE "inventory_lots" ADD COLUMN "container_size" numeric(10, 2);--> statement-breakpoint
ALTER TABLE "inventory_lots" ADD COLUMN "container_size_unit" "inventory_unit";--> statement-breakpoint
ALTER TABLE "inventory_lots" ADD COLUMN "container_cost_zar" integer;