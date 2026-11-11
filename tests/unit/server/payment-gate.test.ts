// The payment gate on ordered → in_progress (L01, S3, REQ-008 / S4, DEC-21;
// owner decision Mia, 9 Nov 2026). Literal days: Sun 8 Nov 2026, Sat 7 Nov
// 2026, Mon 9 Nov 2026. No YOCO_SECRET_KEY switches the gate.

import { describe, it, expect, vi, afterEach } from "vitest";
import { decidePaymentGate, decideQueueCardGate, type PaymentGateFacts } from "@/server/orders/payment-gate";
import type { Order } from "@/lib/types";

const SUNDAY = "2026-11-08";
const SATURDAY = "2026-11-07";
const MONDAY = "2026-11-09";
const SENT = new Date("2026-11-08T07:31:00Z");

const paid = (over: Partial<PaymentGateFacts>): PaymentGateFacts => ({
  totalZar: 3800, paymentMode: "yoco", revenueDay: SUNDAY, attempts: [], ...over,
});

afterEach(() => vi.unstubAllEnvs());

describe("decidePaymentGate", () => {
  it("DEC-21 on: a Sunday R38.00 order with no FAVO payment may start (card on the Yoco machine)", () => {
    expect(decidePaymentGate(paid({}), true)).toBe("sunday_machine");
  });

  it("DEC-21 off: the same Sunday order needs a payment", () => {
    expect(decidePaymentGate(paid({}), false)).toBe("payment_required");
  });

  it("DEC-21 on: a Sunday order whose latest attempt was SENT keeps the normal rule (declined → payment required)", () => {
    expect(decidePaymentGate(paid({ attempts: [{ status: "declined", sentAt: SENT }] }), true)).toBe("payment_required");
    expect(decidePaymentGate(paid({ attempts: [{ status: "pending", sentAt: SENT }] }), true)).toBe("payment_required");
  });

  it("DEC-21 on: a never-sent attempt on a Sunday does not hold the drink back", () => {
    expect(decidePaymentGate(paid({ attempts: [{ status: "unresolved", sentAt: null }] }), true)).toBe("sunday_machine");
  });

  it("weekday free order (R0.00) is open, whatever the switch", () => {
    for (const on of [true, false]) {
      expect(decidePaymentGate(paid({ totalZar: 0, paymentMode: "free", revenueDay: MONDAY }), on)).toBe("open");
    }
  });

  it("Saturday event R38.00 with no payment needs one, even with DEC-21 on", () => {
    expect(decidePaymentGate(paid({ revenueDay: SATURDAY }), true)).toBe("payment_required");
  });

  it("Saturday event R38.00 with a successful payment is open", () => {
    expect(decidePaymentGate(paid({ revenueDay: SATURDAY, attempts: [{ status: "successful", sentAt: SENT }] }), true)).toBe("open");
  });

  it("a paid order (successful payment) is open — never recorded as Sunday-machine", () => {
    expect(decidePaymentGate(paid({ attempts: [{ status: "successful", sentAt: SENT }] }), true)).toBe("open");
  });

  it("REQ-008 / S4: a SENT unresolved attempt is open", () => {
    expect(decidePaymentGate(paid({ revenueDay: SATURDAY, attempts: [{ status: "unresolved", sentAt: SENT }] }), false)).toBe("open");
  });

  it("T3 step 2 / §6.7: a Saturday event R38.00 deferred order (yoco_deferred) starts, in every mode, switch on or off", () => {
    for (const day of [SATURDAY, SUNDAY, MONDAY]) {
      for (const on of [true, false]) {
        expect(decidePaymentGate(paid({ revenueDay: day, paymentMode: "yoco_deferred" }), on)).toBe("open");
      }
    }
  });

  it("the same Saturday R38.00 order not deferred is refused", () => {
    expect(decidePaymentGate(paid({ revenueDay: SATURDAY, paymentMode: "yoco" }), true)).toBe("payment_required");
    expect(decidePaymentGate(paid({ revenueDay: SATURDAY, paymentMode: null }), true)).toBe("payment_required");
  });

  it("L47: a blessing-fund order is open with no payments row", () => {
    expect(decidePaymentGate(paid({ revenueDay: SATURDAY, paymentMode: "donor_fund" }), false)).toBe("open");
  });

  it("YOCO_SECRET_KEY set or unset makes no difference", () => {
    const cases: [PaymentGateFacts, boolean][] = [
      [paid({ revenueDay: SATURDAY }), true],
      [paid({ revenueDay: MONDAY }), false],
      [paid({}), true],
      [paid({ totalZar: 0, paymentMode: "free", revenueDay: MONDAY }), true],
    ];
    vi.stubEnv("YOCO_SECRET_KEY", "sk_test_x");
    const withKey = cases.map(([f, on]) => decidePaymentGate(f, on));
    vi.stubEnv("YOCO_SECRET_KEY", "");
    const withoutKey = cases.map(([f, on]) => decidePaymentGate(f, on));
    expect(withKey).toEqual(["payment_required", "payment_required", "sunday_machine", "open"]);
    expect(withoutKey).toEqual(withKey);
  });

  it("an unreadable revenue day is not a Sunday (fails closed)", () => {
    expect(decidePaymentGate(paid({ revenueDay: "not-a-day" }), true)).toBe("payment_required");
  });
});

describe("decideQueueCardGate (the POS queue card)", () => {
  const card = (over: Partial<Order>): Order => ({
    id: "ord_1", customerId: null, customerName: null, staffId: "s1", state: "ordered",
    placedAt: "2026-11-08T07:30:00Z", completedAt: null, totalZar: 3800, isStaffDiscount: false,
    paymentStatus: null, items: [], ...over,
  });

  it("Sunday, no payment, switch on → sunday_machine; off → payment_required", () => {
    expect(decideQueueCardGate(card({}), true)).toBe("sunday_machine");
    expect(decideQueueCardGate(card({}), false)).toBe("payment_required");
  });

  it("falls back to the SAST day of placedAt: 22:30 UTC Saturday 7 Nov is Sunday 8 Nov in SAST", () => {
    expect(decideQueueCardGate(card({ placedAt: "2026-11-07T22:30:00Z" }), true)).toBe("sunday_machine");
    expect(decideQueueCardGate(card({ placedAt: "2026-11-07T21:30:00Z" }), true)).toBe("payment_required");
  });

  it("a Sunday order whose latest attempt was sent and declined needs a payment", () => {
    expect(decideQueueCardGate(card({ paymentStatus: "declined", latestAttemptSent: true }), true)).toBe("payment_required");
  });

  it("a Saturday R38.00 deferred order (paymentMode yoco_deferred, e.g. an offline replay) is open; not deferred it is not", () => {
    expect(decideQueueCardGate(card({ revenueDay: SATURDAY, paymentMode: "yoco_deferred" }), true)).toBe("open");
    expect(decideQueueCardGate(card({ revenueDay: SATURDAY, paymentMode: "yoco" }), true)).toBe("payment_required");
  });

  it("a fund-settled, a successful and an awaiting-lookup order are open", () => {
    expect(decideQueueCardGate(card({ revenueDay: SATURDAY, fundSettled: true }), true)).toBe("open");
    expect(decideQueueCardGate(card({ revenueDay: SATURDAY, paymentStatus: "successful" }), true)).toBe("open");
    expect(decideQueueCardGate(card({ revenueDay: SATURDAY, paymentStatus: "unresolved", paymentAwaitingLookup: true }), true)).toBe("open");
  });
});

// DEC-28 (b) (owner, Mia, 11 Nov 2026): a paid event on any day — a Thursday
// included — is allowed. Web POS is not live, so while DEC-21's switch is on,
// an order bound to a paid-posture event window (standard or override) starts
// without a FAVO payment exactly as a Sunday-date order does; the server audits
// it as event_started_without_favo_payment. A free posture is not paid.
describe("DEC-28 (b): a paid event's card is on the Yoco machine", () => {
  const THURSDAY = "2026-11-12";

  it("Thursday R38.00 standard event, no payment, switch on → event_machine; off → payment_required", () => {
    expect(decidePaymentGate(paid({ revenueDay: THURSDAY, eventPaymentPosture: "standard" }), true)).toBe("event_machine");
    expect(decidePaymentGate(paid({ revenueDay: THURSDAY, eventPaymentPosture: "standard" }), false)).toBe("payment_required");
  });

  it("an override (event prices) posture is paid too; Saturday the same", () => {
    expect(decidePaymentGate(paid({ revenueDay: THURSDAY, eventPaymentPosture: "override" }), true)).toBe("event_machine");
    expect(decidePaymentGate(paid({ revenueDay: SATURDAY, eventPaymentPosture: "standard" }), true)).toBe("event_machine");
  });

  it("no event, or a free posture, keeps PAYMENT_REQUIRED on a Thursday", () => {
    expect(decidePaymentGate(paid({ revenueDay: THURSDAY }), true)).toBe("payment_required");
    expect(decidePaymentGate(paid({ revenueDay: THURSDAY, eventPaymentPosture: null }), true)).toBe("payment_required");
    expect(decidePaymentGate(paid({ revenueDay: THURSDAY, eventPaymentPosture: "free" }), true)).toBe("payment_required");
  });

  it("S3: a latest attempt SENT to the terminal keeps the normal rule", () => {
    expect(decidePaymentGate(paid({ revenueDay: THURSDAY, eventPaymentPosture: "standard", attempts: [{ status: "declined", sentAt: SENT }] }), true)).toBe("payment_required");
    expect(decidePaymentGate(paid({ revenueDay: THURSDAY, eventPaymentPosture: "standard", attempts: [{ status: "successful", sentAt: SENT }] }), true)).toBe("open");
  });

  it("a Sunday event keeps the Sunday rule (DEC-26 unchanged)", () => {
    expect(decidePaymentGate(paid({ revenueDay: SUNDAY, eventPaymentPosture: "standard" }), true)).toBe("sunday_machine");
  });

  it("a free (R0) event order is open whatever the switch", () => {
    for (const on of [true, false]) {
      expect(decidePaymentGate(paid({ revenueDay: THURSDAY, totalZar: 0, paymentMode: "free", eventPaymentPosture: "free" }), on)).toBe("open");
    }
  });

  it("the queue card draws the same decision from the order's event posture", () => {
    const card: Order = {
      id: "ord_1", customerId: null, customerName: null, staffId: "s1", state: "ordered",
      placedAt: "2026-11-12T17:00:00Z", completedAt: null, totalZar: 3800, isStaffDiscount: false,
      paymentStatus: null, items: [], revenueDay: THURSDAY, paymentMode: "yoco", eventPaymentPosture: "standard",
    };
    expect(decideQueueCardGate(card, true)).toBe("event_machine");
    expect(decideQueueCardGate({ ...card, eventPaymentPosture: null }, true)).toBe("payment_required");
    expect(decideQueueCardGate({ ...card, paymentStatus: "declined", latestAttemptSent: true }, true)).toBe("payment_required");
  });
});
