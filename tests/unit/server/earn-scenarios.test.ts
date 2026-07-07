// earn-scenarios unit tests — AT-125 (LOY-6), updated for F6/L06
// Cross-cutting earn scenarios: pack no-earn (S4/S5) and the guarantee that
// transitionOrder(→in_progress) no longer earns (S6–S9). Earn moved to the Yoco
// webhook (payment.succeeded) — positive earn scenarios are in webhook-earn.test.ts.
//
// Coverage is NEW — not duplicated by:
//   redeem-pack.test.ts   (no loyalty assertions at all)
//   orders.test.ts        (state machine pure logic only, no transitionOrder action)

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("@db/index", () => {
  function chain() {
    const c: Record<string, unknown> = {
      from: vi.fn(),
      where: vi.fn(),
      orderBy: vi.fn(),
      limit: vi.fn(),
      for: vi.fn(),
    };
    for (const k of ["from", "where", "orderBy", "limit", "for"]) {
      (c[k] as ReturnType<typeof vi.fn>).mockReturnValue(c);
    }
    (c as { then?: unknown }).then = (resolve: (v: unknown[]) => void) => resolve([]);
    return c;
  }

  const txMock = {
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([{ id: "pack_1", qtyRemaining: 4 }]),
        }),
      }),
    }),
    insert: vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue([]) }),
    select: vi.fn().mockImplementation(chain),
    execute: vi.fn().mockResolvedValue(undefined),
  };

  return {
    db: {
      select: vi.fn().mockImplementation(chain),
      transaction: vi.fn().mockImplementation(async (cb: (tx: typeof txMock) => Promise<unknown>) => cb(txMock)),
      insert: vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue([]) }),
    },
    __txMock: txMock,
  };
});

vi.mock("@/server/auth/guard", () => ({
  authorize: vi.fn().mockResolvedValue({
    ok: true,
    session: { id: "staff_1", name: "Sam", role: "barista" },
  }),
}));

vi.mock("@/server/audit", () => ({
  writeAudit: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/server/yoco/client", () => ({
  createPaymentIntent: vi.fn().mockResolvedValue({ id: "ck_new_1", clientSecret: "ck_new_1" }),
}));

// transitionOrder additional deps
vi.mock("@/server/orders/deduction", () => ({
  deductForOrder: vi.fn().mockResolvedValue(undefined),
  DeductionError: class DeductionError extends Error {
    code: string;
    constructor(code: string, message: string) {
      super(message);
      this.code = code;
    }
  },
}));

vi.mock("@/server/orders/state-machine", () => ({
  canTransition: vi.fn().mockReturnValue(true),
  assertTransition: vi.fn(),
}));

vi.mock("@/server/orders/pricing", () => ({
  computeOrderTotalZar: vi.fn().mockReturnValue(4500),
}));

vi.mock("@/server/orders/discount", () => ({
  checkStaffDiscountEligibility: vi.fn().mockReturnValue({ eligible: true }),
}));

vi.mock("@/server/queue/notify", () => ({
  notifyOrderChange: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/server/push/send", () => ({
  sendOrderReadyPush: vi.fn().mockResolvedValue(true),
}));

vi.mock("@/server/push/payload", () => ({
  isValidPushSubscription: vi.fn().mockReturnValue(false),
}));

vi.mock("@/lib/format", () => ({
  revenueDay: vi.fn().mockReturnValue("2026-06-21"),
  formatZar: vi.fn().mockReturnValue("R0.00"),
  formatDate: vi.fn().mockReturnValue(""),
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

const CUSTOMER_ID = "cust_1";
const ORDER_ID = "order_1";
const LINE_REF = "line_1";
const PACK_ID = "pack_1";

function mockOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: ORDER_ID,
    customerId: CUSTOMER_ID,
    state: "ordered",
    totalZar: 4500,
    isStaffDiscount: false,
    completedAt: null,
    placedAt: new Date(),
    staffId: "staff_1",
    ...overrides,
  };
}
function mockCustomer() {
  return { loyaltyPoints: 0, pushSubscription: null, name: "Louis" };
}
function mockOrderLine(unitPriceZar = 4500) {
  return { id: LINE_REF, orderId: ORDER_ID, menuItemId: "menu_latte", unitPriceZar };
}
function mockMenuItem() {
  return { id: "menu_latte", category: "coffee", active: true };
}
function mockPack() {
  return { id: PACK_ID, qtyRemaining: 5, expiresAt: new Date(Date.now() + 86400000) };
}

/**
 * Set up db.select (outer, pre-transaction reads) to return rows in sequence.
 * Handles the chaining patterns used by redeemPack.
 */
function setupSelectSequence(db: { select: ReturnType<typeof vi.fn> }, rows: unknown[][]) {
  let call = 0;
  db.select.mockImplementation(() => ({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockImplementation(() => {
        const row = rows[call++] ?? [];
        return {
          then: (resolve: (v: unknown[]) => void) => resolve(row),
          [Symbol.toStringTag]: "Promise",
          orderBy: vi.fn().mockReturnValue({
            limit: vi.fn().mockImplementation(() => ({
              then: (resolve: (v: unknown[]) => void) => resolve(row),
              [Symbol.toStringTag]: "Promise",
            })),
          }),
          for: vi.fn().mockImplementation(() => ({
            then: (resolve: (v: unknown[]) => void) => resolve(row),
            [Symbol.toStringTag]: "Promise",
          })),
          limit: vi.fn().mockImplementation(() => ({
            then: (resolve: (v: unknown[]) => void) => resolve(row),
            [Symbol.toStringTag]: "Promise",
          })),
        };
      }),
    }),
  }));
}

/**
 * Set up txMock.select (inside-transaction reads) to return rows in sequence.
 * Handles the SELECT...FOR UPDATE pattern used by transitionOrder.
 */
function setupTxSelectSequence(
  txMock: { select: ReturnType<typeof vi.fn> },
  rows: unknown[][]
) {
  let call = 0;
  txMock.select.mockImplementation(() => ({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockImplementation(() => {
        const row = rows[call++] ?? [];
        return {
          for: vi.fn().mockImplementation(() => ({
            then: (resolve: (v: unknown[]) => void) => resolve(row),
            [Symbol.toStringTag]: "Promise",
          })),
          then: (resolve: (v: unknown[]) => void) => resolve(row),
          [Symbol.toStringTag]: "Promise",
          limit: vi.fn().mockImplementation(() => ({
            then: (resolve: (v: unknown[]) => void) => resolve(row),
            [Symbol.toStringTag]: "Promise",
          })),
        };
      }),
      // payments check uses eq().select().from().where() — handled above
    }),
  }));
}

// ─── Helper: find a loyalty_transactions insert call ─────────────────────────
//
// Drizzle table objects have their column names as direct properties.
// loyaltyTransactions columns: customerId, orderId, delta, kind (no deltaZar)
// packRedemptions columns:     packId, customerId, orderId, orderLineRef
//
// We identify the loyalty insert by the presence of "delta" (not "deltaZar").

function findLoyaltyInsert(insertMock: ReturnType<typeof vi.fn>) {
  return insertMock.mock.calls.find((args) => {
    const schema = args[0] as Record<string, unknown> | null;
    return schema != null && "delta" in schema && !("deltaZar" in schema);
  });
}

// ─── redeemPack earn-exclusion scenarios ─────────────────────────────────────

describe("earn-scenarios — redeemPack does not earn loyalty points", () => {
  beforeEach(() => vi.clearAllMocks());

  it("S4: pack redemption never inserts into loyalty_transactions", async () => {
    const { db, __txMock } = await import("@db/index") as unknown as {
      db: { select: ReturnType<typeof vi.fn>; transaction: ReturnType<typeof vi.fn> };
      __txMock: { insert: ReturnType<typeof vi.fn> };
    };
    setupSelectSequence(db as unknown as { select: ReturnType<typeof vi.fn> }, [
      [mockOrder({ totalZar: 4500 })],
      [mockOrderLine()],
      [mockMenuItem()],
      [mockPack()],
      [], // no existing redemption
    ]);
    const { redeemPack } = await import("@/server/actions/packs");
    const res = await redeemPack(CUSTOMER_ID, ORDER_ID, LINE_REF);
    expect(res.ok).toBe(true);
    // redeemPack must NEVER call earnPoints or insert a loyalty_transactions row
    expect(findLoyaltyInsert(vi.mocked(__txMock.insert))).toBeUndefined();
  });

  it("S5: pack redemption reduces orders.totalZar by the line price (4500 → 2000 for R25 line)", async () => {
    const { db } = await import("@db/index");
    setupSelectSequence(db as unknown as { select: ReturnType<typeof vi.fn> }, [
      [mockOrder({ totalZar: 4500 })],
      [mockOrderLine(2500)],  // R25 line
      [mockMenuItem()],
      [mockPack()],
      [],
    ]);
    const { redeemPack } = await import("@/server/actions/packs");
    const res = await redeemPack(CUSTOMER_ID, ORDER_ID, LINE_REF);
    expect(res.ok).toBe(true);
    // writeAudit's after must show the reduced total: 4500 - 2500 = 2000
    const { writeAudit } = await import("@/server/audit");
    const auditCall = vi.mocked(writeAudit).mock.calls[0][0];
    expect(auditCall.after).toMatchObject({ totalZar: 2000 });
  });
});

// ─── transitionOrder no longer earns (F6 / L06) ──────────────────────────────
//
// Earn moved to the Yoco webhook (payment.succeeded). transitionOrder must NOT
// insert a loyalty_transactions earn row on any transition — the positive earn
// scenarios (earn-on-current-total, zero-total no-op, idempotency) now live in
// webhook-earn.test.ts against the webhook handler.

describe("earn-scenarios — transitionOrder must NOT earn (moved to webhook)", () => {
  beforeEach(() => vi.clearAllMocks());

  async function runTransition(totalZar: number) {
    const { db, __txMock } = (await import("@db/index")) as unknown as {
      db: { select: ReturnType<typeof vi.fn>; transaction: ReturnType<typeof vi.fn> };
      __txMock: { insert: ReturnType<typeof vi.fn>; select: ReturnType<typeof vi.fn> };
    };
    const orderRow = mockOrder({ totalZar, state: "ordered" });

    // Outer existence check
    setupSelectSequence(db as unknown as { select: ReturnType<typeof vi.fn> }, [
      [{ id: ORDER_ID }],
    ]);
    // Inner tx reads: SELECT FOR UPDATE (no payment gate — YOCO_SECRET_KEY not set).
    // No customer re-fetch happens on in_progress anymore (earn moved away).
    setupTxSelectSequence(__txMock as unknown as { select: ReturnType<typeof vi.fn> }, [
      [orderRow],
    ]);

    const { canTransition } = await import("@/server/orders/state-machine");
    vi.mocked(canTransition).mockReturnValue(true);

    const { transitionOrder } = await import("@/server/actions/orders");
    await transitionOrder(ORDER_ID, "in_progress");
    return __txMock;
  }

  // S6 (was: card-only R35 earns 15 pts on transition) — must NOT earn now.
  it("S6: card-only order totalZar=3500 → in_progress inserts NO loyaltyTransactions row", async () => {
    const txMock = await runTransition(3500);
    expect(findLoyaltyInsert(vi.mocked(txMock.insert))).toBeUndefined();
  });

  // S7/S8 (was: earn on the reduced current total) — must NOT earn now.
  it("S7: pack-reduced total (2000) → in_progress inserts NO loyaltyTransactions row", async () => {
    const txMock = await runTransition(2000);
    expect(findLoyaltyInsert(vi.mocked(txMock.insert))).toBeUndefined();
  });

  it("S8: discount-reduced total (1000) → in_progress inserts NO loyaltyTransactions row", async () => {
    const txMock = await runTransition(1000);
    expect(findLoyaltyInsert(vi.mocked(txMock.insert))).toBeUndefined();
  });

  // S9 (zero total): still no earn — trivially true, but kept for regression parity.
  it("S9: zero total (0) → in_progress inserts NO loyaltyTransactions row", async () => {
    const txMock = await runTransition(0);
    expect(findLoyaltyInsert(vi.mocked(txMock.insert))).toBeUndefined();
  });
});
