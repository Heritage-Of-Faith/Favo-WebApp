// Shared LISTEN broker unit tests — cost fix (2026-07-15).
// Verifies the lazy-connect / fan-out / close-when-empty lifecycle without a
// real Postgres connection.

import { describe, it, expect, vi, beforeEach } from "vitest";

const pgState = {
  instances: [] as { listenCalls: [string, (payload: string) => void][]; ended: boolean }[],
};

vi.mock("postgres", () => ({
  default: vi.fn().mockImplementation(() => {
    const instance = { listenCalls: [] as [string, (payload: string) => void][], ended: false };
    pgState.instances.push(instance);
    return {
      listen: vi.fn().mockImplementation((channel: string, cb: (payload: string) => void) => {
        instance.listenCalls.push([channel, cb]);
        return Promise.resolve();
      }),
      end: vi.fn().mockImplementation(() => {
        instance.ended = true;
        return Promise.resolve();
      }),
    };
  }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  pgState.instances = [];
  process.env.DATABASE_URL_SESSION = "postgres://test-session-url";
});

describe("queue broker: lazy connect + fan-out + close-when-empty", () => {
  it("does not open a connection until the first subscriber", async () => {
    const { orderChangesBroker } = await import("@/server/queue/broker");
    expect(pgState.instances.length).toBe(0);

    const unsubscribe = orderChangesBroker.subscribe(() => {});
    expect(pgState.instances.length).toBe(1);
    unsubscribe();
  });

  it("fans a single NOTIFY out to every current subscriber", async () => {
    vi.resetModules();
    const { orderChangesBroker } = await import("@/server/queue/broker");

    const received: string[] = [];
    const unsub1 = orderChangesBroker.subscribe((_c, payload) => received.push(`a:${payload}`));
    const unsub2 = orderChangesBroker.subscribe((_c, payload) => received.push(`b:${payload}`));

    // Only one underlying connection for both subscribers.
    expect(pgState.instances.length).toBe(1);

    const [, listenCb] = pgState.instances[0].listenCalls[0];
    listenCb("hello");

    expect(received.sort()).toEqual(["a:hello", "b:hello"]);
    unsub1();
    unsub2();
  });

  it("closes the connection when the last subscriber unsubscribes, and reopens fresh next time", async () => {
    vi.resetModules();
    const { orderChangesBroker } = await import("@/server/queue/broker");

    const unsub1 = orderChangesBroker.subscribe(() => {});
    const unsub2 = orderChangesBroker.subscribe(() => {});
    unsub1();
    expect(pgState.instances[0].ended).toBe(false); // still one subscriber left

    unsub2();
    expect(pgState.instances[0].ended).toBe(true); // last one — connection closed

    orderChangesBroker.subscribe(() => {});
    expect(pgState.instances.length).toBe(2); // fresh connection, not reused
  });

  it("without DATABASE_URL_SESSION configured, subscribe/unsubscribe is a safe no-op", async () => {
    delete process.env.DATABASE_URL_SESSION;
    vi.resetModules();
    const { orderChangesBroker } = await import("@/server/queue/broker");

    const unsubscribe = orderChangesBroker.subscribe(() => {});
    expect(pgState.instances.length).toBe(0);
    expect(() => unsubscribe()).not.toThrow();
  });
});
