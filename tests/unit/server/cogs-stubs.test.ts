// GY stub tests — verifies that all Phase 2 stubs are callable, type-safe,
// and return the expected fixture shapes.  No DB connection required.
//
// authorize is mocked globally here because real implementations (added in G10+)
// chain into next-auth → next/server which is unavailable in the jsdom test env.

import { describe, it, expect, vi } from "vitest";

vi.mock("@/server/auth/guard", () => ({
  authorize: vi.fn().mockResolvedValue({
    ok: true,
    session: { id: "staff_manager_mia", name: "Mia", role: "admin" },
  }),
}));

// Prevent any real DB connection attempts (functions with real impls post-G10+).
// The chain mock supports: select().from().where/innerJoin/orderBy → []
vi.mock("@db/index", () => {
  const chain = {
    from: vi.fn(),
    where: vi.fn(),
    innerJoin: vi.fn(),
    leftJoin: vi.fn(),
    orderBy: vi.fn().mockResolvedValue([]),
  };
  chain.from.mockReturnValue(chain);
  chain.where.mockReturnValue(chain);
  chain.innerJoin.mockReturnValue(chain);
  chain.leftJoin.mockReturnValue(chain);
  return {
    db: {
      select: vi.fn().mockReturnValue(chain),
      insert: vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue([]) }),
      update: vi.fn().mockReturnValue({ set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }) }),
      transaction: vi.fn(),
    },
  };
});
import { getCogsLive, getCogsHistory } from "@/server/actions/cogs";
import { listInventory, listLots, listInventoryStatus, getActiveBeanLot } from "@/server/actions/inventory";
import { listExpenses } from "@/server/actions/expenses";
import { listPurchases } from "@/server/actions/purchases";
import { listStockTakes } from "@/server/actions/stock-takes";
import { getRecipe, listRecipes } from "@/server/actions/recipes";
import { listMonthlyReports } from "@/server/actions/monthly-pnl";
import { listStockAlertRecipients } from "@/server/actions/alert-recipients";

// ─── getCogsLive ──────────────────────────────────────────────────────────────

describe("getCogsLive stub", () => {
  it("returns ok:true with a CogsLive shape", async () => {
    const result = await getCogsLive();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { data } = result;
    expect(data.revenueZar).toBeGreaterThan(0);
    expect(data.grossMarginZar).toBe(data.revenueZar - data.cogsZar);
    expect(data.netZar).toBe(data.grossMarginZar - data.expensesZar);
    expect(data.profit).toBe(data.netZar > 0);
    expect(typeof data.costEstimatedWarning).toBe("boolean");
    expect(data.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("getCogsHistory stub", () => {
  it("returns 14 days of history", async () => {
    const result = await getCogsHistory({ days: 14 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.history).toHaveLength(14);
  });

  it("each history entry has the correct computed fields", async () => {
    const result = await getCogsHistory();
    if (!result.ok) return;
    for (const entry of result.data.history) {
      expect(entry.grossMarginZar).toBe(entry.revenueZar - entry.cogsZar);
      expect(entry.netZar).toBe(entry.grossMarginZar - entry.expensesZar);
      expect(entry.profit).toBe(entry.netZar > 0);
    }
  });
});

// ─── listInventory ────────────────────────────────────────────────────────────

describe("listInventory stub", () => {
  it("returns 8 items", async () => {
    const result = await listInventory();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.items).toHaveLength(8);
  });

  it("every item has a valid status", async () => {
    const result = await listInventory();
    if (!result.ok) return;
    for (const item of result.data.items) {
      expect(["ok", "low", "out"]).toContain(item.status);
    }
  });

  it("oat milk is 'low' (fixture: below threshold)", async () => {
    const result = await listInventory();
    if (!result.ok) return;
    const oat = result.data.items.find((i) => i.id === "inv_item_oat_milk");
    expect(oat?.status).toBe("low");
  });
});

// ─── listLots ─────────────────────────────────────────────────────────────────

describe("listLots stub", () => {
  it("returns lots for espresso beans", async () => {
    const result = await listLots("inv_item_espresso_beans");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.lots.length).toBeGreaterThan(0);
    for (const lot of result.data.lots) {
      expect(lot.inventoryItemId).toBe("inv_item_espresso_beans");
    }
  });

  it("returns empty array for unknown item", async () => {
    const result = await listLots("inv_item_unknown_xyz");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.lots).toHaveLength(0);
  });
});

// ─── listInventoryStatus ──────────────────────────────────────────────────────

describe("listInventoryStatus stub", () => {
  it("returns a map keyed by item id", async () => {
    const result = await listInventoryStatus();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.statusMap["inv_item_espresso_beans"]).toBeDefined();
    expect(result.data.statusMap["inv_item_lid"]).toBeDefined();
  });
});

// ─── getActiveBeanLot ─────────────────────────────────────────────────────────

describe("getActiveBeanLot stub", () => {
  it("returns the active bean lot with origin info", async () => {
    const result = await getActiveBeanLot();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.lot).not.toBeNull();
    expect(result.data.lot?.inventoryItemId).toBe("inv_item_espresso_beans");
    expect(result.data.lot?.origin).toBeTruthy();
  });
});

// ─── listExpenses ─────────────────────────────────────────────────────────────

describe("listExpenses stub", () => {
  it("returns expenses with correct money shape", async () => {
    const result = await listExpenses();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.expenses.length).toBeGreaterThan(0);
    for (const exp of result.data.expenses) {
      expect(Number.isInteger(exp.amountZar)).toBe(true);
      expect(exp.amountZar).toBeGreaterThan(0);
    }
  });
});

// ─── listPurchases ────────────────────────────────────────────────────────────

describe("listPurchases", () => {
  it("returns ok:true with purchases array (real impl post-G10, DB mocked)", async () => {
    const result = await listPurchases();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // DB is mocked to return [] — just verify the shape is correct
    expect(Array.isArray(result.data.purchases)).toBe(true);
    expect(typeof result.data.total).toBe("number");
  });
});

// ─── listStockTakes ───────────────────────────────────────────────────────────

describe("listStockTakes", () => {
  it("returns ok:true with takes array (real impl post-G11, DB mocked)", async () => {
    const result = await listStockTakes();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // DB mocked to return [] — just verify shape
    expect(Array.isArray(result.data.takes)).toBe(true);
    expect(typeof result.data.total).toBe("number");
  });
});

// ─── getRecipe ────────────────────────────────────────────────────────────────

describe("getRecipe stub", () => {
  it("returns cappuccino recipe with 4 ingredients", async () => {
    const result = await getRecipe("menu_cappuccino");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.recipe).not.toBeNull();
    expect(result.data.recipe?.ingredients).toHaveLength(4);
  });

  it("returns null for an item with no recipe", async () => {
    const result = await getRecipe("menu_croissant");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.recipe).toBeNull();
  });
});

describe("listRecipes stub", () => {
  it("returns at least 4 recipes", async () => {
    const result = await listRecipes();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.recipes.length).toBeGreaterThanOrEqual(4);
  });
});

// ─── listMonthlyReports ───────────────────────────────────────────────────────

describe("listMonthlyReports stub", () => {
  it("returns reports including a closed and an awaiting-signatures one", async () => {
    const result = await listMonthlyReports();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const statuses = result.data.reports.map((r) => r.status);
    expect(statuses).toContain("closed");
    expect(statuses).toContain("awaiting_signatures");
  });

  it("closed report has both sigs non-null", async () => {
    const result = await listMonthlyReports();
    if (!result.ok) return;
    const closed = result.data.reports.find((r) => r.status === "closed");
    expect(closed?.adminSig).not.toBeNull();
    expect(closed?.financeSig).not.toBeNull();
    expect(closed?.closedAt).not.toBeNull();
  });
});

// ─── listStockAlertRecipients ─────────────────────────────────────────────────

describe("listStockAlertRecipients stub", () => {
  it("returns at least one global recipient", async () => {
    const result = await listStockAlertRecipients();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const globals = result.data.recipients.filter(
      (r) => r.inventoryItemId === null
    );
    expect(globals.length).toBeGreaterThan(0);
  });
});
