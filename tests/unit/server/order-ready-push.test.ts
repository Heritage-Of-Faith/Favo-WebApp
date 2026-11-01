// REQ-047 / L28 / §6.1 — transitionOrder('ready') pushes to a registered
// customer who has a subscription, and to nobody else; a 410 prunes the
// subscription and writes an audit row. The push itself is mocked here; the
// real payload is proven in order-ready-push-delivery.test.ts.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/server/auth/guard", () => ({
  authorize: vi.fn().mockResolvedValue({ ok: true, session: { id: "staff1", role: "barista" } }),
}));

const state = {
  order: null as Record<string, unknown> | null,
  customer: null as Record<string, unknown> | null,
  selectCount: 0,
  transactions: 0,
  pruneUpdates: [] as unknown[],
};

const mockWriteAudit = vi.fn().mockResolvedValue(undefined);
vi.mock("@/server/audit", () => ({ writeAudit: (...a: unknown[]) => mockWriteAudit(...a) }));
vi.mock("@/server/orders/deduction", () => ({
  deductForOrder: vi.fn().mockResolvedValue(undefined),
  DeductionError: class extends Error {},
}));
vi.mock("@/server/queue/notify", () => ({ notifyOrderChange: vi.fn().mockResolvedValue(undefined) }));
const mockSendReady = vi.fn();
vi.mock("@/server/push/send", () => ({
  sendOrderReadyPush: (...a: unknown[]) => mockSendReady(...a),
}));

vi.mock("@/lib/db", () => {
  function makeTx() {
    return {
      select: () => ({
        from: () => ({
          where: () => {
            const n = ++state.selectCount;
            if (n === 1) {
              return { for: () => Promise.resolve(state.order ? [state.order] : []) };
            }
            return Promise.resolve(state.customer ? [state.customer] : []);
          },
        }),
      }),
      update: () => ({
        set: (v: unknown) => ({
          where: () => {
            state.pruneUpdates.push(v);
            return Object.assign(Promise.resolve(), {
              returning: () => Promise.resolve([{ id: "cust-1" }]),
            });
          },
        }),
      }),
      insert: () => ({ values: () => Promise.resolve() }),
    };
  }
  return {
    db: {
      select: vi.fn().mockImplementation(() => ({
        from: () => ({
          where: () => {
            const rows = state.order ? [state.order] : [];
            // orderBy: loadOrder reads every payment attempt ORDER BY attempt (AT-201 part 2b).
            return Object.assign(Promise.resolve(rows), { limit: () => Promise.resolve([]), orderBy: () => Promise.resolve([]) });
          },
          leftJoin: () => ({ where: () => Promise.resolve([]) }),
          limit: () => Promise.resolve([]),
        }),
      })),
      transaction: async (cb: (tx: unknown) => Promise<void>) => {
        state.transactions++;
        return cb(makeTx());
      },
    },
  };
});

import { transitionOrder } from "@/server/actions/orders";

const SUB = { endpoint: "https://push.invalid/abc", keys: { p256dh: "p", auth: "a" } };
const flush = () => new Promise((r) => setTimeout(r, 0));

function setOrder(over: Record<string, unknown> = {}) {
  state.order = {
    id: "ord-1", state: "in_progress", totalZar: 3800, customerId: "cust-1", notificationTarget: "customer",
    staffId: "staff1", completedAt: null,
    placedAt: { toISOString: () => "2026-06-19T08:00:00.000Z" },
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  state.order = null; state.customer = null; state.selectCount = 0;
  state.transactions = 0; state.pruneUpdates = [];
  mockSendReady.mockResolvedValue(true);
});

describe("transitionOrder('ready') customer push", () => {
  it("pushes once to a registered customer with a subscription", async () => {
    setOrder();
    state.customer = { name: "Thandi", pushSubscription: SUB };
    const res = await transitionOrder("ord-1", "ready");
    await flush();
    expect(res.ok).toBe(true);
    expect(mockSendReady).toHaveBeenCalledTimes(1);
    expect(mockSendReady).toHaveBeenCalledWith(SUB, "ord-1", "Thandi");
  });

  it("does not push when the order has no customer", async () => {
    setOrder({ customerId: null, notificationTarget: "none" });
    await transitionOrder("ord-1", "ready");
    await flush();
    expect(mockSendReady).not.toHaveBeenCalled();
  });

  it("does not push when the customer has no subscription", async () => {
    setOrder();
    state.customer = { name: "Thandi", pushSubscription: null };
    const res = await transitionOrder("ord-1", "ready");
    await flush();
    expect(res.ok).toBe(true);
    expect(mockSendReady).not.toHaveBeenCalled();
  });

  it("does not push for any state other than ready", async () => {
    setOrder({ state: "ready" });
    state.customer = { name: "Thandi", pushSubscription: SUB };
    await transitionOrder("ord-1", "collected");
    await flush();
    expect(mockSendReady).not.toHaveBeenCalled();
  });

  it("prunes the subscription and audits it when the push reports 410", async () => {
    setOrder();
    state.customer = { name: "Thandi", pushSubscription: SUB };
    mockSendReady.mockResolvedValue(false); // 404/410 → false
    const res = await transitionOrder("ord-1", "ready");
    await flush();
    expect(res.ok).toBe(true); // the order transition is unaffected
    expect(state.pruneUpdates).toContainEqual({ pushSubscription: null });
    expect(mockWriteAudit).toHaveBeenCalledWith(
      expect.objectContaining({ entityKind: "customer", entityId: "cust-1", action: "push_unsubscribe" }),
      expect.anything()
    );
  });

  it("a push that throws never fails the transition", async () => {
    setOrder();
    state.customer = { name: "Thandi", pushSubscription: SUB };
    mockSendReady.mockRejectedValue(new Error("vapid"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await transitionOrder("ord-1", "ready");
    await flush();
    expect(res.ok).toBe(true);
  });
});
