// Deferred-payment retry cron unit tests — G22
// Mocks DB and Yoco client. Tests the three outcome paths: succeeded, failed/expired, pending.

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("@db/index", () => ({
  db: {
    select: vi.fn(),
    update: vi.fn(),
    insert: vi.fn(),
  },
}));

vi.mock("@/server/audit", () => ({
  writeAudit: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/server/yoco/client", () => ({
  getCheckoutStatus: vi.fn(),
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makePayment(overrides = {}) {
  return {
    id: "pay-1",
    orderId: "ord-1",
    yocoPaymentId: "yoco-abc",
    amountZar: 4500,
    status: "deferred",
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("retryDeferredPayments", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns zeroed result when no deferred payments exist", async () => {
    const { db } = await import("@db/index");
    vi.mocked(db.select).mockReturnValueOnce({
      from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }),
    } as unknown as ReturnType<typeof db.select>);

    const { retryDeferredPayments } = await import("@/server/crons/retry-deferred-payments");
    const res = await retryDeferredPayments();
    expect(res).toEqual({ checked: 0, resolved: 0, conflicted: 0, skipped: 0 });
  });

  it("resolves payment when Yoco reports succeeded", async () => {
    const { db } = await import("@db/index");
    const { getCheckoutStatus } = await import("@/server/yoco/client");
    const { writeAudit } = await import("@/server/audit");

    vi.mocked(db.select).mockReturnValueOnce({
      from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([makePayment()]) }),
    } as unknown as ReturnType<typeof db.select>);

    const updateWhere = vi.fn().mockResolvedValue([]);
    const updateSet = vi.fn().mockReturnValue({ where: updateWhere });
    vi.mocked(db.update).mockReturnValue({ set: updateSet } as unknown as ReturnType<typeof db.update>);

    vi.mocked(getCheckoutStatus).mockResolvedValue({ status: "succeeded" });

    const { retryDeferredPayments } = await import("@/server/crons/retry-deferred-payments");
    const res = await retryDeferredPayments();

    expect(res.resolved).toBe(1);
    expect(res.conflicted).toBe(0);
    expect(db.update).toHaveBeenCalled();
    expect(vi.mocked(writeAudit)).toHaveBeenCalledWith(
      expect.objectContaining({ action: "payment.deferred_resolved" })
    );
  });

  it("opens a sync_conflict when Yoco reports failed", async () => {
    const { db } = await import("@db/index");
    const { getCheckoutStatus } = await import("@/server/yoco/client");

    vi.mocked(db.select)
      .mockReturnValueOnce({
        from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([makePayment()]) }),
      } as unknown as ReturnType<typeof db.select>)
      .mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([{ id: "ord-1", state: "ordered", totalZar: 4500 }]),
        }),
      } as unknown as ReturnType<typeof db.select>);

    const updateWhere = vi.fn().mockResolvedValue([]);
    vi.mocked(db.update).mockReturnValue({ set: vi.fn().mockReturnValue({ where: updateWhere }) } as unknown as ReturnType<typeof db.update>);

    const insertValues = vi.fn().mockResolvedValue([]);
    vi.mocked(db.insert).mockReturnValue({ values: insertValues } as unknown as ReturnType<typeof db.insert>);

    vi.mocked(getCheckoutStatus).mockResolvedValue({ status: "failed" });

    const { retryDeferredPayments } = await import("@/server/crons/retry-deferred-payments");
    const res = await retryDeferredPayments();

    expect(res.conflicted).toBe(1);
    expect(res.resolved).toBe(0);
    expect(db.insert).toHaveBeenCalled();
  });

  it("opens a sync_conflict when Yoco reports expired", async () => {
    const { db } = await import("@db/index");
    const { getCheckoutStatus } = await import("@/server/yoco/client");

    vi.mocked(db.select)
      .mockReturnValueOnce({
        from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([makePayment()]) }),
      } as unknown as ReturnType<typeof db.select>)
      .mockReturnValueOnce({
        from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }),
      } as unknown as ReturnType<typeof db.select>);

    vi.mocked(db.update).mockReturnValue({ set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }) } as unknown as ReturnType<typeof db.update>);
    vi.mocked(db.insert).mockReturnValue({ values: vi.fn().mockResolvedValue([]) } as unknown as ReturnType<typeof db.insert>);

    vi.mocked(getCheckoutStatus).mockResolvedValue({ status: "expired" });

    const { retryDeferredPayments } = await import("@/server/crons/retry-deferred-payments");
    const res = await retryDeferredPayments();

    expect(res.conflicted).toBe(1);
  });

  it("skips payment when Yoco call throws (transient network error)", async () => {
    const { db } = await import("@db/index");
    const { getCheckoutStatus } = await import("@/server/yoco/client");

    vi.mocked(db.select).mockReturnValueOnce({
      from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([makePayment()]) }),
    } as unknown as ReturnType<typeof db.select>);

    vi.mocked(getCheckoutStatus).mockRejectedValue(new Error("Network timeout"));

    const { retryDeferredPayments } = await import("@/server/crons/retry-deferred-payments");
    const res = await retryDeferredPayments();

    expect(res.skipped).toBe(1);
    expect(res.resolved).toBe(0);
    expect(res.conflicted).toBe(0);
  });

  it("leaves pending payments untouched (no update, no conflict)", async () => {
    const { db } = await import("@db/index");
    const { getCheckoutStatus } = await import("@/server/yoco/client");

    vi.mocked(db.select).mockReturnValueOnce({
      from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([makePayment()]) }),
    } as unknown as ReturnType<typeof db.select>);

    vi.mocked(getCheckoutStatus).mockResolvedValue({ status: "pending" });

    const { retryDeferredPayments } = await import("@/server/crons/retry-deferred-payments");
    const res = await retryDeferredPayments();

    expect(res.checked).toBe(1);
    expect(res.resolved).toBe(0);
    expect(res.conflicted).toBe(0);
    expect(res.skipped).toBe(0);
    expect(db.update).not.toHaveBeenCalled();
    expect(db.insert).not.toHaveBeenCalled();
  });

  it("processes multiple payments independently", async () => {
    const { db } = await import("@db/index");
    const { getCheckoutStatus } = await import("@/server/yoco/client");

    vi.mocked(db.select).mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([makePayment({ id: "pay-1" }), makePayment({ id: "pay-2" })]),
      }),
    } as unknown as ReturnType<typeof db.select>);

    vi.mocked(db.update).mockReturnValue({ set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }) } as unknown as ReturnType<typeof db.update>);

    vi.mocked(getCheckoutStatus)
      .mockResolvedValueOnce({ status: "succeeded" })
      .mockResolvedValueOnce({ status: "pending" });

    const { retryDeferredPayments } = await import("@/server/crons/retry-deferred-payments");
    const res = await retryDeferredPayments();

    expect(res.checked).toBe(2);
    expect(res.resolved).toBe(1);
    expect(res.conflicted).toBe(0);
  });
});
