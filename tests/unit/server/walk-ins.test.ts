// AT-209 (first slice) — walk-ins. PRD §6.5, §10.2, L20, REQ-058, REQ-116, REQ-064.
//
// logWalkIn(orderId, menuItemId, quantity) inserts one walk_ins row per order
// LINE carrying the item and quantity and NO customer reference of any kind;
// it never touches staff_entitlement_log and never charges (no payments,
// orders or order_items write). Refusals are returned, not thrown, and each is
// audited action='reject' (REQ-064).
//
// The DB is mocked: every select resolves rows by the table it reads, and
// every write is recorded so the test asserts what was (and was not) written.
// The DB CHECK (quantity >= 1) and REQ-116 against real Postgres are in
// tests/db/0034-up-down.test.ts.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { drizzle } from "drizzle-orm/postgres-js";
import { getTableColumns } from "drizzle-orm";
import {
  orders, orderItems, payments, staffEntitlementLog, walkIns,
} from "@db/schema";

const mockAuthorize = vi.fn(async (..._roles: string[]) => ({
  ok: true as boolean,
  session: { id: "staff_louis", role: "barista" },
  code: undefined as string | undefined,
  message: undefined as string | undefined,
}));
vi.mock("@/server/auth/guard", () => ({
  authorize: (...r: string[]) => mockAuthorize(...r),
}));

const mockWriteAudit = vi.fn(async (..._a: unknown[]) => {});
vi.mock("@/server/audit", () => ({ writeAudit: (...a: unknown[]) => mockWriteAudit(...a) }));

// ─── Table-aware DB mock ──────────────────────────────────────────────────────
type Row = Record<string, unknown>;
let rows = new Map<unknown, Row[]>();
const reads: unknown[] = [];
const inserts: { table: unknown; values: unknown }[] = [];
const updates: unknown[] = [];
const deletes: unknown[] = [];

function selectChain() {
  let table: unknown;
  const c: Record<string, unknown> = {};
  for (const m of ["where", "innerJoin", "leftJoin", "orderBy", "limit", "for"]) {
    c[m] = () => c;
  }
  c.from = (t: unknown) => { table = t; reads.push(t); return c; };
  c.then = (resolve: (v: Row[]) => void, reject: (e: unknown) => void) =>
    Promise.resolve(rows.get(table) ?? []).then(resolve, reject);
  return c;
}

const client = {
  select: () => selectChain(),
  insert: (table: unknown) => ({
    values: (values: unknown) => {
      inserts.push({ table, values });
      return Object.assign(Promise.resolve(), { returning: async () => [{ id: "walkin_1" }] });
    },
  }),
  update: (table: unknown) => ({ set: () => ({ where: async () => { updates.push(table); } }) }),
  delete: (table: unknown) => ({ where: async () => { deletes.push(table); } }),
};

vi.mock("@/lib/db", () => ({
  db: {
    select: () => client.select(),
    insert: (t: unknown) => client.insert(t),
    update: (t: unknown) => client.update(t),
    delete: (t: unknown) => client.delete(t),
    transaction: async (cb: (tx: unknown) => Promise<unknown>) => cb(client),
  },
}));

import { logWalkIn } from "@/server/actions/walk-ins";
import { walkInCupsQuery } from "@/server/reports/walk-in-cups";

// ─── Fixtures ─────────────────────────────────────────────────────────────────
// One order, two lines: an Americano ×2 for a walk-in visitor, and a
// Cappuccino ×1 that is not a walk-in (REQ-116's shape).
const ORDER = { id: "order_1", state: "ordered" };
const AMERICANO_LINE = { quantity: 2, category: "coffee" };

function given(opts: { order?: Row | null; lines?: Row[]; logged?: Row[] } = {}) {
  rows = new Map<unknown, Row[]>([
    [orders, opts.order === null ? [] : [opts.order ?? ORDER]],
    // An undiscounted, uncomped line unless the test says otherwise.
    [orderItems, (opts.lines ?? [AMERICANO_LINE]).map((l) => ({ discountZar: 0, compReason: null, ...l }))],
    [walkIns, opts.logged ?? []],
  ]);
}

const insertsInto = (t: unknown) => inserts.filter((i) => i.table === t).map((i) => i.values);
const auditCalls = () => mockWriteAudit.mock.calls.map((c) => c[0] as Row);

beforeEach(() => {
  vi.clearAllMocks();
  inserts.length = 0; updates.length = 0; deletes.length = 0; reads.length = 0;
  mockAuthorize.mockResolvedValue({
    ok: true, session: { id: "staff_louis", role: "barista" }, code: undefined, message: undefined,
  });
  given();
});

describe("logWalkIn writes one walk_ins row with no identity (REQ-058, L20)", () => {
  it("writes exactly one row: order, item, quantity, category from the menu item, the barista — and nothing else", async () => {
    const res = await logWalkIn("order_1", "menu_americano", 2);

    expect(res).toEqual({ ok: true, data: { walkInId: "walkin_1" } });
    expect(insertsInto(walkIns)).toEqual([
      {
        orderId: "order_1",
        menuItemId: "menu_americano",
        quantity: 2,
        category: "coffee",
        loggedByStaffId: "staff_louis",
      },
    ]);
    // Only the walk_ins row is written (the audit row is the separate writeAudit).
    expect(inserts).toHaveLength(1);
  });

  it("the row carries no customer reference of any kind, and the table has no identity column", async () => {
    await logWalkIn("order_1", "menu_americano", 1);
    const [row] = insertsInto(walkIns) as Row[];
    for (const k of Object.keys(row)) {
      expect(k).not.toMatch(/customer|name|email|phone|surname/i);
    }
    const columns = Object.values(getTableColumns(walkIns)).map((c) => c.name);
    expect(columns.sort()).toEqual(
      ["at", "category", "id", "logged_by_staff_id", "menu_item_id", "order_id", "quantity", "tenant_id"]
    );
  });

  it("never touches staff_entitlement_log, and never charges (no payments / orders / order_items write)", async () => {
    await logWalkIn("order_1", "menu_americano", 2);
    expect(reads).not.toContain(staffEntitlementLog);
    expect(inserts.map((i) => i.table)).toEqual([walkIns]);
    expect(updates).toEqual([]);
    expect(deletes).toEqual([]);
    expect(insertsInto(payments)).toEqual([]);
    expect(insertsInto(staffEntitlementLog)).toEqual([]);
  });

  it("is audited: one 'create' row on the walk_in, inside the transaction", async () => {
    await logWalkIn("order_1", "menu_americano", 2);
    expect(mockWriteAudit).toHaveBeenCalledTimes(1);
    expect(auditCalls()[0]).toMatchObject({
      entityKind: "walk_in", entityId: "walkin_1", action: "create",
      actorId: "staff_louis", actorRole: "barista",
      after: { orderId: "order_1", menuItemId: "menu_americano", quantity: 2, category: "coffee" },
    });
    expect(mockWriteAudit.mock.calls[0][1]).toBe(client); // the tx, so a failed audit fails the write
  });

  it("no daily limit: a walk-in is logged however many were logged today (barista discretion, §6.5)", async () => {
    // Earlier walk-ins today on OTHER orders are irrelevant; only this line's own
    // already-logged quantity counts (see over-quantity below).
    given({ lines: [{ quantity: 1, category: "coffee" }], logged: [] });
    const res = await logWalkIn("order_9", "menu_americano", 1);
    expect(res.ok).toBe(true);
  });
});

describe("logWalkIn refusals are returned and audited action='reject' (REQ-064)", () => {
  async function expectRejected(res: Awaited<ReturnType<typeof logWalkIn>>, code: string) {
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.code).toBe(code);
    expect(insertsInto(walkIns)).toEqual([]);
    expect(mockWriteAudit).toHaveBeenCalledTimes(1);
    expect(auditCalls()[0]).toMatchObject({
      entityKind: "walk_in", action: "reject", actorId: "staff_louis", reason: code,
      after: expect.objectContaining({ attempted: "walk_in", code }),
    });
  }

  it("quantity 0 → INVALID_INPUT", async () => {
    await expectRejected(await logWalkIn("order_1", "menu_americano", 0), "INVALID_INPUT");
  });

  it("quantity 1.5 and -1 → INVALID_INPUT", async () => {
    await expectRejected(await logWalkIn("order_1", "menu_americano", 1.5), "INVALID_INPUT");
    vi.clearAllMocks();
    await expectRejected(await logWalkIn("order_1", "menu_americano", -1), "INVALID_INPUT");
  });

  it("unknown order → NOT_FOUND", async () => {
    given({ order: null });
    await expectRejected(await logWalkIn("order_missing", "menu_americano", 1), "NOT_FOUND");
  });

  it("menu item not on that order → NOT_ON_ORDER", async () => {
    given({ lines: [] });
    await expectRejected(await logWalkIn("order_1", "menu_mocha", 1), "NOT_ON_ORDER");
  });

  it("quantity above the line's quantity → QUANTITY_EXCEEDS_LINE", async () => {
    await expectRejected(await logWalkIn("order_1", "menu_americano", 3), "QUANTITY_EXCEEDS_LINE");
  });

  it("quantity above what is left on the line after earlier walk-in logs → QUANTITY_EXCEEDS_LINE", async () => {
    given({ logged: [{ quantity: 2 }] });
    await expectRejected(await logWalkIn("order_1", "menu_americano", 1), "QUANTITY_EXCEEDS_LINE");
  });

  // Walk-in cups are disjoint from entitlement cups (§7.0.2): a unit already
  // made free is not loggable. Free cup / voucher = one unit (L03, §6.9.1);
  // comp = the whole line (L33). Americano R30,00 = 3000 cents.
  it("3a. the order's only cup is the free staff cup (qty 1, discount 3000) → QUANTITY_EXCEEDS_LINE", async () => {
    given({ lines: [{ quantity: 1, discountZar: 3000, compReason: null, category: "coffee" }] });
    await expectRejected(await logWalkIn("order_1", "menu_americano", 1), "QUANTITY_EXCEEDS_LINE");
  });

  it("3b. qty-2 line with one free cup (discount 3000): 1 walk-in allowed, a 2nd refused", async () => {
    const line = { quantity: 2, discountZar: 3000, compReason: null, category: "coffee" };
    given({ lines: [line] });
    expect((await logWalkIn("order_1", "menu_americano", 1)).ok).toBe(true);
    expect(insertsInto(walkIns)).toHaveLength(1);

    vi.clearAllMocks();
    inserts.length = 0;
    given({ lines: [line], logged: [{ quantity: 1 }] });
    await expectRejected(await logWalkIn("order_1", "menu_americano", 1), "QUANTITY_EXCEEDS_LINE");
  });

  it("3b'. asking for 2 at once on that qty-2 free-cup line → QUANTITY_EXCEEDS_LINE", async () => {
    given({ lines: [{ quantity: 2, discountZar: 3000, compReason: null, category: "coffee" }] });
    await expectRejected(await logWalkIn("order_1", "menu_americano", 2), "QUANTITY_EXCEEDS_LINE");
  });

  it("3c. the same menu item on two lines (qty 2 with a free cup + qty 1 plain) → cap 2: 2 allowed, 3 refused", async () => {
    const lines = [
      { quantity: 2, discountZar: 3000, compReason: null, category: "coffee" },
      { quantity: 1, discountZar: 0, compReason: null, category: "coffee" },
    ];
    given({ lines });
    expect((await logWalkIn("order_1", "menu_americano", 2)).ok).toBe(true);
    expect((insertsInto(walkIns)[0] as Row).quantity).toBe(2);

    vi.clearAllMocks();
    inserts.length = 0;
    given({ lines });
    await expectRejected(await logWalkIn("order_1", "menu_americano", 3), "QUANTITY_EXCEEDS_LINE");
  });

  it("3d. a comped qty-2 line (comp_reason set, discount 6000) allows 0 walk-in cups", async () => {
    given({ lines: [{ quantity: 2, discountZar: 6000, compReason: "spillage", category: "coffee" }] });
    await expectRejected(await logWalkIn("order_1", "menu_americano", 1), "QUANTITY_EXCEEDS_LINE");
  });

  it("cancelled order → ORDER_CANCELLED", async () => {
    given({ order: { id: "order_1", state: "cancelled" } });
    await expectRejected(await logWalkIn("order_1", "menu_americano", 1), "ORDER_CANCELLED");
  });

  it("a non-POS session is refused by the POS role guard and nothing is written", async () => {
    mockAuthorize.mockResolvedValue({
      ok: false, session: undefined as never, code: "FORBIDDEN", message: "You do not have permission to do that.",
    });
    const res = await logWalkIn("order_1", "menu_americano", 1);
    expect(mockAuthorize).toHaveBeenCalledWith("barista", "admin");
    expect(res).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(inserts).toEqual([]);
  });
});

describe("walk_in_cups = Σ walk_ins.quantity (REQ-116, §7.0.2)", () => {
  // The mock ignores the WHERE filter, so this checks only the inserted row's
  // quantity. The real REQ-116 proof (Σ over real rows = 2, not 3) is in
  // tests/db/0034-up-down.test.ts.
  it("logWalkIn on the Americano ×2 line inserts a row with quantity 2 (the line's walk-in cups, as asked)", async () => {
    given({ lines: [AMERICANO_LINE] }); // the Cappuccino ×1 line is a different menu item
    await logWalkIn("order_1", "menu_americano", 2);
    expect((insertsInto(walkIns)[0] as Row).quantity).toBe(2);
  });

  it("the helper sums walk_ins.quantity only — it never reads order_items", () => {
    const { sql, params } = walkInCupsQuery(drizzle.mock(), {
      fromDay: "2026-10-08", toDay: "2026-10-08",
    }).toSQL();
    expect(sql).toContain('sum("walk_ins"."quantity")');
    expect(sql).not.toContain("order_items");
    expect(sql).toContain('"orders"."revenue_day" >= $1');
    expect(sql).toContain('"orders"."revenue_day" <= $2');
    expect(params).toEqual(["2026-10-08", "2026-10-08"]);
  });
});
