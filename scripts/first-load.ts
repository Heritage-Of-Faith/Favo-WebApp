// First load of an empty production database — go-live gap G3.
//
// PRD v7 §13.0: FAVO starts on a clean, empty database; apply migrations, then
// seed the menu, prices (§7.0.1), recipes and ingredient costs, then verify the
// seed before trading. Run after the first migration:
//   read -rs FIRST_ADMIN_PIN; export FIRST_ADMIN_PIN
//   docker run --rm -e DATABASE_URL -e FIRST_ADMIN_PIN <image> bun first-load.js
// (`-e NAME` with no value passes it from the shell, so the PIN is never typed
// on the command line; same DATABASE_URL as the app). In the image this is
// bundled to /app/first-load.js (Dockerfile builder stage); locally:
// bun scripts/first-load.ts
//
// Loads, in order, from the existing seed modules (no data is copied here):
// menu, inventory items, customisations, lots (cost rows only: NO opening stock
// movements, and not the two orphaned lots), recipes, operating hours, event
// profiles. Then one active admin, only if `staff` is empty, with the PIN from
// FIRST_ADMIN_PIN. Stock comes from a physical stock-take in Admin.
//
// Never loads: the dev staff with known PINs, the demo customers, the demo
// transactions, or the stock alert recipients (that seed points at a dev staff
// row, which does not exist here).
//
// Refuses (exit 1, nothing written) if DATABASE_URL is unset, if `orders` has
// any row (trading has started), or if FIRST_ADMIN_PIN is unset or weak while
// staff is empty. Safe to re-run until the first order: every step is
// idempotent, so a run that failed partway is finished by running it again.

import { missingDatabaseUrl, runFirstLoad } from "../src/server/first-load/guards";

function fail(message: string) {
  console.error(`[first-load] REFUSED: ${message}`);
  process.exitCode = 1;
}

async function main() {
  if (missingDatabaseUrl(process.env)) {
    fail("DATABASE_URL is not set. Nothing was written.");
    return;
  }

  // Imported only after the env check: db/index.ts builds its client from
  // DATABASE_URL at import time.
  const { count, eq, asc, like, inArray } = await import("drizzle-orm");
  const { db } = await import("../db/index");
  const schema = await import("../db/schema");
  const { hashPin } = await import("../src/server/auth/pin");
  const { seedMenu } = await import("../db/seed/menu");
  const { seedInventoryItems } = await import("../db/seed/inventory");
  const { seedCustomisations } = await import("../db/seed/customisations");
  const { seedLots, ORPHANED_LOT_IDS } = await import("../db/seed/lots");
  const { seedRecipes } = await import("../db/seed/recipes");
  const { seedHours } = await import("../db/seed/hours");
  const { seedEventProfiles } = await import("../db/seed/event-profiles");

  type Table = Parameters<ReturnType<typeof db.select>["from"]>[0];
  const rowCount = async (table: Table) => (await db.select({ n: count() }).from(table))[0]?.n ?? 0;

  try {
    const outcome = await runFirstLoad(process.env, {
      countOrders: () => rowCount(schema.orders),
      listStaff: () =>
        db.select({ name: schema.staff.name, role: schema.staff.role }).from(schema.staff).orderBy(asc(schema.staff.name)),
      steps: [
        { name: "menu", run: seedMenu },
        // menu_customisations references inventory_items (AT-145), so items first.
        { name: "inventory items", run: seedInventoryItems },
        { name: "customisations", run: seedCustomisations },
        // Phase 2 order: items, lots, recipes.
        { name: "lots", run: () => seedLots({ openingStock: false, excludeLotIds: ORPHANED_LOT_IDS }) },
        { name: "recipes", run: seedRecipes },
        // operating_hours has a serial id and no unique key, so ON CONFLICT
        // cannot stop a second run duplicating it: load it only into an empty table.
        { name: "operating hours", run: seedHours, skipIf: async () => (await rowCount(schema.operatingHours)) > 0 },
        { name: "event profiles", run: seedEventProfiles },
      ],
      hashPin,
      insertAdmin: async (row) => {
        await db.insert(schema.staff).values(row);
      },
    });

    if (!outcome.ok) {
      fail(outcome.message);
      return;
    }

    for (const name of outcome.skipped) console.log(`[first-load] skipped: ${name} (already loaded).`);
    console.log(
      "[first-load] skipped: stock alert recipients (the seed names a dev staff row). Add them at /admin/inventory/recipients.",
    );
    if (outcome.adminCreated) {
      console.log(
        "[first-load] created one active admin: name 'Admin'. Sign in at /staff/login with FIRST_ADMIN_PIN, then add baristas at /admin/staff.",
      );
    } else {
      console.log("[first-load] staff already had rows, so no admin was created. Existing staff:");
      for (const s of outcome.existingStaff) console.log(`  ${s.name} (${s.role})`);
    }

    const counted: [string, Table][] = [
      ["menu_items", schema.menuItems],
      ["menu_customisations", schema.menuCustomisations],
      ["inventory_items", schema.inventoryItems],
      ["inventory_lots", schema.inventoryLots],
      ["stock_movements", schema.stockMovements],
      ["recipes", schema.recipes],
      ["recipe_ingredients", schema.recipeIngredients],
      ["operating_hours", schema.operatingHours],
      ["event_profiles", schema.eventProfiles],
      ["staff", schema.staff],
    ];
    console.log("[first-load] loaded:");
    for (const [name, table] of counted) console.log(`  ${name}: ${await rowCount(table)}`);

    // For the §13.0 seed check: the live menu and its prices, as loaded.
    const live = await db
      .select({ name: schema.menuItems.name, priceZar: schema.menuItems.currentPriceZar })
      .from(schema.menuItems)
      .where(eq(schema.menuItems.active, true))
      .orderBy(asc(schema.menuItems.name));
    console.log(`[first-load] active menu items (${live.length}), check against PRD §7.0.1:`);
    for (const item of live) console.log(`  ${item.name}: ${item.priceZar} cents`);

    const inactive = await db
      .select({ id: schema.menuItems.id })
      .from(schema.menuItems)
      .where(eq(schema.menuItems.active, false));
    const inactiveIds = inactive.map((m) => m.id);
    const inactiveMods =
      inactiveIds.length === 0
        ? 0
        : ((
            await db
              .select({ n: count() })
              .from(schema.menuCustomisations)
              .where(inArray(schema.menuCustomisations.menuItemId, inactiveIds))
          )[0]?.n ?? 0);
    console.log(
      `[first-load] legacy menu items: ${inactiveIds.length}, with ${inactiveMods} customisations (kept, inactive, not shown at the till).`,
    );

    const zeroCost = await db
      .select({ id: schema.inventoryLots.id })
      .from(schema.inventoryLots)
      .where(eq(schema.inventoryLots.unitCostZar, "0.0000"));
    if (zeroCost.length > 0) {
      console.log(`[first-load] lots costed 0.0000 (recost before trading, PRD §13.0): ${zeroCost.map((l) => l.id).join(", ")}`);
    }

    const placeholder = await db
      .select({ id: schema.inventoryLots.id })
      .from(schema.inventoryLots)
      .where(like(schema.inventoryLots.sourceName, "Placeholder%"));
    if (placeholder.length > 0) {
      console.log(`[first-load] supplier names are placeholders: ${placeholder.map((l) => l.id).join(", ")}`);
    }
    const suppliers = await db
      .selectDistinct({ name: schema.inventoryLots.sourceName })
      .from(schema.inventoryLots)
      .orderBy(asc(schema.inventoryLots.sourceName));
    console.log(
      `[first-load] supplier names come from the seed and are not invoice-checked: ${suppliers
        .map((s) => s.name)
        .filter((n): n is string => !!n && !n.startsWith("Placeholder"))
        .join(", ")}`,
    );

    console.log("NO OPENING STOCK LOADED: do a physical stock-take in Admin (/admin/stock-takes) before trading.");
    console.log("All ingredient costs are ESTIMATES (cost_source=estimate). Recost real figures in Admin before trading.");
  } finally {
    await db.$client.end({ timeout: 5 });
  }
}

main().catch((err) => {
  console.error(`[first-load] FAILED: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
