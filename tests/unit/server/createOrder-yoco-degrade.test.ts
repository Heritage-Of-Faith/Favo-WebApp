// Regression test for the P0 bug: createOrder must NOT fail when Yoco is down.
// Previously, a Yoco payment-intent rejection re-threw in production, which both
// surfaced a generic "Failed to place order" to the barista AND left a ghost
// order committed in the DB (the transaction runs in parallel). The fix degrades
// gracefully: the order is created, yocoClientSecret is "", and the POS falls
// back to manual cash/card.

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mock every dependency createOrder touches ───────────────────────────────
vi.mock("@/server/auth/guard", () => ({
  authorize: vi.fn(async () => ({ ok: true, session: { id: "staff1", role: "barista" } })),
}));

const menuRows = [{ id: "mi-cap", name: "Cappuccino", currentPriceZar: 3800 }];
vi.mock("@/lib/db", () => ({
  db: {
    select: () => ({ from: () => ({ where: () => Promise.resolve(menuRows) }) }),
    transaction: async (cb: (tx: unknown) => Promise<void>) =>
      cb({ insert: () => ({ values: () => Promise.resolve() }) }),
  },
}));

vi.mock("@/server/audit", () => ({ writeAudit: vi.fn(async () => {}) }));
vi.mock("@/server/queue/notify", () => ({ notifyOrderChange: vi.fn(async () => {}) }));
vi.mock("@/server/orders/pricing", () => ({ computeOrderTotalZar: () => 3800 }));

const mockCreatePaymentIntent = vi.fn();
vi.mock("@/server/yoco/client", () => ({
  createPaymentIntent: (...a: unknown[]) => mockCreatePaymentIntent(...a),
}));

import { createOrder } from "@/server/actions/orders";

const ORDER_INPUT = { items: [{ menuItemId: "mi-cap", quantity: 1, modifications: [] }] };

beforeEach(() => vi.clearAllMocks());

describe("createOrder — graceful Yoco degradation (P0 regression)", () => {
  it("still succeeds with an empty client secret when Yoco rejects", async () => {
    mockCreatePaymentIntent.mockRejectedValue(new Error("YOCO_SECRET_KEY invalid"));
    const res = await createOrder(ORDER_INPUT);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.orderId).toBeTruthy();
      expect(res.data.yocoClientSecret).toBe(""); // → POS manual-payment fallback path
    }
  });

  it("returns the real client secret when Yoco succeeds", async () => {
    mockCreatePaymentIntent.mockResolvedValue({ clientSecret: "cs_live_123" });
    const res = await createOrder(ORDER_INPUT);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data.yocoClientSecret).toBe("cs_live_123");
  });

  it("does not re-throw even when NODE_ENV is production", async () => {
    const prev = process.env.NODE_ENV;
    // @ts-expect-error — override for the test
    process.env.NODE_ENV = "production";
    mockCreatePaymentIntent.mockRejectedValue(new Error("YOCO down"));
    try {
      const res = await createOrder(ORDER_INPUT);
      expect(res.ok).toBe(true); // must not throw → POS shows manual fallback
    } finally {
      // @ts-expect-error — restore
      process.env.NODE_ENV = prev;
    }
  });
});
