// Till P2 (R3 barista): on a weekday, an out-of-stock 8 oz cup must not mark
// Americano OUT — REQ-125 / L24: weekday orders use no cup or lid (own mugs).
import { describe, it, expect, vi, beforeEach } from "vitest";
import { inventoryItems, openingSessions } from "@db/schema";

let sessionModes: string[] = [];

const ITEMS = [
  { id: "inv_item_cup_8oz", name: "8 oz Cup", kind: "packaging", unit: "unit", lowStockThreshold: 50 },
  { id: "inv_item_lid", name: "Lid", kind: "packaging", unit: "unit", lowStockThreshold: 50 },
  { id: "inv_item_chai", name: "Chai Powder", kind: "consumable", unit: "g", lowStockThreshold: 100 },
];

vi.mock("@/server/auth/guard", () => ({
  authorize: vi.fn().mockResolvedValue({ ok: true, session: { id: "s1", role: "barista", name: "Sam" } }),
}));
vi.mock("@/server/audit", () => ({ writeAudit: vi.fn() }));
vi.mock("@/server/cogs/compute", () => ({ todaySast: () => "2026-10-27" }));
vi.mock("@/lib/db", () => {
  const select = () => {
    let table: unknown;
    const chain: Record<string, unknown> = {};
    for (const k of ["innerJoin", "where", "limit", "orderBy", "groupBy"]) chain[k] = () => chain;
    chain.from = (t: unknown) => { table = t; return chain; };
    chain.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => {
      let rows: unknown[];
      if (table === inventoryItems) rows = ITEMS;
      else if (table === openingSessions) rows = sessionModes.map((mode) => ({ mode }));
      else rows = [{ total: -66 }]; // every running-stock SUM: negative → "out"
      return Promise.resolve(rows).then(res, rej);
    };
    return chain;
  };
  return { db: { select } };
});

describe("listInventoryStatus — cups and lids follow the mode (REQ-125)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("weekday: cups and lids are left out of the till's status map", async () => {
    sessionModes = ["weekday"];
    const { listInventoryStatus } = await import("@/server/actions/inventory");
    const r = await listInventoryStatus();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.statusMap["inv_item_cup_8oz"]).toBeUndefined();
    expect(r.data.statusMap["inv_item_lid"]).toBeUndefined();
    expect(r.data.statusMap["inv_item_chai"]?.status).toBe("out");
  });

  it("Sunday: an out cup is still reported out", async () => {
    sessionModes = ["sunday"];
    const { listInventoryStatus } = await import("@/server/actions/inventory");
    const r = await listInventoryStatus();
    if (!r.ok) throw new Error("expected ok");
    expect(r.data.statusMap["inv_item_cup_8oz"]?.status).toBe("out");
  });

  it("no session today: cups are still checked (not a weekday by the mode rule)", async () => {
    sessionModes = [];
    const { listInventoryStatus } = await import("@/server/actions/inventory");
    const r = await listInventoryStatus();
    if (!r.ok) throw new Error("expected ok");
    expect(r.data.statusMap["inv_item_lid"]?.status).toBe("out");
  });
});
