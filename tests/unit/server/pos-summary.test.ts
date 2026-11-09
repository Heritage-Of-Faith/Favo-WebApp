// POS daily summary server-action unit tests — pos-summary.ts
// Tests RBAC guard, happy path, and zero-count handling for getPosToday.

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("@db/index", () => ({
  db: {
    execute: vi.fn().mockResolvedValue([{ revenue_zar: "15000", n: "5" }]),
  },
}));

vi.mock("@/server/auth/guard", () => ({
  authorize: vi.fn().mockResolvedValue({
    ok: true,
    session: { id: "staff_admin_gian", name: "Gian", role: "admin" },
  }),
}));

vi.mock("@/server/cogs/compute", () => ({
  todaySast: vi.fn().mockReturnValue("2026-06-14"),
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

const FORBIDDEN_RESULT = { ok: false as const, code: "FORBIDDEN" as const, message: "Insufficient role." };
const UNAUTHORIZED_RESULT = { ok: false as const, code: "UNAUTHORIZED" as const, message: "Not authenticated." };

// ─── getPosToday — RBAC ───────────────────────────────────────────────────────

describe("getPosToday — RBAC", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns FORBIDDEN for unauthenticated caller", async () => {
    const { authorize } = await import("@/server/auth/guard");
    vi.mocked(authorize).mockResolvedValueOnce(UNAUTHORIZED_RESULT);
    const { getPosToday } = await import("@/server/actions/pos-summary");
    const result = await getPosToday();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("UNAUTHORIZED");
  });

  it("returns FORBIDDEN when role is insufficient", async () => {
    const { authorize } = await import("@/server/auth/guard");
    vi.mocked(authorize).mockResolvedValueOnce(FORBIDDEN_RESULT);
    const { getPosToday } = await import("@/server/actions/pos-summary");
    const result = await getPosToday();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("FORBIDDEN");
  });
});

// ─── getPosToday — happy path ─────────────────────────────────────────────────

describe("getPosToday — happy path", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns ok with correct shape and types", async () => {
    const { db } = await import("@db/index");
    // Three sequential execute calls: revenue, orderCount, wasteCount
    vi.mocked(db.execute)
      .mockResolvedValueOnce([{ revenue_zar: "15000", n: "5" }] as never)
      .mockResolvedValueOnce([{ revenue_zar: null, n: "3" }] as never)
      .mockResolvedValueOnce([{ revenue_zar: null, n: "2" }] as never);

    const { getPosToday } = await import("@/server/actions/pos-summary");
    const result = await getPosToday();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.date).toBe("2026-06-14");
      expect(typeof result.data.orderCount).toBe("number");
      expect(typeof result.data.revenueZar).toBe("number");
      expect(typeof result.data.wasteCount).toBe("number");
      expect(result.data.revenueZar).toBe(15000);
      expect(result.data.orderCount).toBe(3);
      expect(result.data.wasteCount).toBe(2);
    }
  });
});

// ─── getPosToday — zero/null handling ────────────────────────────────────────

describe("getPosToday — zero/null handling", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns zero values when execute returns null fields", async () => {
    const { db } = await import("@db/index");
    vi.mocked(db.execute)
      .mockResolvedValueOnce([{ revenue_zar: null, n: null }] as never)
      .mockResolvedValueOnce([{ revenue_zar: null, n: null }] as never)
      .mockResolvedValueOnce([{ revenue_zar: null, n: null }] as never);

    const { getPosToday } = await import("@/server/actions/pos-summary");
    const result = await getPosToday();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.revenueZar).toBe(0);
      expect(result.data.orderCount).toBe(0);
      expect(result.data.wasteCount).toBe(0);
    }
  });

  it("returns zero values when execute returns empty array (no rows)", async () => {
    const { db } = await import("@db/index");
    vi.mocked(db.execute)
      .mockResolvedValueOnce([] as never)
      .mockResolvedValueOnce([] as never)
      .mockResolvedValueOnce([] as never);

    const { getPosToday } = await import("@/server/actions/pos-summary");
    const result = await getPosToday();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.revenueZar).toBe(0);
      expect(result.data.orderCount).toBe(0);
      expect(result.data.wasteCount).toBe(0);
    }
  });
});

// ─── getPosToday — REQ-128 / REQ-129 (PRD §7.5, §7.0.2) ───────────────────────

describe("getPosToday — REQ-128: drinks, fee, net, write-offs, comps, entitlement and walk-in cups", () => {
  beforeEach(() => vi.clearAllMocks());

  async function run(day: Record<string, string | null>) {
    const { db } = await import("@db/index");
    vi.mocked(db.execute)
      .mockResolvedValueOnce([{ revenue_zar: "26000" }] as never)
      .mockResolvedValueOnce([{ n: "13" }] as never)
      .mockResolvedValueOnce([{ n: "0" }] as never)
      .mockResolvedValueOnce([day] as never);
    const { getPosToday } = await import("@/server/actions/pos-summary");
    const r = await getPosToday();
    if (!r.ok) throw new Error(r.message);
    return { data: r.data, sql: vi.mocked(db.execute).mock.calls[3][0] as unknown as { queryChunks: unknown[] } };
  }

  const DAY = {
    drinks: "17", card_gross_zar: "26000", topups_settled_zar: "0", fee_sum_zar: "0", fee_unknown: "13",
    written_off_zar: "2000", comps_zar: "2000", entitlement_cups: "4", walk_in_cups: "2",
  };

  it("returns every line REQ-128 lists", async () => {
    const { data } = await run(DAY);
    expect(data).toMatchObject({
      orderCount: 13, revenueZar: 26000, drinks: 17,
      writtenOffZar: 2000, compsZar: 2000, entitlementCups: 4, walkInCups: 2,
    });
  });

  it("REQ-129: settled card payments with no fee yet → fee and net are UNAVAILABLE (null), never 0", async () => {
    const { data } = await run(DAY);
    expect(data.feeZar).toBeNull();
    expect(data.netSettledZar).toBeNull();
  });

  it("every fee known → net = card gross + top-ups − fee", async () => {
    const { data } = await run({ ...DAY, fee_unknown: "0", fee_sum_zar: "750", topups_settled_zar: "10000" });
    expect(data.feeZar).toBe(750);
    expect(data.netSettledZar).toBe(35250);
  });

  it("REQ-129: a day with no orders shows zeroes", async () => {
    const zero = Object.fromEntries(Object.keys(DAY).map((k) => [k, "0"]));
    const { data } = await run(zero);
    expect(data).toMatchObject({
      drinks: 0, feeZar: 0, netSettledZar: 0, writtenOffZar: 0, compsZar: 0, entitlementCups: 0, walkInCups: 0,
    });
  });

  it("reads each term from the table §7.0.2 names", async () => {
    const { sql } = await run(DAY);
    const text = sql.queryChunks
      .map((c) => (c && typeof c === "object" && "value" in c ? (c as { value: string[] }).value.join("") : ""))
      .join(" ");
    expect(text).toContain("comp_reason IS NOT NULL");
    expect(text).toContain("FROM staff_entitlement_log");
    expect(text).toContain("FROM walk_ins");
    expect(text).toContain("written_off_at IS NOT NULL");
    expect(text).toContain("p.fee_zar IS NULL");
    expect(text).toContain("payment_mode IN ('yoco', 'yoco_deferred')");
  });
});

// ─── getDailyItemHistory (AT-146) ─────────────────────────────────────────────

const MENU = [
  { id: "menu_americano", name: "Americano" },
  { id: "menu_cappuccino", name: "Cappuccino" },
  { id: "menu_hot_chocolate", name: "Hot Chocolate" },
];

describe("getDailyItemHistory — AT-146", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects unauthenticated callers", async () => {
    const { authorize } = await import("@/server/auth/guard");
    vi.mocked(authorize).mockResolvedValueOnce(UNAUTHORIZED_RESULT);
    const { getDailyItemHistory } = await import("@/server/actions/pos-summary");
    const result = await getDailyItemHistory();
    expect(result.ok).toBe(false);
  });

  it("zero-fills every active menu item for every day, today first", async () => {
    const { db } = await import("@db/index");
    vi.mocked(db.execute)
      .mockResolvedValueOnce(MENU as never) // active menu
      .mockResolvedValueOnce([
        // only some day/item combinations have sales
        { day: "2026-06-14", menu_item_id: "menu_americano", qty: "7" },
        { day: "2026-06-13", menu_item_id: "menu_cappuccino", qty: "4" },
      ] as never);

    const { getDailyItemHistory } = await import("@/server/actions/pos-summary");
    const result = await getDailyItemHistory(3);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const { days } = result.data;
    expect(days).toHaveLength(3);
    expect(days.map((d) => d.date)).toEqual(["2026-06-14", "2026-06-13", "2026-06-12"]);

    // Every day lists ALL active items, in stable order, zeros included.
    for (const day of days) {
      expect(day.items.map((i) => i.name)).toEqual(["Americano", "Cappuccino", "Hot Chocolate"]);
    }
    expect(days[0].items.map((i) => i.quantity)).toEqual([7, 0, 0]);
    expect(days[0].totalItems).toBe(7);
    expect(days[1].items.map((i) => i.quantity)).toEqual([0, 4, 0]);
    expect(days[2].totalItems).toBe(0);
  });

  it("clamps the requested span to a sane range", async () => {
    const { db } = await import("@db/index");
    vi.mocked(db.execute)
      .mockResolvedValueOnce(MENU as never)
      .mockResolvedValueOnce([] as never);
    const { getDailyItemHistory } = await import("@/server/actions/pos-summary");
    const result = await getDailyItemHistory(0);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.days).toHaveLength(1);
  });
});
