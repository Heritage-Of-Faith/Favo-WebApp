// Offline sync apply-outbox unit tests — G20 (AT-61)
// Tests idempotency, payment validation, conflict detection.
// DB and pricing are mocked — no network required.

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("@db/index", () => ({
  db: { select: vi.fn(), insert: vi.fn(), update: vi.fn() },
}));

vi.mock("@/server/audit", () => ({
  writeAudit: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/server/orders/pricing", () => ({
  computeOrderTotalZar: vi.fn().mockReturnValue(4500),
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeOutboxItem(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    clientUuid: "11111111-1111-1111-1111-111111111111",
    staffId: "staff-1",
    customerId: undefined,
    items: [{ menuItemId: "mi-capp", quantity: 1, modifications: [] }],
    paymentMode: "yoco_deferred" as const,
    clientTotalZar: 4500,
    clientTimestamp: "2026-06-13T07:00:00Z",
    ...overrides,
  };
}

function stubInsertReturning(rows: unknown[]) {
  const returning = vi.fn().mockResolvedValue(rows);
  const values = vi.fn().mockReturnValue({ returning });
  return { values, returning };
}

function stubUpdateSet() {
  const where = vi.fn().mockResolvedValue([]);
  const set = vi.fn().mockReturnValue({ where });
  return { set, where };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("outboxItemSchema", () => {
  it("rejects invalid clientUuid", async () => {
    const { outboxItemSchema } = await import("@/server/sync/apply-outbox");
    const result = outboxItemSchema.safeParse(makeOutboxItem({ clientUuid: "not-a-uuid" }));
    expect(result.success).toBe(false);
  });

  it("rejects empty items array", async () => {
    const { outboxItemSchema } = await import("@/server/sync/apply-outbox");
    const result = outboxItemSchema.safeParse(makeOutboxItem({ items: [] }));
    expect(result.success).toBe(false);
  });

  it("rejects invalid paymentMode", async () => {
    const { outboxItemSchema } = await import("@/server/sync/apply-outbox");
    const result = outboxItemSchema.safeParse(makeOutboxItem({ paymentMode: "credit_card" }));
    expect(result.success).toBe(false);
  });

  it("accepts valid entry", async () => {
    const { outboxItemSchema } = await import("@/server/sync/apply-outbox");
    const result = outboxItemSchema.safeParse(makeOutboxItem());
    expect(result.success).toBe(true);
  });

  it("accepts all valid paymentModes", async () => {
    const { outboxItemSchema } = await import("@/server/sync/apply-outbox");
    for (const mode of ["yoco_deferred", "free"]) {
      const result = outboxItemSchema.safeParse(makeOutboxItem({ paymentMode: mode }));
      expect(result.success).toBe(true);
    }
  });
});

describe("applyOutboxItem", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns duplicate when clientUuid already in outbox_log", async () => {
    const { db } = await import("@db/index");

    vi.mocked(db.select).mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([
          { id: "log-1", clientUuid: "11111111-1111-1111-1111-111111111111", appliedAt: new Date(), conflictId: null },
        ]),
      }),
    } as unknown as ReturnType<typeof db.select>);

    const { applyOutboxItem } = await import("@/server/sync/apply-outbox");
    const res = await applyOutboxItem(makeOutboxItem());

    expect(res.outcome).toBe("duplicate");
  });

  it("creates conflict on payment_mismatch (server total differs from client)", async () => {
    const { db } = await import("@db/index");
    const { computeOrderTotalZar } = await import("@/server/orders/pricing");
    vi.mocked(computeOrderTotalZar).mockReturnValueOnce(5000); // server says R50, client said R45

    // first select → no existing outbox entry
    vi.mocked(db.select).mockReturnValueOnce({
      from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }),
    } as unknown as ReturnType<typeof db.select>);

    // second select → menu item exists
    vi.mocked(db.select).mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([{ id: "mi-capp", name: "Cappuccino", currentPriceZar: 5000, active: true }]),
      }),
    } as unknown as ReturnType<typeof db.select>);

    const logInsert = stubInsertReturning([{ id: "log-1" }]);
    const conflictInsert = stubInsertReturning([{ id: "conflict-1" }]);
    vi.mocked(db.insert)
      .mockReturnValueOnce({ values: logInsert.values } as unknown as ReturnType<typeof db.insert>)
      .mockReturnValueOnce({ values: conflictInsert.values } as unknown as ReturnType<typeof db.insert>);

    vi.mocked(db.update).mockReturnValue({ set: stubUpdateSet().set } as unknown as ReturnType<typeof db.update>);

    const { applyOutboxItem } = await import("@/server/sync/apply-outbox");
    const res = await applyOutboxItem(makeOutboxItem({ clientTotalZar: 4500 }));

    expect(res.outcome).toBe("conflict");
    if (res.outcome === "conflict") expect(res.kind).toBe("payment_mismatch");
  });

  it("applies order when totals match and menu items exist", async () => {
    const { db } = await import("@db/index");
    const { computeOrderTotalZar } = await import("@/server/orders/pricing");
    vi.mocked(computeOrderTotalZar).mockReturnValueOnce(4500);

    // select 1: no existing outbox entry
    vi.mocked(db.select).mockReturnValueOnce({
      from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }),
    } as unknown as ReturnType<typeof db.select>);

    // select 2: menu items
    vi.mocked(db.select).mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([{ id: "mi-capp", name: "Cappuccino", currentPriceZar: 4500, active: true }]),
      }),
    } as unknown as ReturnType<typeof db.select>);

    // inserts: outbox log, order, order items
    const logInsert = stubInsertReturning([{ id: "log-1" }]);
    const orderInsert = { values: vi.fn().mockResolvedValue([]) };
    const itemsInsert = { values: vi.fn().mockResolvedValue([]) };
    vi.mocked(db.insert)
      .mockReturnValueOnce({ values: logInsert.values } as unknown as ReturnType<typeof db.insert>)
      .mockReturnValueOnce(orderInsert as unknown as ReturnType<typeof db.insert>)
      .mockReturnValueOnce(itemsInsert as unknown as ReturnType<typeof db.insert>);

    vi.mocked(db.update).mockReturnValue({ set: stubUpdateSet().set } as unknown as ReturnType<typeof db.update>);

    const { applyOutboxItem } = await import("@/server/sync/apply-outbox");
    const res = await applyOutboxItem(makeOutboxItem({ clientTotalZar: 4500 }));

    expect(res.outcome).toBe("applied");
    if (res.outcome === "applied") {
      expect(res.serverTotalZar).toBe(4500);
      expect(res.orderId).toBeDefined();
    }
  });

  it("creates conflict when menu item not found", async () => {
    const { db } = await import("@db/index");

    // select 1: no existing outbox entry
    vi.mocked(db.select).mockReturnValueOnce({
      from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }),
    } as unknown as ReturnType<typeof db.select>);

    // select 2: menu items — item not found
    vi.mocked(db.select).mockReturnValueOnce({
      from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }),
    } as unknown as ReturnType<typeof db.select>);

    const logInsert = stubInsertReturning([{ id: "log-1" }]);
    const conflictInsert = stubInsertReturning([{ id: "conflict-2" }]);
    vi.mocked(db.insert)
      .mockReturnValueOnce({ values: logInsert.values } as unknown as ReturnType<typeof db.insert>)
      .mockReturnValueOnce({ values: conflictInsert.values } as unknown as ReturnType<typeof db.insert>);

    vi.mocked(db.update).mockReturnValue({ set: stubUpdateSet().set } as unknown as ReturnType<typeof db.update>);

    const { applyOutboxItem } = await import("@/server/sync/apply-outbox");
    const res = await applyOutboxItem(makeOutboxItem());

    expect(res.outcome).toBe("conflict");
  });
});
