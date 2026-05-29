import { describe, it, expect } from "vitest";
import { canTransition, assertTransition } from "@/server/orders/state-machine";

describe("order state machine", () => {
  it("allows ordered → in_progress", () => {
    expect(canTransition("ordered", "in_progress")).toBe(true);
  });

  it("allows ordered → cancelled", () => {
    expect(canTransition("ordered", "cancelled")).toBe(true);
  });

  it("allows in_progress → ready", () => {
    expect(canTransition("in_progress", "ready")).toBe(true);
  });

  it("allows ready → collected", () => {
    expect(canTransition("ready", "collected")).toBe(true);
  });

  it("rejects backwards transition", () => {
    expect(canTransition("ready", "ordered")).toBe(false);
  });

  it("rejects collected → any", () => {
    expect(canTransition("collected", "ready")).toBe(false);
    expect(canTransition("collected", "cancelled")).toBe(false);
  });

  it("throws on invalid transition", () => {
    expect(() => assertTransition("collected", "ordered")).toThrow();
  });
});
