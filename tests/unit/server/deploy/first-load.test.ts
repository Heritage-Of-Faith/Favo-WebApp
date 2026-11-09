// Go-live gap G3 — the first load of an empty production database
// (scripts/first-load.ts, PRD v7 §13.0). No real database: the core runs on
// fakes, and seedLots runs on a mocked db.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  checkFirstAdminPin,
  missingDatabaseUrl,
  runFirstLoad,
  FIRST_ADMIN_ID,
  type FirstLoadDeps,
} from "@/server/first-load/guards";
import { hashPin, verifyPin } from "@/server/auth/pin";

const inserted: { table: unknown; values: unknown }[] = [];
vi.mock("@db/index", () => ({
  db: {
    insert: (table: unknown) => ({
      values: (values: unknown) => {
        inserted.push({ table, values });
        return { onConflictDoNothing: async () => undefined };
      },
    }),
  },
}));

describe("checkFirstAdminPin", () => {
  it.each(["1234", "2345", "4321", "1111", "0000", "123456"])("refuses the well-known PIN %s", (pin) => {
    const r = checkFirstAdminPin(pin);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).not.toContain(pin);
  });

  it.each(["2222", "99999", "777777"])("refuses the all-same-digit PIN %s", (pin) => {
    const r = checkFirstAdminPin(pin);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).not.toContain(pin);
  });

  it.each(["123", "1234567", "12a4", " 7391", "7391\n", ""])("refuses the malformed PIN %j", (pin) => {
    expect(checkFirstAdminPin(pin).ok).toBe(false);
  });

  it("refuses when FIRST_ADMIN_PIN is unset", () => {
    expect(checkFirstAdminPin(undefined)).toEqual({ ok: false, reason: "FIRST_ADMIN_PIN is not set." });
  });

  it.each(["7391", "58204", "902716"])("accepts %s", (pin) => {
    expect(checkFirstAdminPin(pin)).toEqual({ ok: true, pin });
  });
});

describe("missingDatabaseUrl", () => {
  it("is true when DATABASE_URL is unset or blank", () => {
    expect(missingDatabaseUrl({})).toBe(true);
    expect(missingDatabaseUrl({ DATABASE_URL: "  " })).toBe(true);
  });
  it("is false when DATABASE_URL is set", () => {
    expect(missingDatabaseUrl({ DATABASE_URL: "postgres://x" })).toBe(false);
  });
});

const STEP_NAMES = ["menu", "inventory items", "customisations", "lots", "recipes", "operating hours", "event profiles"];

function fakeDeps(over: Partial<FirstLoadDeps> = {}) {
  const order: string[] = [];
  const deps: FirstLoadDeps = {
    countOrders: vi.fn(async () => 0),
    listStaff: vi.fn(async () => []),
    steps: STEP_NAMES.map((name) => ({ name, run: vi.fn(async () => void order.push(name)) })),
    hashPin: vi.fn(async (pin: string) => `hashed:${pin.length}`),
    insertAdmin: vi.fn(async () => void order.push("admin")),
    ...over,
  };
  return { deps, order };
}

describe("runFirstLoad", () => {
  it("refuses once orders has a row, and writes nothing", async () => {
    const { deps, order } = fakeDeps({ countOrders: vi.fn(async () => 1) });
    const r = await runFirstLoad({ FIRST_ADMIN_PIN: "7391" }, deps);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("ORDERS_EXIST");
    expect(order).toEqual([]);
    expect(deps.insertAdmin).not.toHaveBeenCalled();
  });

  it("refuses a bad PIN before any seed step runs", async () => {
    const { deps, order } = fakeDeps();
    const r = await runFirstLoad({ FIRST_ADMIN_PIN: "1234" }, deps);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe("BAD_PIN");
      expect(r.message).not.toContain("1234");
    }
    expect(order).toEqual([]);
    expect(deps.hashPin).not.toHaveBeenCalled();
  });

  it("refuses when staff is empty and FIRST_ADMIN_PIN is unset", async () => {
    const { deps, order } = fakeDeps();
    const r = await runFirstLoad({}, deps);
    expect(r.ok).toBe(false);
    expect(order).toEqual([]);
  });

  it("on an empty database, loads every step in order, then creates exactly one active admin", async () => {
    const { deps, order } = fakeDeps();
    const r = await runFirstLoad({ FIRST_ADMIN_PIN: "7391" }, deps);
    expect(r).toEqual({ ok: true, ran: STEP_NAMES, skipped: [], adminCreated: true, existingStaff: [] });
    expect(order).toEqual([...STEP_NAMES, "admin"]);
    expect(deps.hashPin).toHaveBeenCalledWith("7391");
    expect(deps.insertAdmin).toHaveBeenCalledTimes(1);
    expect(deps.insertAdmin).toHaveBeenCalledWith({
      id: FIRST_ADMIN_ID,
      name: "Admin",
      role: "admin",
      pinHash: "hashed:4",
      active: true,
    });
  });

  it("re-run after a partial load (menu present, staff empty, no orders) still runs and creates the admin", async () => {
    const { deps, order } = fakeDeps();
    deps.steps[5] = { name: "operating hours", run: vi.fn(async () => void order.push("hours")), skipIf: async () => true };
    const r = await runFirstLoad({ FIRST_ADMIN_PIN: "58204" }, deps);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.skipped).toEqual(["operating hours"]);
      expect(r.adminCreated).toBe(true);
    }
    expect(order).not.toContain("hours");
    expect(order.at(-1)).toBe("admin");
  });

  it("creates no admin, needs no PIN, and returns names and roles when staff already has rows", async () => {
    const { deps, order } = fakeDeps({ listStaff: vi.fn(async () => [{ name: "Admin", role: "admin" }]) });
    const r = await runFirstLoad({}, deps);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.adminCreated).toBe(false);
      expect(r.existingStaff).toEqual([{ name: "Admin", role: "admin" }]);
    }
    expect(order).not.toContain("admin");
    expect(deps.insertAdmin).not.toHaveBeenCalled();
  });

  it("the admin PIN round-trips through the real hashPin and verifyPin", async () => {
    let stored = "";
    const { deps } = fakeDeps({
      hashPin,
      insertAdmin: async (row) => {
        stored = row.pinHash;
      },
    });
    await runFirstLoad({ FIRST_ADMIN_PIN: "902716" }, deps);
    expect(stored).not.toContain("902716");
    expect(stored.startsWith("$2")).toBe(true);
    expect(await verifyPin("902716", stored)).toBe(true);
    expect(await verifyPin("902717", stored)).toBe(false);
  });
});

describe("scripts/first-load.ts", () => {
  const src = readFileSync(join(process.cwd(), "scripts/first-load.ts"), "utf8");
  const code = src.replace(/^\s*\/\/.*$/gm, "");
  const specifiers = [...code.matchAll(/(?:from\s+|import\()\s*["']([^"']+)["']/g)].map((m) => m[1]);

  it("does not import the dev staff, demo customers, demo transactions or alert recipients seeds", () => {
    expect(specifiers.length).toBeGreaterThan(0);
    for (const s of specifiers) {
      expect(s).not.toMatch(/seed\/(staff|customers|demo-transactions|alert-recipients)$/);
    }
    for (const name of ["seedStaff", "seedCustomers", "seedAlertRecipients", "seedDemo", "STAFF_SEED"]) {
      expect(code).not.toContain(name);
    }
  });

  it("loads lots with no opening stock and without the orphaned lots", () => {
    expect(code).toContain("seedLots({ openingStock: false, excludeLotIds: ORPHANED_LOT_IDS })");
  });
});

describe("seedLots options", () => {
  beforeEach(() => {
    inserted.length = 0;
  });

  it("the orphaned lots' items are used by no recipe and no customisation", async () => {
    const { INVENTORY_LOTS, ORPHANED_LOT_IDS } = await import("@db/seed/lots");
    const { RECIPES } = await import("@db/seed/recipes");
    const { CUSTOMISATIONS } = await import("@db/seed/customisations");
    expect(ORPHANED_LOT_IDS).toEqual(["lot_espresso_beans_001", "lot_whole_milk_001"]);
    const items = INVENTORY_LOTS.filter((l) => ORPHANED_LOT_IDS.includes(l.id)).map((l) => l.inventoryItemId);
    expect(items).toEqual(["inv_item_espresso_beans", "inv_item_whole_milk"]);
    const used = new Set([
      ...RECIPES.flatMap((r) => r.ingredients.map((i) => i.inventoryItemId)),
      ...CUSTOMISATIONS.flatMap((c) => [c.substitutesInventoryItemId, c.addsInventoryItemId]),
    ]);
    for (const id of items) expect(used.has(id)).toBe(false);
  });

  it("default (the dev seed) is unchanged: 17 lots, each with an opening restock movement", async () => {
    const { seedLots } = await import("@db/seed/lots");
    const { stockMovements } = await import("@db/schema");
    await seedLots();
    const movements = inserted.filter((i) => i.table === stockMovements);
    expect(inserted).toHaveLength(34);
    expect(movements).toHaveLength(17);
  });

  it("openingStock false + orphaned excluded: 15 lot rows, all estimates, no stock movement", async () => {
    const { seedLots, ORPHANED_LOT_IDS } = await import("@db/seed/lots");
    const { stockMovements, inventoryLots } = await import("@db/schema");
    await seedLots({ openingStock: false, excludeLotIds: ORPHANED_LOT_IDS });
    expect(inserted.filter((i) => i.table === stockMovements)).toHaveLength(0);
    const lots = inserted.filter((i) => i.table === inventoryLots).map((i) => i.values as { id: string; costSource: string });
    expect(lots).toHaveLength(15);
    expect(lots.map((l) => l.id)).not.toContain("lot_espresso_beans_001");
    expect(lots.map((l) => l.id)).not.toContain("lot_whole_milk_001");
    expect(lots.every((l) => l.costSource === "estimate")).toBe(true);
  });
});
