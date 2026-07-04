// confirm-manual-payment.test.ts — Blocker 1 (Gian review, PR #208)
// confirmManualPayment is how the café tenders most orders (cash / card machine
// / EFT): it marks the payment successful AND accrues loyalty via the shared
// idempotent accrueOrderLoyalty path (L06). Without it, moving earn to the Yoco
// webhook only would stop loyalty earning in production (64/66 payments there
// never go through Yoco).

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/server/auth/guard", () => ({
  authorize: vi.fn().mockResolvedValue({ ok: true, session: { id: "staff1", role: "barista" } }),
}));

const writeAudit = vi.fn().mockResolvedValue(undefined);
vi.mock("@/server/audit", () => ({ writeAudit: (...a: unknown[]) => writeAudit(...a) }));

const accrueOrderLoyalty = vi.fn();
vi.mock("@/server/loyalty/accrue", () => ({
  accrueOrderLoyalty: (...a: unknown[]) => accrueOrderLoyalty(...a),
  reverseOrderLoyalty: vi.fn(),
}));

const sendPointsEarnedPush = vi.fn().mockResolvedValue(true);
vi.mock("@/server/push/send", () => ({
  sendPointsEarnedPush: (...a: unknown[]) => sendPointsEarnedPush(...a),
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
  accrueOrderLoyalty.mockResolvedValue({ earnedPoints: 15, newLoyaltyBalance: 40, subscription: { endpoint: "x" } });
  isValidPushSubscription.mockReturnValue(true);
});

describe("confirmManualPayment (Blocker 1 — manual cash/card-machine/EFT tender)", () => {
  it("rejects unauthenticated callers before touching the DB", async () => {
    const { authorize } = await import("@/server/auth/guard");
    vi.mocked(authorize).mockResolvedValueOnce({ ok: false, code: "UNAUTHORIZED", message: "no" });
    const res = await confirmManualPayment("ord-1");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("UNAUTHORIZED");
    expect(accrueOrderLoyalty).not.toHaveBeenCalled();
  });

  it("NOT_FOUND when the order has no payment row", async () => {
    state.payment = null;
    const res = await confirmManualPayment("ord-1");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("NOT_FOUND");
  });

  it("marks the payment successful and accrues loyalty with the staff actor", async () => {
    const res = await confirmManualPayment("ord-1");
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.earnedPoints).toBe(15);
      expect(res.data.newLoyaltyBalance).toBe(40);
      expect(res.data.alreadyConfirmed).toBe(false);
    }
    expect(paymentUpdate).toHaveBeenCalledWith(expect.objectContaining({ status: "successful" }));
    expect(accrueOrderLoyalty).toHaveBeenCalledWith("ord-1", expect.anything(), { id: "staff1", role: "barista" });
    expect(writeAudit).toHaveBeenCalled();
  });

  it("fires the points-earned push after commit when a subscription is present", async () => {
    await confirmManualPayment("ord-1");
    await new Promise((r) => setTimeout(r, 0));
    expect(sendPointsEarnedPush).toHaveBeenCalledOnce();
    const [, points, balance] = sendPointsEarnedPush.mock.calls[0];
    expect(points).toBe(15);
    expect(balance).toBe(40);
  });

  it("idempotent no-op when the payment is already successful (no re-accrual)", async () => {
    state.payment = { id: "pmt-1", status: "successful" };
    const res = await confirmManualPayment("ord-1");
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data.alreadyConfirmed).toBe(true);
    expect(accrueOrderLoyalty).not.toHaveBeenCalled();
    expect(paymentUpdate).not.toHaveBeenCalled();
    expect(sendPointsEarnedPush).not.toHaveBeenCalled();
  });

  it("CONFLICT when the payment is already failed or refunded", async () => {
    for (const status of ["failed", "refunded"]) {
      vi.clearAllMocks();
      state.payment = { id: "pmt-1", status };
      const res = await confirmManualPayment("ord-1");
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.code).toBe("CONFLICT");
      expect(accrueOrderLoyalty).not.toHaveBeenCalled();
    }
  });

  it("returns 0 earned + no push when accrual credits nothing (walk-in / zero total)", async () => {
    accrueOrderLoyalty.mockResolvedValue(null);
    const res = await confirmManualPayment("ord-1");
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data.earnedPoints).toBe(0);
    await new Promise((r) => setTimeout(r, 0));
    expect(sendPointsEarnedPush).not.toHaveBeenCalled();
  });
});
