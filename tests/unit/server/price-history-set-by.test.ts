// REQ-130 (PRD v7.0 §10.6, §7.0.1, §10.3 price_history row, §11 setMenuItemPrice):
// "Given an Admin changing a price · When setMenuItemPrice runs · Then a
// price_history row carries set_by_staff_id and the previous row is closed —
// and the write fails rather than proceeding anonymously."
//
// Calls the real menu actions with the DB mocked. The NOT NULL + FK on
// price_history.set_by_staff_id (migration 0052, provisional number) is the
// database half of "fails rather than proceeding anonymously"; it is exercised
// against real Postgres in tests/db/0052-up-down.test.ts (CI only).

import { describe, it, expect, vi, beforeEach } from "vitest";

type Call = { op: string; table: string; values?: Record<string, unknown> };
const calls: Call[] = [];
let selectQueue: unknown[][] = [];

function tableName(t: unknown): string {
  const sym = Object.getOwnPropertySymbols(t as object).find((s) => s.toString() === "Symbol(drizzle:Name)");
  return sym ? String((t as Record<symbol, unknown>)[sym]) : "?";
}

/** A chainable, awaitable query stub that resolves to `rows`. */
function chain(rows: unknown): Record<string, unknown> {
  const c: Record<string, unknown> = {};
  for (const m of ["from", "where", "innerJoin", "leftJoin", "orderBy", "set"]) c[m] = () => c;
  c.returning = () => Promise.resolve(rows);
  c.then = (res: (v: unknown) => void, rej: (e: unknown) => void) => Promise.resolve(rows).then(res, rej);
  return c;
}

function writer() {
  return {
    insert: (t: unknown) => ({
      values: (values: Record<string, unknown>) => {
        calls.push({ op: "insert", table: tableName(t), values });
        return chain([{ id: "m_new", name: "Oat Latte", category: "coffee", currentPriceZar: 4200, active: true }]);
      },
    }),
    update: (t: unknown) => ({
      set: (values: Record<string, unknown>) => {
        calls.push({ op: "update", table: tableName(t), values });
        return chain(undefined);
      },
    }),
  };
}

vi.mock("next/cache", () => ({ unstable_cache: (fn: unknown) => fn, revalidateTag: vi.fn() }));

vi.mock("@db/index", () => ({
  db: {
    select: vi.fn().mockImplementation(() => chain(selectQueue.shift() ?? [])),
    transaction: vi.fn().mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => cb(writer())),
  },
}));

vi.mock("@/server/audit", () => ({ writeAudit: vi.fn().mockResolvedValue(undefined) }));

const ADMIN = { id: "staff_admin_mia", name: "Mia", role: "admin" as const };
vi.mock("@/server/auth/guard", () => ({ authorize: vi.fn() }));

beforeEach(async () => {
  vi.clearAllMocks();
  calls.length = 0;
  selectQueue = [];
  const { authorize } = await import("@/server/auth/guard");
  vi.mocked(authorize).mockResolvedValue({ ok: true, session: ADMIN });
});

describe("setMenuItemPrice records who changed the price (REQ-130)", () => {
  it("closes the open row, then inserts the new row carrying the admin's staff id as setByStaffId", async () => {
    selectQueue = [
      [{ id: "m1", name: "Cappuccino", currentPriceZar: 3000 }], // existing item
      [{ id: "m1", name: "Cappuccino", category: "coffee", currentPriceZar: 3500, active: true }], // re-read
      [], // customisations
    ];
    const { setMenuItemPrice } = await import("@/server/actions/menu");
    const res = await setMenuItemPrice({ menuItemId: "m1", newPriceZar: 3500 });
    expect(res.ok).toBe(true);

    const history = calls.filter((c) => c.table === "price_history");
    expect(history.map((c) => c.op)).toEqual(["update", "insert"]);
    expect(history[0]!.values!.effectiveUntil).toBeInstanceOf(Date); // previous row closed
    expect(history[1]!.values).toMatchObject({
      menuItemId: "m1",
      priceZar: 3500,
      effectiveUntil: null,
      setByStaffId: "staff_admin_mia",
    });
  });

  it("fails and writes nothing when the session carries no staff id (never an anonymous row)", async () => {
    const { authorize } = await import("@/server/auth/guard");
    vi.mocked(authorize).mockResolvedValue({ ok: true, session: { ...ADMIN, id: "" } });
    selectQueue = [[{ id: "m1", name: "Cappuccino", currentPriceZar: 3000 }]];
    const { setMenuItemPrice } = await import("@/server/actions/menu");
    const res = await setMenuItemPrice({ menuItemId: "m1", newPriceZar: 3500 });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("UNAUTHORIZED");
    expect(calls).toEqual([]);
  });

  it("a non-admin is refused before anything is written", async () => {
    const { authorize } = await import("@/server/auth/guard");
    vi.mocked(authorize).mockResolvedValue({ ok: false, code: "FORBIDDEN", message: "You do not have permission to do that." });
    const { setMenuItemPrice } = await import("@/server/actions/menu");
    const res = await setMenuItemPrice({ menuItemId: "m1", newPriceZar: 3500 });
    expect(res.ok).toBe(false);
    expect(calls).toEqual([]);
  });
});

describe("createMenuItem's opening price row also records who (REQ-130)", () => {
  it("inserts the first price_history row with setByStaffId = the admin", async () => {
    selectQueue = [[]]; // no duplicate
    const { createMenuItem } = await import("@/server/actions/menu");
    const res = await createMenuItem({ name: "Oat Latte", category: "coffee", priceZar: 4200 });
    expect(res.ok).toBe(true);
    const row = calls.find((c) => c.table === "price_history" && c.op === "insert");
    expect(row?.values).toMatchObject({ priceZar: 4200, setByStaffId: "staff_admin_mia" });
  });
});

describe("getMenuItemPriceHistory returns who set each price (REQ-130)", () => {
  it("maps the joined staff name onto each row", async () => {
    const from = new Date("2026-08-16T08:00:00+02:00");
    selectQueue = [[
      { id: "ph1", priceZar: 3500, effectiveFrom: from, effectiveUntil: null, setByStaffId: "staff_admin_mia", setByStaffName: "Mia" },
    ]];
    const { getMenuItemPriceHistory } = await import("@/server/actions/menu");
    const res = await getMenuItemPriceHistory("m1");
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data).toEqual([
        {
          id: "ph1",
          priceZar: 3500,
          effectiveFrom: from.toISOString(),
          effectiveUntil: null,
          setByStaffId: "staff_admin_mia",
          setByStaffName: "Mia",
        },
      ]);
    }
  });
});
