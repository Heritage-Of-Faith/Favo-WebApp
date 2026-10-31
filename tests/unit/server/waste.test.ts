// Waste + purchase unit tests — task G10
// Tests validation logic and error paths. DB calls are mocked.

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("@db/index", () => ({
  db: {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    transaction: vi.fn(),
  },
}));

vi.mock("@/server/auth/guard", () => ({
  authorize: vi.fn(),
}));

vi.mock("@/server/audit", () => ({
  writeAudit: vi.fn().mockResolvedValue(undefined),
}));

/**
 * The lot is read inside the transaction under FOR UPDATE: `.for()` yields the lot
 * row(s); awaiting `.where()` directly yields the running-stock SUM.
 */
async function mockLotTx(lotRows: unknown[], remaining = 0) {
  const { db } = await import("@db/index");
  const insert = vi.fn().mockReturnValue({
    values: vi.fn().mockReturnValue({
      returning: vi.fn().mockResolvedValue([{ id: "waste_1" }]),
    }),
  });
  const tx = {
    select: vi.fn().mockImplementation(() => ({
      from: () => ({
        where: () =>
          Object.assign(Promise.resolve([{ total: remaining }]), {
            for: () => Promise.resolve(lotRows),
          }),
      }),
    })),
    insert,
  };
  vi.mocked(db.transaction).mockImplementation((async (fn: (t: unknown) => unknown) => fn(tx)) as never);
  return { insert };
}

// ─── logWaste validation ──────────────────────────────────────────────────────

describe("logWaste — validation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects quantity = 0", async () => {
    const { authorize } = await import("@/server/auth/guard");
    vi.mocked(authorize).mockResolvedValue({
      ok: true,
      session: { id: "staff_barista_sam", name: "Sam", role: "barista" },
    });

    const { logWaste } = await import("@/server/actions/waste");
    const result = await logWaste({ category: "spilled", quantity: 0 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("VALIDATION_ERROR");
  });

  it("rejects negative quantity", async () => {
    const { authorize } = await import("@/server/auth/guard");
    vi.mocked(authorize).mockResolvedValue({
      ok: true,
      session: { id: "staff_barista_sam", name: "Sam", role: "barista" },
    });

    const { logWaste } = await import("@/server/actions/waste");
    const result = await logWaste({ category: "damaged", quantity: -5 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("VALIDATION_ERROR");
  });

  it("rejects float quantity (not an integer)", async () => {
    const { authorize } = await import("@/server/auth/guard");
    vi.mocked(authorize).mockResolvedValue({
      ok: true,
      session: { id: "staff_barista_sam", name: "Sam", role: "barista" },
    });

    const { logWaste } = await import("@/server/actions/waste");
    const result = await logWaste({ category: "spilled", quantity: 1.5 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("VALIDATION_ERROR");
  });

  it("returns UNAUTHORIZED for unauthenticated calls", async () => {
    const { authorize } = await import("@/server/auth/guard");
    vi.mocked(authorize).mockResolvedValue({
      ok: false,
      code: "UNAUTHORIZED",
      message: "No session.",
    });

    const { logWaste } = await import("@/server/actions/waste");
    const result = await logWaste({ category: "expired", quantity: 10 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("UNAUTHORIZED");
  });
});

// QA R5-SEC-1/2: forged bodies must come back as VALIDATION_ERROR, never a 500,
// and the reason is capped at WASTE_REASON_MAX characters.
describe("logWaste — malformed input is a validation error", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const { authorize } = await import("@/server/auth/guard");
    vi.mocked(authorize).mockResolvedValue({
      ok: true,
      session: { id: "staff_barista_sam", name: "Sam", role: "barista" },
    });
  });

  const bad: [string, unknown][] = [
    ["an unknown category", { category: "stolen", quantity: 1 }],
    ["a missing category", { quantity: 1 }],
    ["a missing quantity", { category: "spilled" }],
    ["null", null],
    ["an array", [{ category: "spilled", quantity: 1 }]],
    ["a string", "[{"],
    ["a non-string reason", { category: "spilled", quantity: 1, reason: 42 }],
    ["a non-string lot id", { category: "spilled", quantity: 1, inventoryLotId: 7 }],
  ];

  it.each(bad)("refuses %s without touching the database", async (_label, input) => {
    const { db } = await import("@db/index");
    const { logWaste } = await import("@/server/actions/waste");
    const result = await logWaste(input as never);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("VALIDATION_ERROR");
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it("refuses a reason longer than 500 characters and accepts exactly 500", async () => {
    const { db } = await import("@db/index");
    const { logWaste } = await import("@/server/actions/waste");
    const { WASTE_REASON_MAX } = await import("@/lib/pos/waste-validation");
    expect(WASTE_REASON_MAX).toBe(500);
    const long = await logWaste({ category: "spilled", quantity: 1, reason: "A".repeat(501) });
    expect(long.ok).toBe(false);
    if (!long.ok) expect(long.code).toBe("VALIDATION_ERROR");
    expect(db.transaction).not.toHaveBeenCalled();

    await mockLotTx([]);
    const ok = await logWaste({ category: "spilled", quantity: 1, reason: "A".repeat(500) });
    expect(ok.ok).toBe(true);
  });
});

// ─── logWaste — lot state validation ─────────────────────────────────────────

describe("logWaste — lot state check", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects waste against an expired lot", async () => {
    const { authorize } = await import("@/server/auth/guard");
    vi.mocked(authorize).mockResolvedValue({
      ok: true,
      session: { id: "staff_barista_sam", name: "Sam", role: "barista" },
    });

    await mockLotTx([{ id: "lot_001", state: "expired" }]);

    const { logWaste } = await import("@/server/actions/waste");
    const result = await logWaste({
      category: "expired",
      inventoryLotId: "lot_001",
      quantity: 10,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("INVALID_LOT_STATE");
  });

  it("rejects waste against a quarantined lot", async () => {
    const { authorize } = await import("@/server/auth/guard");
    vi.mocked(authorize).mockResolvedValue({
      ok: true,
      session: { id: "staff_barista_sam", name: "Sam", role: "barista" },
    });

    await mockLotTx([{ id: "lot_001", state: "quarantined" }]);

    const { logWaste } = await import("@/server/actions/waste");
    const result = await logWaste({
      category: "damaged",
      inventoryLotId: "lot_001",
      quantity: 5,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("INVALID_LOT_STATE");
  });

  // QA R4 barista P2-1: an open container is retired by closeContainer (PRD §10,
  // COGS-neutral), never by a waste row; the refusal says so in plain words.
  it("refuses waste against an open container and points to Close", async () => {
    const { authorize } = await import("@/server/auth/guard");
    vi.mocked(authorize).mockResolvedValue({
      ok: true,
      session: { id: "staff_barista_sam", name: "Sam", role: "barista" },
    });
    const { insert } = await mockLotTx([{ id: "lot_001", state: "open", quantityReceived: null }]);
    const { logWaste } = await import("@/server/actions/waste");
    const result = await logWaste({ category: "spilled", inventoryLotId: "lot_001", quantity: 1 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("INVALID_LOT_STATE");
      expect(result.message).toBe("This bag or carton is open. To bin what is left, tap Close on its stock tile.");
    }
    expect(insert).not.toHaveBeenCalled();
  });

  it("uses 'an' before a vowel state (an expired lot)", async () => {
    const { authorize } = await import("@/server/auth/guard");
    vi.mocked(authorize).mockResolvedValue({
      ok: true,
      session: { id: "staff_barista_sam", name: "Sam", role: "barista" },
    });
    await mockLotTx([{ id: "lot_001", state: "expired" }]);
    const { logWaste } = await import("@/server/actions/waste");
    const result = await logWaste({ category: "expired", inventoryLotId: "lot_001", quantity: 1 });
    if (!result.ok) expect(result.message).toBe("Cannot log waste against an expired lot.");
    await mockLotTx([{ id: "lot_002", state: "closed" }]);
    const closed = await logWaste({ category: "spilled", inventoryLotId: "lot_002", quantity: 1 });
    if (!closed.ok) expect(closed.message).toBe("Cannot log waste against a closed lot.");
    expect(closed.ok).toBe(false);
  });

  it("returns NOT_FOUND for an unknown lot", async () => {
    const { authorize } = await import("@/server/auth/guard");
    vi.mocked(authorize).mockResolvedValue({
      ok: true,
      session: { id: "staff_barista_sam", name: "Sam", role: "barista" },
    });

    await mockLotTx([]);

    const { logWaste } = await import("@/server/actions/waste");
    const result = await logWaste({
      category: "damaged",
      inventoryLotId: "lot_nonexistent",
      quantity: 5,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("NOT_FOUND");
  });
});

// ─── logWaste — never below zero (QA R2-9 / B3) ──────────────────────────────

describe("logWaste — cannot exceed what the lot holds", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  async function setup(remaining: number, quantityReceived: string | null) {
    const { authorize } = await import("@/server/auth/guard");
    vi.mocked(authorize).mockResolvedValue({
      ok: true,
      session: { id: "staff_barista_sam", name: "Sam", role: "barista" },
    });
    return mockLotTx([{ id: "lot_cup", state: "active", quantityReceived }], remaining);
  }

  it("refuses 200 when the lot has 134 left, writes nothing, and audits the refusal", async () => {
    const { insert } = await setup(134, "200");
    const { logWaste } = await import("@/server/actions/waste");
    const result = await logWaste({ category: "damaged", inventoryLotId: "lot_cup", quantity: 200 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("EXCEEDS_STOCK");
      expect(result.message).toBe("Only 134 left in this lot. Log 134 or less.");
    }
    expect(insert).not.toHaveBeenCalled();
    const { writeAudit } = await import("@/server/audit");
    expect(vi.mocked(writeAudit).mock.calls[0]?.[0]).toMatchObject({
      entityKind: "inventory_lot", entityId: "lot_cup", action: "waste_refused", reason: "EXCEEDS_STOCK",
      after: { quantity: 200, remaining: 134 },
    });
  });

  it("refuses any waste from a lot at zero", async () => {
    await setup(0, "200");
    const { logWaste } = await import("@/server/actions/waste");
    const result = await logWaste({ category: "damaged", inventoryLotId: "lot_cup", quantity: 1 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("EXCEEDS_STOCK");
  });

  it("accepts exactly what is left (134 of 134)", async () => {
    const { insert } = await setup(134, "200");
    const { logWaste } = await import("@/server/actions/waste");
    const result = await logWaste({ category: "damaged", inventoryLotId: "lot_cup", quantity: 134 });
    expect(result.ok).toBe(true);
    expect(insert).toHaveBeenCalled();
  });

  // QA R6 barista P2-1: one rule for every lot kind — nothing left (remaining
  // <= 0) means no waste. A container-model lot with stock left is still not
  // capped by quantity (it has no received figure to count down).
  it("does not cap a container-model lot that still has stock", async () => {
    await setup(3, null);
    const { logWaste } = await import("@/server/actions/waste");
    const result = await logWaste({ category: "spilled", inventoryLotId: "lot_cup", quantity: 5 });
    expect(result.ok).toBe(true);
  });

  it.each([
    ["a container-model lot at -2 (Oat Milk 057ED0)", -2, null],
    ["a container-model lot at zero", 0, null],
    ["a countdown lot at -66 (8 oz cup)", -66, "200"],
  ])("refuses %s with the same 'nothing left' message, writes nothing, audits", async (_l, remaining, received) => {
    const { insert } = await setup(remaining, received);
    const { logWaste } = await import("@/server/actions/waste");
    const result = await logWaste({ category: "spilled", inventoryLotId: "lot_cup", quantity: 1 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("EXCEEDS_STOCK");
      expect(result.message).toBe("This lot has nothing left to waste.");
    }
    expect(insert).not.toHaveBeenCalled();
    const { writeAudit } = await import("@/server/audit");
    expect(vi.mocked(writeAudit).mock.calls[0]?.[0]).toMatchObject({
      entityKind: "inventory_lot", entityId: "lot_cup", action: "waste_refused", reason: "EXCEEDS_STOCK",
      after: { quantity: 1, remaining },
    });
  });
});

// QA R6-SEC-1/2: a NUL (or other control character) is a validation error, not
// a Postgres 500; the reason cap counts characters, not UTF-16 units.
describe("logWaste — control characters and the character count", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const { authorize } = await import("@/server/auth/guard");
    vi.mocked(authorize).mockResolvedValue({
      ok: true,
      session: { id: "staff_barista_sam", name: "Sam", role: "barista" },
    });
  });

  it.each([
    ["a NUL in the reason", { category: "spilled", quantity: 1, reason: "a\u0000b" }],
    ["a NUL in the lot id", { category: "spilled", quantity: 1, inventoryLotId: "a\u0000b" }],
    ["another control character in the reason", { category: "spilled", quantity: 1, reason: "a\u0007b" }],
  ])("refuses %s without touching the database", async (_l, input) => {
    const { db } = await import("@db/index");
    const { logWaste } = await import("@/server/actions/waste");
    const result = await logWaste(input as never);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("VALIDATION_ERROR");
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it("accepts 500 emoji and refuses 501", async () => {
    const { logWaste } = await import("@/server/actions/waste");
    await mockLotTx([]);
    const ok = await logWaste({ category: "spilled", quantity: 1, reason: "\u{1F600}".repeat(500) });
    expect(ok.ok).toBe(true);
    const long = await logWaste({ category: "spilled", quantity: 1, reason: "\u{1F600}".repeat(501) });
    expect(long.ok).toBe(false);
    if (!long.ok) expect(long.message).toBe("Reason is too long (500 characters max).");
  });
});

// ─── recordPurchase — validation ─────────────────────────────────────────────

describe("recordPurchase — validation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects empty items array", async () => {
    const { authorize } = await import("@/server/auth/guard");
    vi.mocked(authorize).mockResolvedValue({
      ok: true,
      session: { id: "staff_manager_mia", name: "Mia", role: "admin" },
    });

    const { recordPurchase } = await import("@/server/actions/purchases");
    const result = await recordPurchase({
      sourceName: "Supplier",
      kind: "planned",
      items: [],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("VALIDATION_ERROR");
  });

  it("rejects non-integer totalZar (float)", async () => {
    const { authorize } = await import("@/server/auth/guard");
    vi.mocked(authorize).mockResolvedValue({
      ok: true,
      session: { id: "staff_manager_mia", name: "Mia", role: "admin" },
    });

    const { recordPurchase } = await import("@/server/actions/purchases");
    const result = await recordPurchase({
      sourceName: "Supplier",
      kind: "planned",
      items: [
        {
          inventoryItemId: "inv_item_espresso_beans",
          quantity: 1000,
          unitCostZar: "0.4500",
          totalZar: 450.50, // float — invalid
        },
      ],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("VALIDATION_ERROR");
  });

  it("rejects negative quantity", async () => {
    const { authorize } = await import("@/server/auth/guard");
    vi.mocked(authorize).mockResolvedValue({
      ok: true,
      session: { id: "staff_manager_mia", name: "Mia", role: "admin" },
    });

    const { recordPurchase } = await import("@/server/actions/purchases");
    const result = await recordPurchase({
      sourceName: "Supplier",
      kind: "planned",
      items: [
        {
          inventoryItemId: "inv_item_espresso_beans",
          quantity: -500,
          unitCostZar: "0.4500",
          totalZar: 45000,
        },
      ],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("VALIDATION_ERROR");
  });

  it("returns UNAUTHORIZED for unauthenticated calls", async () => {
    const { authorize } = await import("@/server/auth/guard");
    vi.mocked(authorize).mockResolvedValue({
      ok: false,
      code: "UNAUTHORIZED",
      message: "No session.",
    });

    const { recordPurchase } = await import("@/server/actions/purchases");
    const result = await recordPurchase({
      sourceName: "Supplier",
      kind: "planned",
      items: [],
    });
    expect(result.ok).toBe(false);
  });
});

// ─── approveEmergencyPurchase — guards ────────────────────────────────────────

describe("approveEmergencyPurchase — guards", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns FORBIDDEN for barista (not admin)", async () => {
    const { authorize } = await import("@/server/auth/guard");
    vi.mocked(authorize).mockResolvedValue({
      ok: false,
      code: "FORBIDDEN",
      message: "Insufficient role.",
    });

    const { approveEmergencyPurchase } = await import("@/server/actions/purchases");
    const result = await approveEmergencyPurchase("purch_001");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("FORBIDDEN");
  });

  it("returns NOT_FOUND for unknown purchase id", async () => {
    const { authorize } = await import("@/server/auth/guard");
    vi.mocked(authorize).mockResolvedValue({
      ok: true,
      session: { id: "staff_manager_mia", name: "Mia", role: "admin" },
    });

    const { db } = await import("@db/index");
    vi.mocked(db.select).mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
      }),
    } as never);

    const { approveEmergencyPurchase } = await import("@/server/actions/purchases");
    const result = await approveEmergencyPurchase("purch_nonexistent");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("NOT_FOUND");
  });

  it("rejects approval of a non-emergency purchase", async () => {
    const { authorize } = await import("@/server/auth/guard");
    vi.mocked(authorize).mockResolvedValue({
      ok: true,
      session: { id: "staff_manager_mia", name: "Mia", role: "admin" },
    });

    const { db } = await import("@db/index");
    vi.mocked(db.select).mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([{
          id: "purch_001",
          inventoryLotId: "lot_001",
          kind: "planned", // not emergency
          status: "active",
        }]),
      }),
    } as never);

    const { approveEmergencyPurchase } = await import("@/server/actions/purchases");
    const result = await approveEmergencyPurchase("purch_001");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("CONFLICT");
  });

  it("rejects approval of an already-approved emergency purchase", async () => {
    const { authorize } = await import("@/server/auth/guard");
    vi.mocked(authorize).mockResolvedValue({
      ok: true,
      session: { id: "staff_manager_mia", name: "Mia", role: "admin" },
    });

    const { db } = await import("@db/index");
    vi.mocked(db.select).mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([{
          id: "purch_001",
          inventoryLotId: "lot_001",
          kind: "emergency",
          status: "active", // already approved
        }]),
      }),
    } as never);

    const { approveEmergencyPurchase } = await import("@/server/actions/purchases");
    const result = await approveEmergencyPurchase("purch_001");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("CONFLICT");
  });
});
