// Service worker unit tests — AT-68 (N16)
// Exercises the push and notificationclick event handlers in public/sw.js
// by loading the script into a synthetic SW global context.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

// ─── Synthetic SW environment ─────────────────────────────────────────────────

function buildSwGlobal() {
  const listeners: Record<string, ((e: unknown) => void)[]> = {};
  const caches = {
    open: vi.fn().mockResolvedValue({ addAll: vi.fn().mockResolvedValue(undefined) }),
    keys: vi.fn().mockResolvedValue([]),
    delete: vi.fn().mockResolvedValue(true),
  };
  const registration = {
    showNotification: vi.fn().mockResolvedValue(undefined),
  };
  const clients = {
    matchAll: vi.fn().mockResolvedValue([]),
    openWindow: vi.fn().mockResolvedValue(null),
    claim: vi.fn().mockResolvedValue(undefined),
  };

  const self_ = {
    addEventListener: (type: string, handler: (e: unknown) => void) => {
      listeners[type] = listeners[type] ?? [];
      listeners[type]!.push(handler);
    },
    skipWaiting: vi.fn().mockResolvedValue(undefined),
    location: { origin: "https://favo.hofmi.org" },
    caches,
    registration,
    clients,
  };

  return { self: self_, listeners, registration, clients };
}

function loadSw(swSelf: unknown) {
  const swPath = resolve(__dirname, "../../../public/sw.js");
  const code = readFileSync(swPath, "utf8");
  // Run the SW script with `self` bound to our synthetic global.
  const fn = new Function("self", "caches", code);
  fn(swSelf, (swSelf as { caches: unknown }).caches);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("customer sw.js — push handler", () => {
  let env: ReturnType<typeof buildSwGlobal>;

  beforeEach(() => {
    env = buildSwGlobal();
    loadSw(env.self);
  });

  it("registers a push event listener", () => {
    expect(env.listeners["push"]).toHaveLength(1);
  });

  it("calls showNotification with payload title and body", async () => {
    const payload = { title: "Order ready!", body: "Your cappuccino is up.", data: { url: "/customer" } };
    const pushEvent = {
      data: { json: () => payload },
      waitUntil: (p: Promise<unknown>) => p,
    };
    await env.listeners["push"]![0]!(pushEvent);
    expect(env.registration.showNotification).toHaveBeenCalledWith(
      "Order ready!",
      expect.objectContaining({ body: "Your cappuccino is up." })
    );
  });

  it("falls back to default notification when data is missing", async () => {
    const pushEvent = { data: null, waitUntil: (p: Promise<unknown>) => p };
    await env.listeners["push"]![0]!(pushEvent);
    expect(env.registration.showNotification).toHaveBeenCalledWith(
      "FAVO",
      expect.objectContaining({ body: "Your order is ready!" })
    );
  });

  it("falls back to default when payload JSON is malformed", async () => {
    const pushEvent = {
      data: { json: () => { throw new Error("bad JSON"); } },
      waitUntil: (p: Promise<unknown>) => p,
    };
    await env.listeners["push"]![0]!(pushEvent);
    expect(env.registration.showNotification).toHaveBeenCalledWith(
      "FAVO",
      expect.objectContaining({ body: "Your order is ready!" })
    );
  });
});

describe("customer sw.js — notificationclick handler", () => {
  let env: ReturnType<typeof buildSwGlobal>;

  beforeEach(() => {
    env = buildSwGlobal();
    loadSw(env.self);
  });

  it("registers a notificationclick event listener", () => {
    expect(env.listeners["notificationclick"]).toHaveLength(1);
  });

  it("closes the notification and opens a window at the payload URL", async () => {
    const close = vi.fn();
    const clickEvent = {
      notification: { close, data: { url: "/customer" } },
      waitUntil: async (p: Promise<unknown>) => p,
    };
    await env.listeners["notificationclick"]![0]!(clickEvent);
    expect(close).toHaveBeenCalledOnce();
    expect(env.clients.openWindow).toHaveBeenCalledWith("/customer");
  });

  it("focuses an already-open window instead of opening a new one", async () => {
    const focus = vi.fn().mockResolvedValue(null);
    env.clients.matchAll.mockResolvedValue([
      { url: "https://favo.hofmi.org/customer", focus },
    ]);
    const close = vi.fn();
    const clickEvent = {
      notification: { close, data: { url: "/customer" } },
      waitUntil: async (p: Promise<unknown>) => p,
    };
    await env.listeners["notificationclick"]![0]!(clickEvent);
    expect(focus).toHaveBeenCalledOnce();
    expect(env.clients.openWindow).not.toHaveBeenCalled();
  });
});
