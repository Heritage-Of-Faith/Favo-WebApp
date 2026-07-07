// Standalone bun script — one-time data fix for AT-136 (menu trim) + AT-145
// (customisation inventory effects). Run AFTER migration 0026 is applied
// (menu_customisations.substitutes_inventory_item_id / adds_inventory_item_id
// / adds_quantity must exist).
//
// Usage: DATABASE_URL="$DATABASE_URL_SESSION" bun scripts/at136-at145-menu-data-fix.ts
//
// Idempotency: safe to re-run — every statement targets specific known ids and
// either sets a value to what it should already be, or uses ON CONFLICT DO
// NOTHING for inserts.

import { sql } from "drizzle-orm";
import { db } from "@db/index";

async function main() {
  await db.transaction(async (tx) => {
    // AT-136: drop Espresso from the live menu (last active item outside the
    // final 5 — everything else was already deactivated in an earlier pass).
    await tx.execute(sql`UPDATE menu_items SET active = false WHERE id = 'menu_espresso'`);

    // AT-145: Americano is locked as black/shot-only (docs/POS_REBUILD_DECISIONS.md)
    // — remove its milk options. Safe to hard-delete: order_items.modifications is
    // a jsonb snapshot, not FK'd to menu_customisations, so historical orders keep
    // their record regardless.
    await tx.execute(sql`
      DELETE FROM menu_customisations
      WHERE id IN ('mod_americano_oat_milk', 'mod_americano_almond_milk')
    `);

    // Convert Oat/Macadamia Milk to container (cup) tracking, matching dairy.
    // Retire their old ml-denominated lots (never opened; preserved, not deleted).
    await tx.execute(sql`
      UPDATE inventory_lots SET state = 'depleted'
      WHERE id IN ('lot_oat_milk_001', 'lot_macadamia_milk_001') AND state != 'depleted'
    `);
    await tx.execute(sql`
      UPDATE inventory_items SET unit = 'cup', low_stock_threshold = 2 WHERE id = 'inv_item_oat_milk'
    `);
    await tx.execute(sql`
      UPDATE inventory_items SET unit = 'cup', low_stock_threshold = 2 WHERE id = 'inv_item_macadamia_milk'
    `);

    // Almond Milk never had inventory tracking at all — create it, cup-tracked
    // from day one.
    await tx.execute(sql`
      INSERT INTO inventory_items (id, tenant_id, name, kind, unit, low_stock_threshold)
      VALUES ('inv_item_almond_milk', 'hofmi', 'Almond Milk', 'milk', 'cup', 2)
      ON CONFLICT (id) DO NOTHING
    `);

    // Opening stock for all three, PLACEHOLDER quantities (10 cups/carton,
    // matching dairy's ~1L-carton assumption) and NULL cost (real cost/supplier
    // TBD — correct via the admin stock-take UI, no code change needed).
    await tx.execute(sql`
      INSERT INTO inventory_lots (id, tenant_id, inventory_item_id, source_name, batch_number, state, quantity_received)
      VALUES
        ('lot_oat_milk_cups_001', 'hofmi', 'inv_item_oat_milk', 'Placeholder — needs real supplier', 'OAT-CUP-001', 'active', 10),
        ('lot_macadamia_milk_cups_001', 'hofmi', 'inv_item_macadamia_milk', 'Placeholder — needs real supplier', 'NAT-CUP-001', 'active', 10),
        ('lot_almond_milk_cups_001', 'hofmi', 'inv_item_almond_milk', 'Placeholder — needs real supplier', 'ALM-CUP-001', 'active', 10)
      ON CONFLICT (id) DO NOTHING
    `);

    // Extra Shot: correct price (was R12, should be R10) + wire the deduction
    // effect (1 shot = 1 bean cup, repeatable — the POS stepper selects it N times).
    await tx.execute(sql`
      UPDATE menu_customisations
      SET price_delta_zar = 1000, adds_inventory_item_id = 'inv_item_beans_cups', adds_quantity = 1
      WHERE id IN ('mod_americano_extra_shot', 'mod_cappuccino_extra_shot', 'mod_mocha_extra_shot')
    `);

    // Wire existing Oat/Almond Milk (Cappuccino, Mocha) to their substitution effect.
    await tx.execute(sql`
      UPDATE menu_customisations SET substitutes_inventory_item_id = 'inv_item_oat_milk'
      WHERE id IN ('mod_cappuccino_oat_milk', 'mod_mocha_oat_milk')
    `);
    await tx.execute(sql`
      UPDATE menu_customisations SET substitutes_inventory_item_id = 'inv_item_almond_milk'
      WHERE id IN ('mod_cappuccino_almond_milk', 'mod_mocha_almond_milk')
    `);

    // New Macadamia Milk option (free, R0) for Cappuccino + Mocha.
    await tx.execute(sql`
      INSERT INTO menu_customisations (id, tenant_id, menu_item_id, name, price_delta_zar, substitutes_inventory_item_id)
      VALUES
        ('mod_cappuccino_macadamia_milk', 'hofmi', 'menu_cappuccino', 'Macadamia Milk', 0, 'inv_item_macadamia_milk'),
        ('mod_mocha_macadamia_milk', 'hofmi', 'menu_mocha', 'Macadamia Milk', 0, 'inv_item_macadamia_milk')
      ON CONFLICT (id) DO NOTHING
    `);

    // New Hot Chocolate menu item + recipe (mirrors Mocha, minus espresso beans)
    // + its one customisation (Macadamia Milk toggle only, per the locked
    // wireframe brief — no shot stepper, no oat/almond). Chai Latte is
    // deliberately NOT included — blocked on a real product decision for its
    // concentrate/syrup ingredient.
    await tx.execute(sql`
      INSERT INTO menu_items (id, tenant_id, name, category, active, current_price_zar, recipe_id)
      VALUES ('menu_hot_chocolate', 'hofmi', 'Hot Chocolate', 'coffee', true, 4000, 'recipe_hot_chocolate')
      ON CONFLICT (id) DO NOTHING
    `);
    await tx.execute(sql`
      INSERT INTO recipes (id, tenant_id, menu_item_id, version)
      VALUES ('recipe_hot_chocolate', 'hofmi', 'menu_hot_chocolate', 1)
      ON CONFLICT (id) DO NOTHING
    `);
    await tx.execute(sql`
      INSERT INTO recipe_ingredients (id, recipe_id, inventory_item_id, quantity, unit, tolerance_pct)
      VALUES
        ('ri_hot_chocolate_powder', 'recipe_hot_chocolate', 'inv_item_hot_choc_powder', 20, 'g', 0),
        ('ri_hot_chocolate_milk', 'recipe_hot_chocolate', 'inv_item_whole_milk_cups', 1, 'cup', 0),
        ('ri_hot_chocolate_cup', 'recipe_hot_chocolate', 'inv_item_cup_12oz', 1, 'unit', 0),
        ('ri_hot_chocolate_lid', 'recipe_hot_chocolate', 'inv_item_lid', 1, 'unit', 0)
      ON CONFLICT (id) DO NOTHING
    `);
    await tx.execute(sql`
      INSERT INTO menu_customisations (id, tenant_id, menu_item_id, name, price_delta_zar, substitutes_inventory_item_id)
      VALUES ('mod_hot_chocolate_macadamia_milk', 'hofmi', 'menu_hot_chocolate', 'Macadamia Milk', 0, 'inv_item_macadamia_milk')
      ON CONFLICT (id) DO NOTHING
    `);
  });

  console.log("AT-136/AT-145 menu data fix applied successfully.");
  process.exit(0);
}

main().catch((err) => {
  console.error("AT-136/AT-145 menu data fix FAILED — transaction rolled back:", err);
  process.exit(1);
});
