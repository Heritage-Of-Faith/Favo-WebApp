// redeemPack unit tests — AT-111 (LOY-10a pack redemption backend)
// Tests RBAC, validation, FIFO selection, atomic decrement, and audit.

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("@db/index", () => {
  function chain() {
    const c: Record<string, unknown> = { from: vi.fn(), where: vi.fn(), orderBy: vi.fn(), limit: vi.fn() };
    for (const k of ["from", "where", "orderBy", "limit"]) {
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
  };

  return {
    db: {
      select: vi.fn().mockImplementation(chain),
      transaction: vi.fn().mockImplementation(async (cb) => cb(txMock)),
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

// ─── Helpers ──────────────────────────────────────────────────────────────────

const CUSTOMER_ID = "cust_1";
const ORDER_ID = "order_1";
const LINE_REF = "line_1";
const PACK_ID = "pack_1";

function mockOrder(overrides: Record<string, unknown> = {}) {
  return { id: ORDER_ID, customerId: CUSTOMER_ID, state: "ordered", totalZar: 4500, ...overrides };
}
function mockOrderLine() {
  return { id: LINE_REF, orderId: ORDER_ID, menuItemId: "menu_latte", unitPriceZar: 4500 };
}
function mockMenuItem(overrides: Record<string, unknown> = {}) {
  return { id: "menu_latte", category: "coffee", active: true, ...overrides };
}
function mockPack(overrides: Record<string, unknown> = {}) {
  return { id: PACK_ID, qtyRemaining: 5, expiresAt: new Date(Date.now() + 86400000), ...overrides };
}

let callCount = 0;
function setupSelectSequence(db: { select: ReturnType<typeof vi.fn> }, rows: unknown[][]) {
  callCount = 0;
  db.select.mockImplementation(() => ({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockImplementation(() => {
        const idx = callCount++;
        const row = rows[idx] ?? [];
        return {
          orderBy: vi.fn().mockReturnValue({
            limit: vi.fn().mockImplementation(() => ({
              then: (resolve: (v: unknown[]) => void) => resolve(row),
              [Symbol.toStringTag]: "Promise",
            })),
          }),
          then: (resolve: (v: unknown[]) => void) => resolve(row),
          [Symbol.toStringTag]: "Promise",
        };
      }),
    }),
  }));
}

// ─── RBAC ─────────────────────────────────────────────────────────────────────

describe("redeemPack — RBAC", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects unauthenticated caller", async () => {
    const { authorize } = await import("@/server/auth/guard");
    vi.mocked(authorize).mockResolvedValueOnce({ ok: false, code: "UNAUTHORIZED", message: "Not signed in." });
    const { redeemPack } = await import("@/server/actions/packs");
    const res = await redeemPack(CUSTOMER_ID, ORDER_ID, LINE_REF);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("UNAUTHORIZED");
  });
});

// ─── Validation ───────────────────────────────────────────────────────────────

describe("redeemPack — validation", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects empty customerId", async () => {
    const { redeemPack } = await import("@/server/actions/packs");
    const res = await redeemPack("", ORDER_ID, LINE_REF);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("VALIDATION_ERROR");
  });

  it("returns NOT_FOUND for missing order", async () => {
    const { db } = await import("@db/index");
    setupSelectSequence(db as unknown as { select: ReturnType<typeof vi.fn> }, [[]]);
    const { redeemPack } = await import("@/server/actions/packs");
    const res = await redeemPack(CUSTOMER_ID, ORDER_ID, LINE_REF);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("NOT_FOUND");
  });

  it("rejects order not in 'ordered' state", async () => {
    const { db } = await import("@db/index");
    setupSelectSequence(db as unknown as { select: ReturnType<typeof vi.fn> }, [
      [mockOrder({ state: "in_progress" })],
    ]);
    const { redeemPack } = await import("@/server/actions/packs");
    const res = await redeemPack(CUSTOMER_ID, ORDER_ID, LINE_REF);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("CONFLICT");
  });

  it("rejects customer mismatch", async () => {
    const { db } = await import("@db/index");
    setupSelectSequence(db as unknown as { select: ReturnType<typeof vi.fn> }, [
      [mockOrder({ customerId: "other_cust" })],
    ]);
    const { redeemPack } = await import("@/server/actions/packs");
    const res = await redeemPack(CUSTOMER_ID, ORDER_ID, LINE_REF);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("VALIDATION_ERROR");
  });

  it("returns NOT_FOUND for missing order line", async () => {
    const { db } = await import("@db/index");
    setupSelectSequence(db as unknown as { select: ReturnType<typeof vi.fn> }, [
      [mockOrder()], // order found
      [],           // order line not found
    ]);
    const { redeemPack } = await import("@/server/actions/packs");
    const res = await redeemPack(CUSTOMER_ID, ORDER_ID, LINE_REF);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("NOT_FOUND");
  });

  it("rejects non-coffee menu item", async () => {
    const { db } = await import("@db/index");
    setupSelectSequence(db as unknown as { select: ReturnType<typeof vi.fn> }, [
      [mockOrder()],
      [mockOrderLine()],
      [mockMenuItem({ category: "tea" })],
    ]);
    const { redeemPack } = await import("@/server/actions/packs");
    const res = await redeemPack(CUSTOMER_ID, ORDER_ID, LINE_REF);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("VALIDATION_ERROR");
  });

  it("returns CONFLICT when no pack available", async () => {
    const { db } = await import("@db/index");
    setupSelectSequence(db as unknown as { select: ReturnType<typeof vi.fn> }, [
      [mockOrder()],
      [mockOrderLine()],
      [mockMenuItem()],
      [],  // no pack found
      [],  // no existing redemption
    ]);
    const { redeemPack } = await import("@/server/actions/packs");
    const res = await redeemPack(CUSTOMER_ID, ORDER_ID, LINE_REF);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("CONFLICT");
  });

  it("returns CONFLICT when line already has a pack redemption", async () => {
    const { db } = await import("@db/index");
    setupSelectSequence(db as unknown as { select: ReturnType<typeof vi.fn> }, [
      [mockOrder()],
      [mockOrderLine()],
      [mockMenuItem()],
      [mockPack()],             // pack found
      [{ id: "rp_existing" }],  // existing redemption found
    ]);
    const { redeemPack } = await import("@/server/actions/packs");
    const res = await redeemPack(CUSTOMER_ID, ORDER_ID, LINE_REF);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("CONFLICT");
  });
});

// ─── Happy path ───────────────────────────────────────────────────────────────

describe("redeemPack — happy path", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns ok with packId and qtyRemaining after successful redemption", async () => {
    const { db } = await import("@db/index");
    setupSelectSequence(db as unknown as { select: ReturnType<typeof vi.fn> }, [
      [mockOrder()],
      [mockOrderLine()],
      [mockMenuItem()],
      [mockPack()], // FIFO pack (qty=5)
      [],           // no existing redemption
    ]);
    const { redeemPack } = await import("@/server/actions/packs");
    const res = await redeemPack(CUSTOMER_ID, ORDER_ID, LINE_REF);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.packId).toBe(PACK_ID);
      expect(res.data.qtyRemaining).toBe(4); // mock returns 4 after decrement
    }
    expect(vi.mocked(db.transaction)).toHaveBeenCalledOnce();
  });

  it("writes audit with correct before/after", async () => {
    const { db } = await import("@db/index");
    setupSelectSequence(db as unknown as { select: ReturnType<typeof vi.fn> }, [
      [mockOrder({ totalZar: 4500 })],
      [mockOrderLine()],
      [mockMenuItem()],
      [mockPack({ qtyRemaining: 3 })],
      [],
    ]);
    const { redeemPack } = await import("@/server/actions/packs");
    await redeemPack(CUSTOMER_ID, ORDER_ID, LINE_REF);
    const { writeAudit } = await import("@/server/audit");
    expect(vi.mocked(writeAudit)).toHaveBeenCalledOnce();
    const call = vi.mocked(writeAudit).mock.calls[0][0];
    expect(call.action).toBe("redeem_pack");
    expect(call.before).toMatchObject({ totalZar: 4500, qtyRemaining: 3 });
    expect(call.after).toMatchObject({ packId: PACK_ID, orderLineRef: LINE_REF });
  });
});
