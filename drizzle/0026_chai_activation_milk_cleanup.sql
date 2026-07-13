-- POS-rebuild handover fixes (2026-07-13):
--   1. Chai Latte was on the live menu as active=false with no recipe. This
--      activates it and attaches a recipe (chai powder + steamed milk).
--   2. Oat & almond alt-milks were offered/stocked but never actually carried.
--      Macadamia is the ONLY alt-milk the café stocks — but it was never offered
--      as a customisation. This drops oat/almond options and adds macadamia.
--
-- Reconciles the LIVE DB (seeded once, then chai added out-of-band with a UUID
-- id, not the seed's `menu_chai`). Idempotent — safe to re-run. Also safe on a
-- fresh DB where migrations run BEFORE the seed: every menu-dependent step is
-- guarded so it no-ops when the referenced rows don't exist yet, and the seed
-- then creates them cleanly.
--
-- Oat milk's dormant inventory item + lot are intentionally left in place (they
-- carry stock-movement history); they'll be cleared at the handover stock-take.

-- 1. Chai Powder inventory item (fixed id — matches db/seed/inventory.ts).
INSERT INTO inventory_items (id, name, kind, unit, low_stock_threshold)
VALUES ('inv_item_chai_powder', 'Chai Powder', 'other', 'g', 200)
ON CONFLICT (id) DO NOTHING;
--> statement-breakpoint

-- 2. Opening lot for chai powder (R200/kg estimate → 0.2000 ¢/g, recost via A8).
INSERT INTO inventory_lots (id, inventory_item_id, source_name, batch_number, state, unit_cost_zar, quantity_received)
VALUES ('lot_chai_powder_001', 'inv_item_chai_powder', 'Estimated (recost at handover)', 'CHAI-2026-05-01', 'active', 0.2000, 500.00)
ON CONFLICT (id) DO NOTHING;
--> statement-breakpoint

-- 3. Opening restock movement so running-stock / COGS queries see the balance.
INSERT INTO stock_movements (id, inventory_lot_id, delta, kind)
VALUES ('sm_opening_lot_chai_powder_001', 'lot_chai_powder_001', 500, 'restock')
ON CONFLICT (id) DO NOTHING;
--> statement-breakpoint

-- 4. Drop the oat & almond milk customisation options (no longer carried).
DELETE FROM menu_customisations WHERE name IN ('Oat Milk', 'Almond Milk');
--> statement-breakpoint

-- 5. Offer Macadamia Milk on every espresso-based drink that exists. INSERT…SELECT
--    so it only inserts for drinks present in this DB (no-op on a fresh, unseeded
--    DB). Customisation ids match the seed's `mod_<drink>_macadamia_milk` scheme.
INSERT INTO menu_customisations (id, menu_item_id, name, price_delta_zar)
SELECT 'mod_' || replace(mi.id, 'menu_', '') || '_macadamia_milk', mi.id, 'Macadamia Milk', 800
FROM menu_items mi
WHERE mi.id IN (
  'menu_espresso', 'menu_americano', 'menu_cappuccino',
  'menu_flat_white', 'menu_latte', 'menu_cortado', 'menu_mocha'
)
ON CONFLICT (id) DO NOTHING;
--> statement-breakpoint

-- 6. Activate the existing Chai Latte row and attach its recipe — ONLY if a chai
--    menu row already exists (i.e. the live DB). On a fresh DB this block no-ops
--    and the seed creates `menu_chai` + `recipe_chai` itself.
DO $$
DECLARE
  chai_id text;
BEGIN
  SELECT id INTO chai_id FROM menu_items WHERE name = 'Chai Latte' LIMIT 1;
  IF chai_id IS NULL THEN
    RETURN;
  END IF;

  -- Recipe header (references the live chai menu row).
  INSERT INTO recipes (id, menu_item_id, version)
  VALUES ('recipe_chai', chai_id, 1)
  ON CONFLICT (id) DO NOTHING;

  -- Ingredients: 3–4 tsp (~10 g) chai powder + one milk cup + 8 oz cup + lid.
  INSERT INTO recipe_ingredients (id, recipe_id, inventory_item_id, quantity, unit, tolerance_pct)
  VALUES
    ('ri_recipe_chai_0', 'recipe_chai', 'inv_item_chai_powder',      10, 'g',    20),
    ('ri_recipe_chai_1', 'recipe_chai', 'inv_item_whole_milk_cups',   1, 'cup',  10),
    ('ri_recipe_chai_2', 'recipe_chai', 'inv_item_cup_8oz',           1, 'unit',  0),
    ('ri_recipe_chai_3', 'recipe_chai', 'inv_item_lid',               1, 'unit',  0)
  ON CONFLICT (id) DO NOTHING;

  -- Chai's milk swap (no espresso, so macadamia only — no shot / decaf).
  INSERT INTO menu_customisations (id, menu_item_id, name, price_delta_zar)
  VALUES ('mod_chai_macadamia_milk', chai_id, 'Macadamia Milk', 800)
  ON CONFLICT (id) DO NOTHING;

  -- Flip it live and link the recipe.
  UPDATE menu_items SET active = true, recipe_id = 'recipe_chai' WHERE id = chai_id;
END $$;
