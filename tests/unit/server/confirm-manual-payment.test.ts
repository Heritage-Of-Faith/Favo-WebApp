// confirm-manual-payment.test.ts — Blocker 1 (Gian review, PR #208)
// confirmManualPayment is how the café tenders most orders (cash / card machine
// / EFT): it marks the payment successful. (Loyalty accrual was removed from
// this path in the v7 deletion pass — see CLAUDE.md §"Deleted by v7".)

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/server/auth/guard", () => ({
  authorize: vi.fn().mockResolvedValue({ ok: true, session: { id: "staff1", role: "barista" } }),
}));

const writeAudit = vi.fn().mockResolvedValue(undefined);
vi.mock("@/server/audit", () => ({ writeAudit: (...a: unknown[]) => writeAudit(...a) }));

vi.mock("@/server/push/send", () => ({
  sendOrderReadyPush: vi.fn().mockResolvedValue(true),
}));
const isValidPushSubscription = vi.fn((_x: unknown) => true);
vi.mock("@/server/push/payload", () => ({ isValidPushSubscription: (x: unknown) => isValidPushSubscription(x) }));

vi.mock("@/server/yoco/client", () => ({ createPaymentIntent: vi.fn() }));
vi.mock("@/server/queue/notify", () => ({ notifyOrderChange: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/server/orders/deduction", () => ({
  deductForOrder: vi.fn().mockResolvedValue(undefined),
  DeductionError: class extends Error {},
}));

const state = { payment: null as Record<string, unknown> | null };
const paymentUpdate = vi.fn();

vi.mock("@/lib/db", () => {
  function makeTx() {
    return {
      select: () => ({
        from: () => ({
          where: () => ({
            for: () => ({
              limit: () => Promise.resolve(state.payment ? [state.payment] : []),
            }),
          }),
        }),
      }),
      update: () => ({
        set: (s: Record<string, unknown>) => ({
          where: () => {
            paymentUpdate(s);
            return Promise.resolve();
          },
        }),
      }),
      insert: () => ({ values: () => Promise.resolve() }),
    };
  }
  return {
    db: { transaction: async (cb: (tx: unknown) => Promise<void>) => cb(makeTx()) },
  };
});

import { confirmManualPayment } from "@/server/actions/orders";

beforeEach(() => {
  vi.clearAllMocks();
  state.payment = { id: "pmt-1", status: "pending" };
  isValidPushSubscription.mockReturnValue(true);
});

describe("confirmManualPayment (Blocker 1 — manual cash/card-machine/EFT tender)", () => {
  it("rejects unauthenticated callers before touching the DB", async () => {
    const { authorize } = await import("@/server/auth/guard");
    vi.mocked(authorize).mockResolvedValueOnce({ ok: false, code: "UNAUTHORIZED", message: "no" });
    const res = await confirmManualPayment("ord-1");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("UNAUTHORIZED");
    expect(paymentUpdate).not.toHaveBeenCalled();
  });

  it("NOT_FOUND when the order has no payment row", async () => {
    state.payment = null;
    const res = await confirmManualPayment("ord-1");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("NOT_FOUND");
  });

  it("marks the payment successful", async () => {
    const res = await confirmManualPayment("ord-1");
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.alreadyConfirmed).toBe(false);
    }
    expect(paymentUpdate).toHaveBeenCalledWith(expect.objectContaining({ status: "successful" }));
    expect(writeAudit).toHaveBeenCalled();
  });

  it("idempotent no-op when the payment is already successful", async () => {
    state.payment = { id: "pmt-1", status: "successful" };
    const res = await confirmManualPayment("ord-1");
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data.alreadyConfirmed).toBe(true);
    expect(paymentUpdate).not.toHaveBeenCalled();
  });

  it("CONFLICT when the payment is already failed or refunded", async () => {
    for (const status of ["failed", "refunded"]) {
      vi.clearAllMocks();
      state.payment = { id: "pmt-1", status };
      const res = await confirmManualPayment("ord-1");
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.code).toBe("CONFLICT");
    }
  });
});
