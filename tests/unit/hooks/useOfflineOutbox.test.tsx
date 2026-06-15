// M14 — offline outbox sync logic. The IndexedDB layer is mocked so we can
// assert the sync contract without a real IDB: applied/duplicate are removed,
// 409 conflicts are removed + flagged, 5xx is retained, and reads/writes are
// scoped to the current staff member.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

const store: Record<string, unknown[]> = { rows: [] };
const putOrder = vi.fn(async (o: { clientUuid: string }) => { store.rows.push(o); });
const deleteOrder = vi.fn(async (uuid: string) => {
  store.rows = store.rows.filter((r) => (r as { clientUuid: string }).clientUuid !== uuid);
});
const getAllOrders = vi.fn(async () => store.rows);

vi.mock("@/lib/offline/outbox-db", () => ({
  putOrder: (...a: unknown[]) => putOrder(...(a as [{ clientUuid: string }])),
  deleteOrder: (...a: unknown[]) => deleteOrder(...(a as [string])),
  getAllOrders: () => getAllOrders(),
}));

const toastSuccess = vi.fn();
const toastWarning = vi.fn();
vi.mock("sonner", () => ({ toast: { success: (...a: unknown[]) => toastSuccess(...a), warning: (...a: unknown[]) => toastWarning(...a), error: vi.fn() } }));

import { useOfflineOutbox } from "@/hooks/useOfflineOutbox";

function order(uuid: string, staffId = "s1") {
  return {
    clientUuid: uuid, staffId, items: [], paymentMode: "yoco_deferred" as const,
    clientTotalZar: 3000, clientTimestamp: "2026-06-15T10:00:00Z",
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  store.rows = [];
});

describe("useOfflineOutbox", () => {
  it("removes applied and duplicate orders, retains 5xx (zero loss)", async () => {
    store.rows = [order("a"), order("b"), order("c")];
    global.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ outcome: "applied" }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ outcome: "duplicate" }) })
      .mockResolvedValueOnce({ ok: false, status: 503 }) as unknown as typeof fetch;

    const { result } = renderHook(() => useOfflineOutbox("s1"));
    await act(async () => { await result.current.sync(); });

    // a (applied) + b (duplicate) gone; c (503) retained — no data loss.
    expect(deleteOrder).toHaveBeenCalledWith("a");
    expect(deleteOrder).toHaveBeenCalledWith("b");
    expect(deleteOrder).not.toHaveBeenCalledWith("c");
    await waitFor(() => expect(result.current.pendingCount).toBe(1));
    expect(toastSuccess).toHaveBeenCalled();
  });

  it("removes 409 conflicts from the queue and warns for admin review", async () => {
    store.rows = [order("x")];
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 409 }) as unknown as typeof fetch;

    const { result } = renderHook(() => useOfflineOutbox("s1"));
    await act(async () => { await result.current.sync(); });

    expect(deleteOrder).toHaveBeenCalledWith("x");
    expect(toastWarning).toHaveBeenCalled();
  });

  it("never replays another staff member's queued orders", async () => {
    store.rows = [order("mine", "s1"), order("theirs", "s2")];
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ outcome: "applied" }) });
    global.fetch = fetchMock as unknown as typeof fetch;

    const { result } = renderHook(() => useOfflineOutbox("s1"));
    await act(async () => { await result.current.sync(); });

    // Only the current staff member's one order is posted.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(deleteOrder).toHaveBeenCalledWith("mine");
    expect(deleteOrder).not.toHaveBeenCalledWith("theirs");
  });

  it("queueOrder writes through to the store and bumps the count", async () => {
    const { result } = renderHook(() => useOfflineOutbox("s1"));
    await act(async () => { await result.current.queueOrder(order("new")); });
    expect(putOrder).toHaveBeenCalled();
    expect(result.current.pendingCount).toBe(1);
  });
});
