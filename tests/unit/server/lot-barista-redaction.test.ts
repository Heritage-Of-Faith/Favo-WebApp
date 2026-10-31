// R3-SEC-1: a barista's lot reads carry no supplier name and no cost.
import { describe, it, expect, vi } from "vitest";
import { inventoryItems, inventoryLots } from "@db/schema";

const role = { current: "barista" };

const LOT = {
  id: "lot_1", inventoryItemId: "inv_item_espresso_beans", sourceName: "Origin Coffee Roasters",
  batchNumber: "OCR-2026-05-01", roastDate: null, receivedAt: new Date("2026-10-01T08:00:00Z"),
  state: "active", origin: null, unitCostZar: "0.4500", quantityReceived: "2000.00",
  openedAt: null, closedAt: null, containerSize: null, containerSizeUnit: null, containerCostZar: 9000,
};

vi.mock("@/server/auth/guard", () => ({
  authorize: vi.fn().mockImplementation(async () => ({ ok: true, session: { id: "s1", role: role.current, name: "X" } })),
}));
vi.mock("@/server/audit", () => ({ writeAudit: vi.fn() }));
vi.mock("@/lib/db", () => {
  const select = () => {
    let table: unknown;
    const chain: Record<string, unknown> = {};
    for (const k of ["innerJoin", "where", "limit", "orderBy", "groupBy"]) chain[k] = () => chain;
    chain.from = (t: unknown) => { table = t; return chain; };
    chain.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => {
      const rows =
        table === inventoryLots ? [LOT]
        : table === inventoryItems ? [{ name: "Espresso Beans", unit: "g" }]
        : [{ lotId: "lot_1", total: 500 }];
      return Promise.resolve(rows).then(res, rej);
    };
    return chain;
  };
  return { db: { select } };
});

describe("lot reads redact supplier and cost for a barista (R3-SEC-1)", () => {
  it("getActiveBeanLot: barista gets no sourceName / unitCostZar; admin does", async () => {
    const { getActiveBeanLot } = await import("@/server/actions/inventory");
    role.current = "barista";
    const b = await getActiveBeanLot();
    if (!b.ok || !b.data.lot) throw new Error("expected a lot");
    expect(b.data.lot.sourceName).toBeNull();
    expect(b.data.lot.unitCostZar).toBeNull();
    expect(b.data.lot.batchNumber).toBe("OCR-2026-05-01");

    role.current = "admin";
    const a = await getActiveBeanLot();
    if (!a.ok || !a.data.lot) throw new Error("expected a lot");
    expect(a.data.lot.sourceName).toBe("Origin Coffee Roasters");
    expect(a.data.lot.unitCostZar).toBe("0.4500");
  });

  it("listLots: barista gets no supplier, unit cost or container cost", async () => {
    const { listLots } = await import("@/server/actions/inventory");
    role.current = "barista";
    const r = await listLots("inv_item_espresso_beans");
    if (!r.ok) throw new Error("expected ok");
    expect(r.data.lots[0]).toMatchObject({ sourceName: null, unitCostZar: null, containerCostZar: null });
    expect(JSON.stringify(r.data)).not.toContain("Origin Coffee Roasters");
  });
});
