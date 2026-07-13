// Standalone bun script — one-time data fix (2026-07-13, Nikao decisions):
//   1. Chai Latte — activate the 5th locked-menu item (chai powder + steamed
//      milk, macadamia-swappable). Base ingredient confirmed: chai powder,
//      3–4 tsp (~10 g) + 200 ml milk. Price R25.
//   2. Macadamia-only — remove Oat & Almond milk options from the live active
//      drinks (Cappuccino, Mocha). Macadamia is the ONLY alt-milk the café
//      stocks; oat/almond were never carried in practice.
//
// Follows the AT-136/145 data-fix pattern (scripts/at136-at145-menu-data-fix.ts).
// Idempotent — safe to re-run. Run AFTER deploy, once, against the live DB:
//   DATABASE_URL="$DATABASE_URL_SESSION" bun scripts/chai-macadamia-only-fix.ts
//
// The seed (db/seed/*) already covers fresh databases; this only reconciles the
// existing live DB, where a stale inactive "Chai Latte" row was added
// out-of-band (see Gian's handover note) — so chai is resolved BY NAME to avoid
// creating a duplicate or an FK break against a mismatched id.

import { sql } from "drizzle-orm";
import { db } from "@db/index";

async function main() {
  await db.transaction(async (tx) => {
    // ── 1a. Chai powder inventory item (mirrors hot chocolate powder) ─────────
    await tx.execute(sql`
      INSERT INTO inventory_items (id, tenant_id, name, kind, unit, low_stock_threshold)
      VALUES ('inv_item_chai_powder', 'hofmi', 'Chai Powder', 'other', 'g', 200)
      ON CONFLICT (id) DO NOTHING
    `);

    // ── 1b. Opening lot + restock movement (500 g) ────────────────────────────
    // The movement is what makes stock non-zero (running stock = SUM of
    // stock_movements.delta), so chai is immediately makeable. Cost is an
    // estimate — recost via the admin stock-take.
    await tx.execute(sql`
      INSERT INTO inventory_lots (id, tenant_id, inventory_item_id, source_name, batch_number, state, unit_cost_zar, quantity_received)
      VALUES ('lot_chai_powder_001', 'hofmi', 'inv_item_chai_powder', 'Placeholder — needs real supplier', 'CHAI-2026-05-01', 'active', 0.2000, 500)
      ON CONFLICT (id) DO NOTHING
    `);
    await tx.execute(sql`
      INSERT INTO stock_movements (id, tenant_id, inventory_lot_id, delta, kind)
      VALUES ('sm_opening_lot_chai_powder_001', 'hofmi', 'lot_chai_powder_001', 500, 'restock')
      ON CONFLICT (id) DO NOTHING
    `);

    // ── 1c. Menu row + recipe + macadamia toggle, resolving chai BY NAME ───────
    // Handles both cases: a stale live "Chai Latte" row (any id) → reconcile it;
    // no row yet → create menu_chai. The recipe/customisation reference whatever
    // id actually exists, so there's never a duplicate or a dangling FK.
    await tx.execute(sql`
      DO $$
      DECLARE chai_id text;
      BEGIN
        SELECT id INTO chai_id FROM menu_items WHERE name = 'Chai Latte' LIMIT 1;
        IF chai_id IS NULL THEN
          INSERT INTO menu_items (id, tenant_id, name, category, active, current_price_zar)
          VALUES ('menu_chai', 'hofmi', 'Chai Latte', 'coffee', true, 2500);
          chai_id := 'menu_chai';
        END IF;

        INSERT INTO recipes (id, tenant_id, menu_item_id, version)
        VALUES ('recipe_chai', 'hofmi', chai_id, 1)
        ON CONFLICT (id) DO NOTHING;

        INSERT INTO recipe_ingredients (id, recipe_id, inventory_item_id, quantity, unit, tolerance_pct)
        VALUES
          ('ri_chai_powder', 'recipe_chai', 'inv_item_chai_powder',      10, 'g',    15),
          ('ri_chai_milk',   'recipe_chai', 'inv_item_whole_milk_cups',   1, 'cup',  10),
          ('ri_chai_cup',    'recipe_chai', 'inv_item_cup_8oz',           1, 'unit',  0),
          ('ri_chai_lid',    'recipe_chai', 'inv_item_lid',               1, 'unit',  0)
        ON CONFLICT (id) DO NOTHING;

        -- Macadamia milk toggle (free, R0), like Hot Chocolate.
        INSERT INTO menu_customisations (id, tenant_id, menu_item_id, name, price_delta_zar, substitutes_inventory_item_id)
        VALUES ('mod_chai_macadamia_milk', 'hofmi', chai_id, 'Macadamia Milk', 0, 'inv_item_macadamia_milk')
        ON CONFLICT (id) DO NOTHING;

        -- Activate + link the recipe + lock the R25 price.
        UPDATE menu_items SET active = true, recipe_id = 'recipe_chai', current_price_zar = 2500 WHERE id = chai_id;
      END $$;
    `);

    // ── 2. Macadamia-only: drop Oat & Almond from the live active drinks ───────
    // Cappuccino + Mocha are the only active drinks that offered oat/almond.
    // Safe hard-delete: order_items.modifications is a jsonb snapshot, not FK'd
    // to menu_customisations, so historical orders keep their record.
    await tx.execute(sql`
      DELETE FROM menu_customisations
      WHERE id IN (
        'mod_cappuccino_oat_milk', 'mod_cappuccino_almond_milk',
        'mod_mocha_oat_milk', 'mod_mocha_almond_milk'
      )
    `);
  });

  console.log("Chai + macadamia-only data fix applied successfully.");
  process.exit(0);
}

main().catch((err) => {
  console.error("Chai/macadamia data fix FAILED — transaction rolled back:", err);
  process.exit(1);
});
