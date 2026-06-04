// Stock-take unit tests — task G11
// Tests the pure variance helpers and close/record validation logic.
// DB-dependent paths (runStockTake happy path, corrective movements)
// are covered by tests/e2e/phase2-acceptance.spec.ts on staging.

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  varianceBand,
  computeLinePct,
  computeWeightedVariancePct,
} from "@/server/inventory/variance";

// ─── varianceBand ─────────────────────────────────────────────────────────────

describe("varianceBand — T01 boundaries", () => {
  it("0% → ok", () => expect(varianceBand(0)).toBe("ok"));
  it("4.99% → ok", () => expect(varianceBand(4.99)).toBe("ok"));
  it("5% → investigate (boundary)", () => expect(varianceBand(5)).toBe("investigate"));
  it("5.01% → investigate", () => expect(varianceBand(5.01)).toBe("investigate"));
  it("9.99% → investigate", () => expect(varianceBand(9.99)).toBe("investigate"));
  it("10% → critical (boundary)", () => expect(varianceBand(10)).toBe("critical"));
  it("25% → critical", () => expect(varianceBand(25)).toBe("critical"));
});

// ─── computeLinePct ───────────────────────────────────────────────────────────

describe("computeLinePct", () => {
  it("0 variance (counted = expected) → 0%", () => {
    expect(computeLinePct(100, 100)).toBe(0);
  });

  it("short 5 of 100 → 5%", () => {
    expect(computeLinePct(100, 95)).toBe(5);
  });

  it("over by 10 of 100 → 10%", () => {
    expect(computeLinePct(100, 110)).toBe(10);
  });

  it("variance is absolute (short or over give same %)", () => {
    expect(computeLinePct(100, 90)).toBe(computeLinePct(100, 110));
  });

  it("expected=0, counted=0 → 0% (empty lot baseline)", () => {
    expect(computeLinePct(0, 0)).toBe(0);
  });

  it("expected=0, counted>0 → 100% (phantom stock)", () => {
    expect(computeLinePct(0, 10)).toBe(100);
  });

  it("cappuccino beans: expected=2000g, counted=1940g → 3%", () => {
    expect(computeLinePct(2000, 1940)).toBe(3);
  });
});

// ─── computeWeightedVariancePct ───────────────────────────────────────────────

describe("computeWeightedVariancePct", () => {
  it("empty lines → 0%", () => {
    expect(computeWeightedVariancePct([])).toBe(0);
  });

  it("single line 0% variance → 0%", () => {
    expect(computeWeightedVariancePct([{ expected: 100, counted: 100 }])).toBe(0);
  });

  it("single line 5% variance → 5%", () => {
    expect(computeWeightedVariancePct([{ expected: 100, counted: 95 }])).toBe(5);
  });

  it("two equal-weight lines: one 0%, one 10% → 5% weighted", () => {
    const result = computeWeightedVariancePct([
      { expected: 100, counted: 100 }, // 0%
      { expected: 100, counted: 90 },  // 10%
    ]);
    expect(result).toBe(5);
  });

  it("larger lot has more weight in the average", () => {
    // 2000g lot at 0%, 100g lot at 10%
    // Weighted: (0*2000 + 10*100) / 2100 ≈ 0.48% → rounds to 0
    const result = computeWeightedVariancePct([
      { expected: 2000, counted: 2000 }, // 0%
      { expected: 100, counted: 90 },    // 10%
    ]);
    expect(result).toBeLessThan(1);
  });

  it("rounds to nearest integer", () => {
    // 3.5% exactly
    const result = computeWeightedVariancePct([
      { expected: 100, counted: 96 }, // 4%
      { expected: 100, counted: 97 }, // 3%
    ]);
    // (4+3)/2 = 3.5 → rounds to 4
    expect(result).toBe(4);
  });

  it("realistic scenario: most lots fine, one outlier → investigate", () => {
    const lines = [
      { expected: 2000, counted: 1940 }, // 3% — beans
      { expected: 4000, counted: 3920 }, // 2% — milk
      { expected: 200, counted: 180 },   // 10% — oat milk outlier
    ];
    const result = computeWeightedVariancePct(lines);
    expect(result).toBeGreaterThan(2);
    expect(result).toBeLessThan(5);
  });
});

// ─── closeStockTake — validation (mocked DB) ─────────────────────────────────

vi.mock("@/server/auth/guard", () => ({
  authorize: vi.fn().mockResolvedValue({
    ok: true,
    session: { id: "staff_manager_mia", name: "Mia", role: "admin" },
  }),
}));

vi.mock("@db/index", () => ({
  db: {
    select: vi.fn(),
    insert: vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue([]) }),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }),
    }),
    transaction: vi.fn(),
  },
}));

vi.mock("@/server/audit", () => ({
  writeAudit: vi.fn().mockResolvedValue(undefined),
}));

describe("closeStockTake — validation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns NOT_FOUND for unknown take id", async () => {
    const { db } = await import("@db/index");
    vi.mocked(db.select).mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
      }),
    } as never);

    const { closeStockTake } = await import("@/server/actions/stock-takes");
    const result = await closeStockTake("take_nonexistent");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("NOT_FOUND");
  });

  it("rejects closing an already-closed take", async () => {
    const { db } = await import("@db/index");
    vi.mocked(db.select).mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([{
          id: "take_001",
          completedAt: new Date("2026-05-25"),
        }]),
      }),
    } as never);

    const { closeStockTake } = await import("@/server/actions/stock-takes");
    const result = await closeStockTake("take_001");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("CONFLICT");
  });

  it("returns INCOMPLETE when some lines are not yet counted", async () => {
    const { db } = await import("@db/index");
    let callCount = 0;
    vi.mocked(db.select).mockImplementation(() => ({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockImplementation(() => {
          callCount++;
          if (callCount === 1) {
            // Take header — open
            return Promise.resolve([{ id: "take_001", completedAt: null }]);
          }
          // Lines — one counted, one not
          return Promise.resolve([
            { id: "stl_001", inventoryLotId: "lot_001", expected: 100, counted: 95 },
            { id: "stl_002", inventoryLotId: "lot_002", expected: 200, counted: null },
          ]);
        }),
      }),
    } as never));

    const { closeStockTake } = await import("@/server/actions/stock-takes");
    const result = await closeStockTake("take_001");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("INCOMPLETE");
  });
});

describe("recordStockTakeLine — validation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects negative counted value", async () => {
    const { recordStockTakeLine } = await import("@/server/actions/stock-takes");
    const result = await recordStockTakeLine("take_001", "lot_001", -1);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("VALIDATION_ERROR");
  });

  it("rejects float counted value", async () => {
    const { recordStockTakeLine } = await import("@/server/actions/stock-takes");
    const result = await recordStockTakeLine("take_001", "lot_001", 1.5);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("VALIDATION_ERROR");
  });
});
