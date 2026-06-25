// AT-122 CASH-REMOVE — transitionOrder must refuse ordered → in_progress when
// there is no confirmed Yoco payment on a non-free order.
// Tests cover the new PAYMENT_REQUIRED guard; other transitions are in orders.test.ts.

import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("@/server/auth/guard", () => ({
  authorize: vi.fn().mockResolvedValue({
    ok: true,
    session: { id: "staff1", role: "barista" },
  }),
}));

// tx helpers — call sequence matters:
// 1) tx.select(orders).for("update") → locked order row
// 2) tx.select(payments).where()     → payment row (only on ordered → in_progress + totalZar > 0)
// 3) tx.update + deductForOrder + writeAudit (all mocked away)
const txState = {
  order: null as Record<string, unknown> | null,
  payment: null as Record<string, unknown> | null,
  selectCount: 0,
};

const mockWriteAudit = vi.fn().mockResolvedValue(undefined);
vi.mock("@/server/audit", () => ({ writeAudit: (...a: unknown[]) => mockWriteAudit(...a) }));
vi.mock("@/server/orders/deduction", () => ({
  deductForOrder: vi.fn().mockResolvedValue(undefined),
  DeductionError: class extends Error {},
}));
vi.mock("@/server/queue/notify", () => ({ notifyOrderChange: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/server/push/send", () => ({ sendOrderReadyPush: vi.fn().mockResolvedValue(true) }));
vi.mock("@/server/push/payload", () => ({ isValidPushSubscription: vi.fn(() => false) }));
vi.mock("@/server/loyalty/calc", () => ({ earnPoints: vi.fn(() => 0) }));

vi.mock("@/lib/db", () => {
  function makeTx() {
    return {
      select: () => ({
        from: () => ({
          where: () => {
            const n = ++txState.selectCount;
            if (n === 1) {
              // First: orders SELECT FOR UPDATE
              return {
                for: () =>
                  Promise.resolve(txState.order ? [txState.order] : []),
              };
            }
            // Second: payments lookup
            return Promise.resolve(
              txState.payment ? [txState.payment] : []
            );
          },
          leftJoin: () => ({ where: () => Promise.resolve([]) }),
          limit: () => Promise.resolve([]),
        }),
      }),
      update: () => ({
        set: () => ({ where: () => Promise.resolve() }),
      }),
      insert: () => ({ values: () => Promise.resolve() }),
    };
  }

  return {
    db: {
      // Fast existence check + loadOrder queries all go through db.select.
      // Return full order object so loadOrder can build the Order type without crashing.
      select: vi.fn().mockImplementation(() => {
        const row = () => {
          const self: Record<string, unknown> = {};
          self.where = () => {
            const w: Record<string, unknown> = {};
            w.limit = () => Promise.resolve([]);
            // Make it awaitable (returns the full order for the first select call).
            Object.assign(w, Promise.resolve(txState.order ? [txState.order] : []));
            w.then = (resolve: (v: unknown[]) => void) =>
              Promise.resolve(txState.order ? [txState.order] : []).then(resolve);
            return w;
          };
          self.leftJoin = () => ({ where: () => Promise.resolve([]) });
          self.limit = () => Promise.resolve([]);
          return self;
        };
        return { from: row };
      }),
      transaction: async (cb: (tx: unknown) => Promise<void>) => cb(makeTx()),
    },
  };
});

import { transitionOrder } from "@/server/actions/orders";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function setOrder(overrides: Record<string, unknown> = {}) {
  txState.order = {
    id: "ord-1",
    state: "ordered",
    totalZar: 3800,
    customerId: null,
    staffId: "staff1",
    isStaffDiscount: false,
    completedAt: null,
    placedAt: { toISOString: () => "2026-06-19T08:00:00.000Z" },
    ...overrides,
  };
}

// The payment gate is only active when YOCO_SECRET_KEY is set (dev simulation
// bypass: when the key is absent the gate is skipped so tests can exercise
// the full order flow without a real Yoco integration).
beforeAll(() => { process.env.YOCO_SECRET_KEY = "test-secret"; });
afterAll(() => { delete process.env.YOCO_SECRET_KEY; });

beforeEach(() => {
  vi.clearAllMocks();
  txState.order = null;
  txState.payment = null;
  txState.selectCount = 0;
});

// ─── RBAC ─────────────────────────────────────────────────────────────────────

describe("transitionOrder — cash-remove guard (AT-122)", () => {
  it("rejects unauthenticated caller before touching DB", async () => {
    const { authorize } = await import("@/server/auth/guard");
    vi.mocked(authorize).mockResolvedValueOnce({
      ok: false,
      code: "UNAUTHORIZED",
      message: "Not signed in.",
    });
    const res = await transitionOrder("ord-1", "in_progress");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("UNAUTHORIZED");
  });

  // ─── Payment guard ───────────────────────────────────────────────────────────

  it("returns PAYMENT_REQUIRED when no payments row exists (non-free order)", async () => {
    setOrder({ totalZar: 3800 });
    // txState.payment stays null
    const res = await transitionOrder("ord-1", "in_progress");
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.code).toBe("PAYMENT_REQUIRED");
      expect(res.message).toMatch(/payment not yet confirmed/i);
    }
  });

  it("returns PAYMENT_REQUIRED when payment.status is 'pending'", async () => {
    setOrder({ totalZar: 3800 });
    txState.payment = { orderId: "ord-1", status: "pending" };
    const res = await transitionOrder("ord-1", "in_progress");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("PAYMENT_REQUIRED");
  });

  it("returns PAYMENT_REQUIRED when payment.status is 'failed'", async () => {
    setOrder({ totalZar: 3800 });
    txState.payment = { orderId: "ord-1", status: "failed" };
    const res = await transitionOrder("ord-1", "in_progress");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("PAYMENT_REQUIRED");
  });

  it("bypasses the guard for free orders (totalZar === 0) with no payment row", async () => {
    // Free order: loyalty/staff-discount zeroed the total. No payment row needed.
    setOrder({ totalZar: 0 });
    // txState.payment stays null — guard must not run
    const res = await transitionOrder("ord-1", "in_progress");
    if (!res.ok) {
      // Any failure here must NOT be PAYMENT_REQUIRED
      expect((res as { code: string }).code).not.toBe("PAYMENT_REQUIRED");
    }
  });

  it("does not apply the guard for in_progress → ready transition", async () => {
    // Guard only applies on ordered → in_progress. Ready is already post-payment.
    setOrder({ state: "in_progress", totalZar: 3800 });
    // txState.payment stays null — if the guard erroneously ran it would return PAYMENT_REQUIRED
    const res = await transitionOrder("ord-1", "ready");
    if (!res.ok) {
      expect((res as { code: string }).code).not.toBe("PAYMENT_REQUIRED");
    }
  });

  // ─── Other guards (pre-existing, not regressed) ───────────────────────────

  it("returns NOT_FOUND for an unknown order id", async () => {
    // txState.order stays null — existence check fails
    const res = await transitionOrder("nonexistent", "in_progress");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("NOT_FOUND");
  });
});
