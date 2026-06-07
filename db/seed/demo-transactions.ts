// Demo transactions seed — populates a week of realistic trading activity so the
// admin COGS dashboard shows non-zero Revenue / COGS / Expenses / Net.
//
// Why this exists: the base seed (index.ts + phase2.ts) creates menu, staff,
// inventory and recipes but NO orders, deductions or expenses — so a fresh
// dashboard reads R0,00 everywhere and looks broken. This script adds:
//   • ~90 collected orders spread across the last 7 SAST days
//   • matching `deduction` stock_movements (→ COGS)
//   • one mid-window milk restock (keeps stock positive — realistic delivery)
//   • a handful of operating expenses (→ Expenses)
//
// Idempotent: every row uses a stable `demo_*` id + onConflictDoNothing, so
// re-running never duplicates. Remove with: DELETE ... WHERE id LIKE 'demo_%'.
//
// Guarded: refuses to run without `--confirm` (or DEMO_SEED_CONFIRM=1) so it
// can't write to a database by accident.
//
// Run: bun db:seed:demo --confirm   (requires DATABASE_URL in .env.local)

import { and, eq } from "drizzle-orm";
import { db } from "../index";
import {
  orders,
  orderItems,
  inventoryLots,
  stockMovements,
  expenses,
} from "../schema";

// Single-tenant app — matches the `tenant_id` default in db/schema.ts.
const TENANT = "hofmi";
const STAFF_BARISTA = "staff_barista_sam";
const STAFF_OWNER = "staff_owner_olivia";
const CUSTOMERS = ["cust_louis", "cust_naledi", null, null] as const; // some walk-ins

// One "unit" of trade = these 6 drinks. Recipe ingredient draws mirror recipes.ts.
type Drink = {
  menuId: string;
  priceZar: number;
  // [inventoryItemId, qtyPerDrink in item unit]
  draws: [string, number][];
};

const BEANS = "inv_item_espresso_beans";
const WHOLE_MILK = "inv_item_whole_milk";
const CUP_8OZ = "inv_item_cup_8oz";
const CUP_12OZ = "inv_item_cup_12oz";
const LID = "inv_item_lid";

const UNIT_DRINKS: Drink[] = [
  { menuId: "menu_espresso",   priceZar: 2500, draws: [[BEANS, 7], [CUP_8OZ, 1]] },
  { menuId: "menu_americano",  priceZar: 3000, draws: [[BEANS, 7], [CUP_8OZ, 1]] },
  { menuId: "menu_cappuccino", priceZar: 3800, draws: [[BEANS, 7], [WHOLE_MILK, 150], [CUP_8OZ, 1], [LID, 1]] },
  { menuId: "menu_latte",      priceZar: 4200, draws: [[BEANS, 7], [WHOLE_MILK, 200], [CUP_12OZ, 1], [LID, 1]] },
  { menuId: "menu_flat_white", priceZar: 4000, draws: [[BEANS, 7], [WHOLE_MILK, 130], [CUP_12OZ, 1], [LID, 1]] },
  { menuId: "menu_americano",  priceZar: 3000, draws: [[BEANS, 7], [CUP_8OZ, 1]] },
];

// Trade units per day, indexed by k (k=0 = today, k=6 = six days ago).
const UNITS_PER_DAY = [2, 1, 2, 3, 2, 3, 2]; // 15 units → 90 orders total

const EXPENSES: { id: string; category: "rent" | "utilities" | "staff" | "maintenance" | "marketing" | "other"; amountZar: number; dayK: number }[] = [
  { id: "demo_exp_utilities",   category: "utilities",   amountZar: 48000, dayK: 5 }, // R480
  { id: "demo_exp_maintenance", category: "maintenance", amountZar: 65000, dayK: 4 }, // R650
  { id: "demo_exp_marketing",   category: "marketing",   amountZar: 35000, dayK: 2 }, // R350
  { id: "demo_exp_supplies",    category: "other",       amountZar: 22000, dayK: 1 }, // R220
];

/** SAST (UTC+2) calendar date components for `daysAgo` days before today. */
function sastDayParts(daysAgo: number): { y: number; m: number; d: number } {
  const now = new Date();
  const sast = new Date(now.getTime() + 2 * 60 * 60 * 1000 - daysAgo * 24 * 60 * 60 * 1000);
  return { y: sast.getUTCFullYear(), m: sast.getUTCMonth() + 1, d: sast.getUTCDate() };
}

/** A timestamp at HH:00 SAST on the given SAST date (stored as UTC instant). */
function atSast(parts: { y: number; m: number; d: number }, sastHour: number, minute = 0): Date {
  // SAST = UTC+2, so UTC hour = sastHour - 2.
  return new Date(Date.UTC(parts.y, parts.m - 1, parts.d, sastHour - 2, minute));
}

async function main() {
  const confirmed = process.argv.includes("--confirm") || process.env.DEMO_SEED_CONFIRM === "1";
  const host = (() => {
    try { return new URL(process.env.DATABASE_URL ?? "").host; } catch { return "(unparseable)"; }
  })();

  if (!confirmed) {
    console.error(
      `Refusing to run without confirmation.\n` +
      `  Target DB host: ${host}\n` +
      `  This writes ~90 demo orders, deductions and expenses.\n` +
      `  Re-run with:  bun db:seed:demo --confirm`
    );
    process.exit(1);
  }

  console.log(`Seeding demo transactions → ${host}`);

  // Map inventoryItemId → active lot id (one active lot per item in the seed).
  const lots = await db
    .select({ id: inventoryLots.id, itemId: inventoryLots.inventoryItemId })
    .from(inventoryLots)
    .where(and(eq(inventoryLots.state, "active"), eq(inventoryLots.tenantId, TENANT)));
  const lotByItem = new Map(lots.map((l) => [l.itemId, l.id]));

  const missing = [BEANS, WHOLE_MILK, CUP_8OZ, CUP_12OZ, LID].filter((i) => !lotByItem.has(i));
  if (missing.length) {
    console.error(`Missing active lots for: ${missing.join(", ")}. Run \`bun db:seed:phase2\` first.`);
    process.exit(1);
  }

  // 1. Mid-window milk restock so steamed-milk draws never push stock negative.
  await db
    .insert(stockMovements)
    .values({
      id: "demo_sm_restock_milk",
      inventoryLotId: lotByItem.get(WHOLE_MILK)!,
      delta: 8000, // +8 L delivery
      kind: "restock",
      at: atSast(sastDayParts(6), 8),
      byStaffId: STAFF_OWNER,
    })
    .onConflictDoNothing();

  let orderCount = 0;
  let movementCount = 0;

  // 2. Orders + items + deductions, per day.
  for (let k = 0; k < UNITS_PER_DAY.length; k++) {
    const parts = sastDayParts(k);
    const units = UNITS_PER_DAY[k];
    let seq = 0;

    for (let u = 0; u < units; u++) {
      for (const drink of UNIT_DRINKS) {
        const orderId = `demo_ord_${k}_${seq}`;
        const placedAt = atSast(parts, 8 + (seq % 9), (seq * 7) % 60); // 08:00–16:xx SAST
        const customerId = CUSTOMERS[seq % CUSTOMERS.length];

        await db
          .insert(orders)
          .values({
            id: orderId,
            customerId: customerId ?? null,
            staffId: STAFF_BARISTA,
            state: "collected",
            placedAt,
            completedAt: new Date(placedAt.getTime() + 5 * 60 * 1000),
            totalZar: drink.priceZar,
          })
          .onConflictDoNothing();

        await db
          .insert(orderItems)
          .values({
            id: `demo_oi_${k}_${seq}`,
            orderId,
            menuItemId: drink.menuId,
            quantity: 1,
            unitPriceZar: drink.priceZar,
          })
          .onConflictDoNothing();

        // Deduction movements → COGS (kind='deduction', delta negative).
        for (let di = 0; di < drink.draws.length; di++) {
          const [itemId, qty] = drink.draws[di];
          await db
            .insert(stockMovements)
            .values({
              id: `demo_sm_${k}_${seq}_${di}`,
              inventoryLotId: lotByItem.get(itemId)!,
              delta: -qty,
              kind: "deduction",
              relatedOrderId: orderId,
              at: placedAt,
              byStaffId: STAFF_BARISTA,
            })
            .onConflictDoNothing();
          movementCount++;
        }

        orderCount++;
        seq++;
      }
    }
  }

  // 3. Operating expenses.
  for (const e of EXPENSES) {
    await db
      .insert(expenses)
      .values({
        id: e.id,
        category: e.category,
        amountZar: e.amountZar,
        incurredAt: atSast(sastDayParts(e.dayK), 9),
        loggedBy: STAFF_OWNER,
      })
      .onConflictDoNothing();
  }

  console.log(`Demo seed complete: ${orderCount} orders, ${movementCount} deductions, ${EXPENSES.length} expenses.`);
  process.exit(0);
}

main().catch((err) => {
  console.error("Demo seed failed:", err);
  process.exit(1);
});
