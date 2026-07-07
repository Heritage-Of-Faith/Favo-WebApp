-- AT-145: link menu customisations to their real inventory effect, so
-- deductForOrder() can read what was actually chosen instead of always
-- deducting the base recipe. Purely additive (nullable columns) — no backfill
-- needed, existing customisation rows just have no deduction effect until a
-- follow-up data migration sets these (Oat/Almond/Macadamia Milk substitute
-- the recipe's milk ingredient; Extra Shot adds bean cups).

ALTER TABLE "menu_customisations" ADD COLUMN "substitutes_inventory_item_id" text;--> statement-breakpoint
ALTER TABLE "menu_customisations" ADD COLUMN "adds_inventory_item_id" text;--> statement-breakpoint
ALTER TABLE "menu_customisations" ADD COLUMN "adds_quantity" integer;--> statement-breakpoint
ALTER TABLE "menu_customisations" ADD CONSTRAINT "menu_customisations_substitutes_inventory_item_id_inventory_items_id_fk" FOREIGN KEY ("substitutes_inventory_item_id") REFERENCES "public"."inventory_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "menu_customisations" ADD CONSTRAINT "menu_customisations_adds_inventory_item_id_inventory_items_id_fk" FOREIGN KEY ("adds_inventory_item_id") REFERENCES "public"."inventory_items"("id") ON DELETE no action ON UPDATE no action;