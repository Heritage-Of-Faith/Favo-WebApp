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

// `payment` is the single-row case; `payments` (AT-201) is several attempts on
// one order, in insertion order. orderBy(...) sorts them by attempt DESC, as
// the real query does; without orderBy the mock returns insertion order, so a
// missing ORDER BY would pick the wrong row.
const state = {
  payment: null as Record<string, unknown> | null,
  payments: null as Record<string, unknown>[] | null,
};
const paymentUpdate = vi.fn();
const updatedIds: unknown[] = [];

vi.mock("@/lib/db", () => {
  function rows(sorted: boolean) {
    const all = state.payments ?? (state.payment ? [state.payment] : []);
    return sorted ? [...all].sort((a, b) => Number(b.attempt) - Number(a.attempt)) : all;
  }
  function makeTx() {
    let lastSelected: Record<string, unknown> | undefined;
    const pick = (sorted: boolean) => ({
      limit: () => {
        lastSelected = rows(sorted)[0];
        return Promise.resolve(lastSelected ? [lastSelected] : []);
      },
    });
    return {
      select: () => ({
        from: () => ({
          where: () => ({
            orderBy: () => ({ for: () => pick(true) }),
            for: () => pick(false),
          }),
        }),
      }),
      update: () => ({
        set: (s: Record<string, unknown>) => ({
          where: () => {
            paymentUpdate(s);
            updatedIds.push(lastSelected?.id);
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
  state.payments = null;
  updatedIds.length = 0;
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

  // AT-201: payment_status is pending | successful | declined | unresolved
  // (PRD §10.3.3) — `failed` became `declined`, `refunded` is gone (L02).
  it("CONFLICT when the payment is already declined", async () => {
    for (const status of ["declined"]) {
      vi.clearAllMocks();
      state.payment = { id: "pmt-1", status };
      const res = await confirmManualPayment("ord-1");
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.code).toBe("CONFLICT");
    }
  });

  // AT-201 / REQ-008: an unresolved payment is recovered by a server-side
  // fetch of Yoco's record, never by a barista's tap.
  it("CONFLICT when the payment is unresolved — and nothing is written", async () => {
    state.payment = { id: "pmt-1", status: "unresolved" };
    const res = await confirmManualPayment("ord-1");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("CONFLICT");
    expect(paymentUpdate).not.toHaveBeenCalled();
    expect(writeAudit).not.toHaveBeenCalled();
  });

  // AT-201: one row per attempt — the latest attempt decides.
  it("reads the latest attempt: attempt 1 declined, attempt 2 pending → confirms attempt 2", async () => {
    state.payments = [
      { id: "pmt-a1", status: "declined", attempt: 1 },
      { id: "pmt-a2", status: "pending", attempt: 2 },
    ];
    const res = await confirmManualPayment("ord-1");
    expect(res.ok).toBe(true);
    expect(updatedIds).toEqual(["pmt-a2"]);
  });

  it("reads the latest attempt: attempt 1 pending, attempt 2 unresolved → CONFLICT, nothing written", async () => {
    state.payments = [
      { id: "pmt-b1", status: "pending", attempt: 1 },
      { id: "pmt-b2", status: "unresolved", attempt: 2 },
    ];
    const res = await confirmManualPayment("ord-1");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("CONFLICT");
    expect(paymentUpdate).not.toHaveBeenCalled();
  });
});
