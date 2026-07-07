// purchasePack unit tests — G9
// Tests validation, missing-entity guards, Yoco error handling, and the happy path.

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("@db/index", () => {
  const insertMock = vi.fn().mockReturnValue({
    values: vi.fn().mockResolvedValue([]),
  });

  function selectChain(rows: unknown[] = []) {
    const c = {
      from: vi.fn(),
      where: vi.fn(),
    };
    c.from.mockReturnValue(c);
    c.where.mockImplementation(() => ({
      then: (resolve: (v: unknown[]) => void) => resolve(rows),
      [Symbol.toStringTag]: "Promise",
    }));
    return c;
  }

  return {
    db: {
      select: vi.fn().mockImplementation(() => selectChain()),
      insert: insertMock,
    },
    __insertMock: insertMock,
  };
});

vi.mock("@/server/auth/guard", () => ({
  authorize: vi.fn().mockResolvedValue({
    ok: true,
    session: { id: "staff_barista_sam", name: "Sam", role: "barista" },
  }),
}));

vi.mock("@/server/audit", () => ({
  writeAudit: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/server/yoco/client", () => ({
  createPaymentIntent: vi.fn().mockResolvedValue({ id: "yoco_abc123", clientSecret: "yoco_abc123" }),
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

const CUSTOMER_ID = "cust_louis";
const MENU_ITEM_ID = "item_flat_white";
const CHECKOUT_ID = "yoco_abc123";

function setupSelectSequence(db: { select: ReturnType<typeof vi.fn> }, rows: unknown[][]) {
  let call = 0;
  db.select.mockImplementation(() => {
    const rowSet = rows[call++] ?? [];
    const c = {
      from: vi.fn(),
      where: vi.fn(),
    };
    c.from.mockReturnValue(c);
    c.where.mockImplementation(() => ({
      then: (resolve: (v: unknown[]) => void) => resolve(rowSet),
      [Symbol.toStringTag]: "Promise",
    }));
    return c;
  });
}

// ─── purchasePack — validation ────────────────────────────────────────────────

describe("purchasePack — validation", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects qty < 1", async () => {
    const { purchasePack } = await import("@/server/actions/loyalty");
    const res = await purchasePack(CUSTOMER_ID, MENU_ITEM_ID, 0);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("VALIDATION_ERROR");
  });

  it("returns NOT_FOUND for missing customer", async () => {
    const { db } = await import("@db/index");
    setupSelectSequence(db as unknown as { select: ReturnType<typeof vi.fn> }, [[]]);
    const { purchasePack } = await import("@/server/actions/loyalty");
    const res = await purchasePack(CUSTOMER_ID, MENU_ITEM_ID, 1);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("NOT_FOUND");
  });

  it("returns NOT_FOUND for missing menu item", async () => {
    const { db } = await import("@db/index");
    setupSelectSequence(db as unknown as { select: ReturnType<typeof vi.fn> }, [
      [{ id: CUSTOMER_ID }],
      [],
    ]);
    const { purchasePack } = await import("@/server/actions/loyalty");
    const res = await purchasePack(CUSTOMER_ID, MENU_ITEM_ID, 1);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("NOT_FOUND");
  });
});

// ─── purchasePack — happy path ────────────────────────────────────────────────

describe("purchasePack — happy path", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns ok with yocoClientSecret", async () => {
    const { db } = await import("@db/index");
    setupSelectSequence(db as unknown as { select: ReturnType<typeof vi.fn> }, [
      [{ id: CUSTOMER_ID }],
      [{ id: MENU_ITEM_ID, currentPriceZar: 4000 }],
    ]);
    const { purchasePack } = await import("@/server/actions/loyalty");
    const res = await purchasePack(CUSTOMER_ID, MENU_ITEM_ID, 2);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data.yocoClientSecret).toBe(CHECKOUT_ID);
  });

  it("calculates total as priceZar * qty", async () => {
    const { db } = await import("@db/index");
    setupSelectSequence(db as unknown as { select: ReturnType<typeof vi.fn> }, [
      [{ id: CUSTOMER_ID }],
      [{ id: MENU_ITEM_ID, currentPriceZar: 4000 }],
    ]);
    const { createPaymentIntent } = await import("@/server/yoco/client");
    const { purchasePack } = await import("@/server/actions/loyalty");
    await purchasePack(CUSTOMER_ID, MENU_ITEM_ID, 3);
    expect(vi.mocked(createPaymentIntent)).toHaveBeenCalledWith(
      expect.objectContaining({ amountZar: 12000 })
    );
  });

  it("inserts a coffee_pack pendingCharge row with kind='coffee_pack'", async () => {
    const { db } = await import("@db/index");
    setupSelectSequence(db as unknown as { select: ReturnType<typeof vi.fn> }, [
      [{ id: CUSTOMER_ID }],
      [{ id: MENU_ITEM_ID, currentPriceZar: 4000 }],
    ]);
    const valuesMock = vi.fn().mockResolvedValue([]);
    vi.mocked(db.insert).mockReturnValueOnce({ values: valuesMock } as unknown as ReturnType<typeof db.insert>);
    const { purchasePack } = await import("@/server/actions/loyalty");
    await purchasePack(CUSTOMER_ID, MENU_ITEM_ID, 2);
    expect(valuesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "coffee_pack",
        customerId: CUSTOMER_ID,
        yocoCheckoutId: CHECKOUT_ID,
      })
    );
  });

  it("writes an audit row with action coffee_pack_initiated", async () => {
    const { db } = await import("@db/index");
    setupSelectSequence(db as unknown as { select: ReturnType<typeof vi.fn> }, [
      [{ id: CUSTOMER_ID }],
      [{ id: MENU_ITEM_ID, currentPriceZar: 4000 }],
    ]);
    const { purchasePack } = await import("@/server/actions/loyalty");
    await purchasePack(CUSTOMER_ID, MENU_ITEM_ID, 2);
    const { writeAudit } = await import("@/server/audit");
    expect(vi.mocked(writeAudit)).toHaveBeenCalledOnce();
    const auditCall = vi.mocked(writeAudit).mock.calls[0][0];
    expect(auditCall.action).toBe("coffee_pack_initiated");
  });
});
