// M14/M15 — offline outbox sync logic + queued-list surface. The IndexedDB
// layer is mocked so we can assert the contract without a real IDB.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

let rows: { clientUuid: string; staffId: string; clientTimestamp: string; items: unknown[]; paymentMode: string; clientTotalZar: number }[] = [];
const putOrder = vi.fn(async (o: typeof rows[number]) => { rows.push(o); });
const deleteOrder = vi.fn(async (uuid: string) => { rows = rows.filter((r) => r.clientUuid !== uuid); });
const getAllOrders = vi.fn(async () => rows);

vi.mock("@/lib/offline/outbox-db", () => ({
  putOrder: (...a: unknown[]) => putOrder(...(a as [typeof rows[number]])),
  deleteOrder: (...a: unknown[]) => deleteOrder(...(a as [string])),
  getAllOrders: () => getAllOrders(),
}));

const toastSuccess = vi.fn();
const toastWarning = vi.fn();
const toastError = vi.fn();
vi.mock("sonner", () => ({ toast: { success: (...a: unknown[]) => toastSuccess(...a), warning: (...a: unknown[]) => toastWarning(...a), error: (...a: unknown[]) => toastError(...a) } }));

import { useOfflineOutbox } from "@/hooks/useOfflineOutbox";

function order(uuid: string, staffId = "s1", ts = "2026-06-15T10:00:00Z") {
  return { clientUuid: uuid, staffId, items: [], paymentMode: "yoco_deferred" as const, clientTotalZar: 3000, clientTimestamp: ts };
}

beforeEach(() => { vi.clearAllMocks(); rows = []; });

describe("useOfflineOutbox", () => {
  it("exposes this staff member's queued orders, oldest first", async () => {
    rows = [order("late", "s1", "2026-06-15T12:00:00Z"), order("early", "s1", "2026-06-15T08:00:00Z"), order("theirs", "s2")];
    const { result } = renderHook(() => useOfflineOutbox("s1"));
    await waitFor(() => expect(result.current.pendingCount).toBe(2));
    expect(result.current.pendingOrders.map((o) => o.clientUuid)).toEqual(["early", "late"]);
  });

  it("sync removes applied/duplicate, retains 5xx (zero loss), flags 409", async () => {
    rows = [order("a"), order("b"), order("c"), order("d")];
    global.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ outcome: "applied" }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ outcome: "duplicate" }) })
      .mockResolvedValueOnce({ ok: false, status: 503 })
      .mockResolvedValueOnce({ ok: false, status: 409 }) as unknown as typeof fetch;

    const { result } = renderHook(() => useOfflineOutbox("s1"));
    await act(async () => { await result.current.sync(); });

    expect(deleteOrder).toHaveBeenCalledWith("a");
    expect(deleteOrder).toHaveBeenCalledWith("b");
    expect(deleteOrder).not.toHaveBeenCalledWith("c"); // 503 retained
    expect(deleteOrder).toHaveBeenCalledWith("d");      // 409 flagged + removed
    await waitFor(() => expect(result.current.pendingCount).toBe(1));
    expect(toastSuccess).toHaveBeenCalled();
    expect(toastWarning).toHaveBeenCalled();
  });

  it("syncOne replays just one queued order", async () => {
    rows = [order("a"), order("b")];
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ outcome: "applied" }) });
    global.fetch = fetchMock as unknown as typeof fetch;

    const { result } = renderHook(() => useOfflineOutbox("s1"));
    await waitFor(() => expect(result.current.pendingCount).toBe(2));
    await act(async () => { await result.current.syncOne("a"); });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(deleteOrder).toHaveBeenCalledWith("a");
    await waitFor(() => expect(result.current.pendingCount).toBe(1));
  });

  it("never replays another staff member's queued orders", async () => {
    rows = [order("mine", "s1"), order("theirs", "s2")];
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ outcome: "applied" }) });
    global.fetch = fetchMock as unknown as typeof fetch;

    const { result } = renderHook(() => useOfflineOutbox("s1"));
    await act(async () => { await result.current.sync(); });

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
