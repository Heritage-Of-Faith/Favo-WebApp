// webhook-earn.test.ts — F6 / L06
// Loyalty earn moved from transitionOrder to the Yoco webhook (payment.succeeded).
// Drives the real POST handler in src/app/api/payments/yoco/webhook/route.ts with
// a validly-signed body, mocking the DB + side effects.
//
// Covers:
//   - earn on payment.succeeded for an order with a customer (earns on current total)
//   - earnPoints(0) = 0 ⇒ no loyalty insert (zero-total / full pack coverage)
//   - no customer ⇒ no earn
//   - idempotency: duplicate delivery uses onConflictDoNothing() and does not double-credit
//   - payment.failed ⇒ no earn
//   - points-earned push fires after commit when the customer has a valid subscription

import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import { computeSignature } from "@/server/yoco/signature";

const WEBHOOK_SECRET = "whsec_test_secret";

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("@/server/audit", () => ({ writeAudit: vi.fn().mockResolvedValue(undefined) }));

vi.mock("@/server/actions/loyalty", () => ({
  activatePendingCharge: vi.fn().mockResolvedValue(undefined),
}));

const sendPointsEarnedPush = vi.fn().mockResolvedValue(true);
vi.mock("@/server/push/send", () => ({
  sendPointsEarnedPush: (...a: unknown[]) => sendPointsEarnedPush(...a),
  sendOrderReadyPush: vi.fn().mockResolvedValue(true),
}));

// isValidPushSubscription: default true so the push path is exercised; a test
// can override per-call.
const isValidPushSubscription = vi.fn((_x: unknown) => true);
vi.mock("@/server/push/payload", () => ({
  isValidPushSubscription: (x: unknown) => isValidPushSubscription(x),
}));

// ─── DB mock ──────────────────────────────────────────────────────────────────
//
// The webhook makes these queries on the order-payment path:
//   1. db.select(pendingCharges).where()                 → [] (not a pending charge)
//   2. db.select(payments).where(or(...))                → [existingPayment]
//   3. tx.select(payments).where().for("update")         → [locked]  (status pending)
//   4. tx.update(payments)...                            (mark successful)
//   5. tx.select(orders).where()                         → [order]   (customerId,totalZar)
//   6. tx.insert(loyaltyTransactions)...onConflictDoNothing().returning() → inserted rows
//   7. tx.update(customers)...                           (increment balance)
//   8. tx.select(customers).where()                      → [cust]    (subscription+balance)
//   9. writeAudit (mocked)

type Rows = unknown[];

const state = {
  pendingCharge: [] as Rows,
  existingPayment: [] as Rows,
  lockedPayment: [] as Rows,
  order: [] as Rows,
  insertedEarn: [] as Rows, // what loyaltyTransactions insert().returning() yields
  customer: [] as Rows,
};

const loyaltyInsertValues = vi.fn();
const customerUpdate = vi.fn();

vi.mock("@db/index", () => {
  // db.select is used for the two pre-transaction reads (pendingCharges, payments).
  let dbSelectCall = 0;

  function dbSelect() {
    const idx = dbSelectCall++;
    const rows = idx === 0 ? state.pendingCharge : state.existingPayment;
    return {
      from: () => ({
        where: () => ({
          then: (resolve: (v: Rows) => void) => resolve(rows),
          [Symbol.toStringTag]: "Promise",
        }),
      }),
    };
  }

  function makeTx() {
    let txSelectCall = 0;
    return {
      select: () => {
        const idx = txSelectCall++;
        // 0 → locked payment (.for("update")), 1 → order, 2 → customer re-fetch
        const rows =
          idx === 0 ? state.lockedPayment : idx === 1 ? state.order : state.customer;
        return {
          from: () => ({
            where: () => ({
              for: () => ({
                then: (resolve: (v: Rows) => void) => resolve(rows),
                [Symbol.toStringTag]: "Promise",
              }),
              then: (resolve: (v: Rows) => void) => resolve(rows),
              [Symbol.toStringTag]: "Promise",
            }),
          }),
        };
      },
      update: (...uArgs: unknown[]) => ({
        set: (setArg: unknown) => ({
          where: () => {
            customerUpdate(uArgs[0], setArg);
            return Promise.resolve();
          },
        }),
      }),
      insert: (schema: unknown) => ({
        values: (vals: unknown) => {
          loyaltyInsertValues(schema, vals);
          return {
            onConflictDoNothing: () => ({
              returning: () => Promise.resolve(state.insertedEarn),
            }),
          };
        },
      }),
    };
  }

  return {
    db: {
      select: vi.fn().mockImplementation(dbSelect),
      transaction: async (cb: (tx: unknown) => Promise<void>) => {
        dbSelectCall = 0; // reset counter is unnecessary but harmless
        return cb(makeTx());
      },
    },
    __resetDbSelect: () => {
      dbSelectCall = 0;
    },
  };
});

// ─── Helpers ────────────────────────────────────────────────────────────────

const VALID_SUB = {
  endpoint: "https://push.example.com/abc",
  keys: { p256dh: "k1", auth: "k2" },
};

function post(body: Record<string, unknown>) {
  const raw = JSON.stringify(body);
  const sig = computeSignature(raw, WEBHOOK_SECRET);
  return new Request("https://favo.test/api/payments/yoco/webhook", {
    method: "POST",
    headers: { "webhook-signature": sig, "content-type": "application/json" },
    body: raw,
  });
}

/** Column-shape detector: loyalty_transactions insert has `delta` + `kind:'earn'`. */
function loyaltyEarnInsertCall() {
  return loyaltyInsertValues.mock.calls.find((args) => {
    const vals = args[1] as Record<string, unknown> | null;
    return vals != null && "delta" in vals && vals.kind === "earn";
  });
}

beforeAll(() => {
  vi.stubEnv("YOCO_WEBHOOK_SECRET", WEBHOOK_SECRET);
});
afterAll(() => {
  vi.unstubAllEnvs();
});

beforeEach(() => {
  vi.clearAllMocks();
  state.pendingCharge = [];
  state.existingPayment = [{ id: "pmt_1", status: "pending", orderId: "ord_1" }];
  state.lockedPayment = [{ id: "pmt_1", status: "pending", orderId: "ord_1" }];
  state.order = [{ customerId: "cust_1", totalZar: 3500 }];
  state.insertedEarn = [{ id: "ltx_1" }]; // first delivery inserts a row
  state.customer = [{ pushSubscription: VALID_SUB, loyaltyPoints: 15 }];
  isValidPushSubscription.mockReturnValue(true);
});

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("webhook earn — payment.succeeded accrues loyalty (L06)", () => {
  it("W1: earns on the order's current total for a known customer (earnPoints(3500)=15)", async () => {
    const { POST } = await import("@/app/api/payments/yoco/webhook/route");
    const res = await POST(post({ type: "payment.succeeded", paymentId: "pay_1", checkoutId: "ck_1" }));
    expect(res.status).toBe(200);

    const earn = loyaltyEarnInsertCall();
    expect(earn).toBeDefined();
    const vals = earn![1] as Record<string, unknown>;
    expect(vals.delta).toBe(15); // earnPoints(3500) = floor(3.5)*5
    expect(vals.orderId).toBe("ord_1");
    expect(vals.customerId).toBe("cust_1");
  });

  it("W2: discount-reduced total earns on the current (reduced) total, not the original", async () => {
    // Order total was reduced to R20.00 before payment; earn must be on 2000.
    state.order = [{ customerId: "cust_1", totalZar: 2000 }];
    const { POST } = await import("@/app/api/payments/yoco/webhook/route");
    await POST(post({ type: "payment.succeeded", paymentId: "pay_2", checkoutId: "ck_2" }));

    const earn = loyaltyEarnInsertCall();
    expect(earn).toBeDefined();
    expect((earn![1] as Record<string, unknown>).delta).toBe(10); // earnPoints(2000)=10
  });

  it("W3: zero total ⇒ earnPoints(0)=0 ⇒ no loyalty insert", async () => {
    state.order = [{ customerId: "cust_1", totalZar: 0 }];
    const { POST } = await import("@/app/api/payments/yoco/webhook/route");
    await POST(post({ type: "payment.succeeded", paymentId: "pay_3", checkoutId: "ck_3" }));

    expect(loyaltyEarnInsertCall()).toBeUndefined();
    expect(sendPointsEarnedPush).not.toHaveBeenCalled();
  });

  it("W4: order with no customer (walk-in) ⇒ no earn", async () => {
    state.order = [{ customerId: null, totalZar: 3500 }];
    const { POST } = await import("@/app/api/payments/yoco/webhook/route");
    await POST(post({ type: "payment.succeeded", paymentId: "pay_4", checkoutId: "ck_4" }));

    expect(loyaltyEarnInsertCall()).toBeUndefined();
  });

  it("W5: idempotency — a duplicate delivery inserts nothing and does not double-credit", async () => {
    // Simulate the second delivery: onConflictDoNothing() returns [] (row already exists).
    state.insertedEarn = [];
    const { POST } = await import("@/app/api/payments/yoco/webhook/route");
    await POST(post({ type: "payment.succeeded", paymentId: "pay_5", checkoutId: "ck_5" }));

    // The insert IS attempted (with onConflictDoNothing) but returns no row...
    const earn = loyaltyEarnInsertCall();
    expect(earn).toBeDefined();
    // ...and because nothing was inserted, the customers balance must NOT be incremented.
    const balanceIncrement = customerUpdate.mock.calls.find((args) => {
      const setArg = args[1] as Record<string, unknown> | null;
      return setArg != null && "loyaltyPoints" in setArg;
    });
    expect(balanceIncrement).toBeUndefined();
    // No push either, since no points were freshly credited this delivery.
    expect(sendPointsEarnedPush).not.toHaveBeenCalled();
  });

  it("W6: a second delivery whose payment is already 'successful' is a no-op (locked guard)", async () => {
    state.lockedPayment = [{ id: "pmt_1", status: "successful", orderId: "ord_1" }];
    const { POST } = await import("@/app/api/payments/yoco/webhook/route");
    await POST(post({ type: "payment.succeeded", paymentId: "pay_6", checkoutId: "ck_6" }));

    expect(loyaltyEarnInsertCall()).toBeUndefined();
    expect(sendPointsEarnedPush).not.toHaveBeenCalled();
  });

  it("W7: payment.failed never earns", async () => {
    const { POST } = await import("@/app/api/payments/yoco/webhook/route");
    await POST(post({ type: "payment.failed", paymentId: "pay_7", checkoutId: "ck_7" }));

    expect(loyaltyEarnInsertCall()).toBeUndefined();
  });

  it("W8: fires the points-earned push with the new balance when a subscription is present", async () => {
    state.customer = [{ pushSubscription: VALID_SUB, loyaltyPoints: 40 }];
    const { POST } = await import("@/app/api/payments/yoco/webhook/route");
    await POST(post({ type: "payment.succeeded", paymentId: "pay_8", checkoutId: "ck_8" }));
    await new Promise((r) => setTimeout(r, 0)); // let fire-and-forget settle

    expect(sendPointsEarnedPush).toHaveBeenCalledOnce();
    const [, pointsArg, balanceArg] = sendPointsEarnedPush.mock.calls[0];
    expect(pointsArg).toBe(15);
    expect(balanceArg).toBe(40);
  });

  it("W9: no push when the customer has no valid subscription", async () => {
    state.customer = [{ pushSubscription: null, loyaltyPoints: 15 }];
    isValidPushSubscription.mockReturnValue(false);
    const { POST } = await import("@/app/api/payments/yoco/webhook/route");
    await POST(post({ type: "payment.succeeded", paymentId: "pay_9", checkoutId: "ck_9" }));
    await new Promise((r) => setTimeout(r, 0));

    expect(sendPointsEarnedPush).not.toHaveBeenCalled();
  });
});
