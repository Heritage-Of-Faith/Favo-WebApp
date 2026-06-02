// Unit tests for useOrderStream hook (M5)
// Uses a fake EventSource to simulate SSE events and disconnects.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

// ─── Fake EventSource ─────────────────────────────────────────────────────────

type ESHandler = ((event: MessageEvent) => void) | null;

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  static lastInstance(): FakeEventSource {
    return FakeEventSource.instances[FakeEventSource.instances.length - 1];
  }

  onopen: (() => void) | null = null;
  onmessage: ESHandler = null;
  onerror: (() => void) | null = null;
  closed = false;

  constructor(public url: string) {
    FakeEventSource.instances.push(this);
  }

  emit(data: unknown) {
    this.onmessage?.({ data: JSON.stringify(data) } as MessageEvent);
  }

  triggerError() {
    this.onerror?.();
  }

  triggerOpen() {
    this.onopen?.();
  }

  close() {
    this.closed = true;
  }
}

vi.stubGlobal("EventSource", FakeEventSource);

import { useOrderStream } from "@/hooks/useOrderStream";

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("useOrderStream", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    FakeEventSource.instances = [];
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("starts in connecting status", () => {
    const { result } = renderHook(() => useOrderStream());
    expect(result.current.status).toBe("connecting");
  });

  it("moves to connected after onopen fires", () => {
    const { result } = renderHook(() => useOrderStream());
    act(() => { FakeEventSource.lastInstance().triggerOpen(); });
    expect(result.current.status).toBe("connected");
  });

  it("adds an order on state_change event", () => {
    const { result } = renderHook(() => useOrderStream());
    act(() => {
      FakeEventSource.lastInstance().triggerOpen();
      FakeEventSource.lastInstance().emit({
        type: "state_change",
        orderId: "ord-1",
        state: "ordered",
        at: "2026-06-01T10:00:00Z",
      });
    });
    expect(result.current.activeOrders).toHaveLength(1);
    expect(result.current.activeOrders[0].orderId).toBe("ord-1");
  });

  it("updates order state on subsequent event for same orderId", () => {
    const { result } = renderHook(() => useOrderStream());
    act(() => {
      FakeEventSource.lastInstance().triggerOpen();
      FakeEventSource.lastInstance().emit({ type: "state_change", orderId: "ord-1", state: "ordered", at: "2026-06-01T10:00:00Z" });
      FakeEventSource.lastInstance().emit({ type: "state_change", orderId: "ord-1", state: "in_progress", at: "2026-06-01T10:01:00Z" });
    });
    expect(result.current.allOrders).toHaveLength(1);
    expect(result.current.activeOrders[0].state).toBe("in_progress");
  });

  it("filters collected orders out of activeOrders", () => {
    const { result } = renderHook(() => useOrderStream());
    act(() => {
      FakeEventSource.lastInstance().triggerOpen();
      FakeEventSource.lastInstance().emit({ type: "state_change", orderId: "ord-1", state: "collected", at: "2026-06-01T10:00:00Z" });
    });
    expect(result.current.activeOrders).toHaveLength(0);
    expect(result.current.allOrders).toHaveLength(1);
  });

  it("ignores heartbeat events", () => {
    const { result } = renderHook(() => useOrderStream());
    act(() => {
      FakeEventSource.lastInstance().triggerOpen();
      FakeEventSource.lastInstance().emit({ type: "heartbeat", at: "2026-06-01T10:00:00Z" });
    });
    expect(result.current.activeOrders).toHaveLength(0);
  });

  it("moves to reconnecting and retries after onerror", () => {
    const { result } = renderHook(() => useOrderStream());
    act(() => {
      FakeEventSource.lastInstance().triggerOpen();
      FakeEventSource.lastInstance().triggerError();
    });
    expect(result.current.status).toBe("reconnecting");

    act(() => { vi.advanceTimersByTime(1_100); });
    // A second EventSource should have been created
    expect(FakeEventSource.instances).toHaveLength(2);
  });

  it("closes EventSource on unmount", () => {
    const { unmount } = renderHook(() => useOrderStream());
    const es = FakeEventSource.lastInstance();
    unmount();
    expect(es.closed).toBe(true);
  });
});
