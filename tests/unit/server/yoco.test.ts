import { describe, it, expect } from "vitest";
import { computeSignature, verifyYocoSignature } from "@/server/yoco/signature";
import {
  parseYocoEvent,
  decideWebhookOutcome,
  type YocoEvent,
} from "@/server/yoco/webhook";

const SECRET = "whsec_test_secret";

describe("yoco: signature verification", () => {
  it("verifies a signature it computed", () => {
    const payload = '{"type":"payment.succeeded","paymentId":"pay_1"}';
    const sig = computeSignature(payload, SECRET);
    expect(verifyYocoSignature(payload, sig, SECRET)).toBe(true);
  });

  it("rejects a tampered payload", () => {
    const payload = '{"type":"payment.succeeded","paymentId":"pay_1"}';
    const sig = computeSignature(payload, SECRET);
    expect(verifyYocoSignature(payload + "x", sig, SECRET)).toBe(false);
  });

  it("rejects a wrong secret", () => {
    const payload = '{"amount":100}';
    const sig = computeSignature(payload, SECRET);
    expect(verifyYocoSignature(payload, sig, "whsec_other")).toBe(false);
  });

  it("rejects empty signature or secret", () => {
    expect(verifyYocoSignature("x", "", SECRET)).toBe(false);
    expect(verifyYocoSignature("x", "sig", "")).toBe(false);
  });
});

describe("yoco: event parsing", () => {
  it("parses a valid payment.succeeded event", () => {
    const event = parseYocoEvent({ type: "payment.succeeded", paymentId: "pay_1", orderId: "ord_1", amountZar: 3800 });
    expect(event).toEqual({ type: "payment.succeeded", paymentId: "pay_1", orderId: "ord_1", amountZar: 3800 });
  });

  it("accepts `id` as an alias for paymentId", () => {
    const event = parseYocoEvent({ type: "payment.failed", id: "pay_2" });
    expect(event?.paymentId).toBe("pay_2");
  });

  it("rejects unknown event types", () => {
    expect(parseYocoEvent({ type: "subscription.created", paymentId: "x" })).toBeNull();
  });

  it("rejects malformed payloads", () => {
    expect(parseYocoEvent(null)).toBeNull();
    expect(parseYocoEvent("nope")).toBeNull();
    expect(parseYocoEvent({ type: "payment.succeeded" })).toBeNull(); // no id
  });
});

describe("yoco: outcome routing (idempotent)", () => {
  const paid: YocoEvent = { type: "payment.succeeded", paymentId: "pay_1", orderId: "ord_1" };

  it("marks paid on first delivery", () => {
    expect(decideWebhookOutcome(paid, false)).toEqual({
      action: "mark_paid",
      paymentId: "pay_1",
      orderId: "ord_1",
    });
  });

  it("is a no-op on duplicate delivery", () => {
    expect(decideWebhookOutcome(paid, true).action).toBe("noop");
  });

  it("fails the payment on payment.failed", () => {
    const failed: YocoEvent = { type: "payment.failed", paymentId: "pay_3" };
    expect(decideWebhookOutcome(failed, false).action).toBe("fail_payment");
  });

  it("records a refund on refund.succeeded", () => {
    const refund: YocoEvent = { type: "refund.succeeded", paymentId: "pay_4" };
    expect(decideWebhookOutcome(refund, false).action).toBe("record_refund");
  });
});
