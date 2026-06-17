import { describe, it, expect } from "vitest";
import {
  isValidPushSubscription,
  buildOrderReadyPayload,
} from "@/server/push/payload";

const VALID_SUB = {
  endpoint: "https://push.example.com/abc",
  keys: { p256dh: "key-p256dh", auth: "key-auth" },
};

describe("push: subscription validation", () => {
  it("accepts a well-formed subscription", () => {
    expect(isValidPushSubscription(VALID_SUB)).toBe(true);
  });

  it("rejects missing endpoint or keys", () => {
    expect(isValidPushSubscription({ keys: VALID_SUB.keys })).toBe(false);
    expect(isValidPushSubscription({ endpoint: "x" })).toBe(false);
    expect(isValidPushSubscription({ endpoint: "x", keys: { p256dh: "a" } })).toBe(false);
  });

  it("rejects non-objects", () => {
    expect(isValidPushSubscription(null)).toBe(false);
    expect(isValidPushSubscription("nope")).toBe(false);
    expect(isValidPushSubscription(42)).toBe(false);
  });
});

describe("push: order-ready payload", () => {
  it("includes the order id and a navigable url in data", () => {
    const payload = buildOrderReadyPayload("ord_1");
    expect(payload.data.orderId).toBe("ord_1");
    expect(payload.data.url).toBe("/customer");
    expect(payload.title.length).toBeGreaterThan(0);
  });

  it("personalises the body when a name is supplied", () => {
    const named = buildOrderReadyPayload("ord_2", "Louis");
    expect(named.body).toContain("Louis");
  });

  it("falls back to a generic body without a name", () => {
    const anon = buildOrderReadyPayload("ord_3");
    expect(anon.body.toLowerCase()).toContain("your order is ready");
  });
});
