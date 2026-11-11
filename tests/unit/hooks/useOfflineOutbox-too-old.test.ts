// REQ-039 / §6.0.5 REPLAY_TOO_OLD: "Not shown to the barista; surfaced on the
// admin exception list". A 409 with reason 'replay_too_old' leaves the outbox
// with no toast; every other rejection keeps its "flagged for admin review" toast.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

const store = new Map<string, Record<string, unknown>>();
vi.mock("@/lib/offline/outbox-db", () => ({
  putOrder: vi.fn(async (o: Record<string, unknown>) => { store.set(o.clientUuid as string, o); }),
  getAllOrders: vi.fn(async () => [...store.values()]),
  deleteOrder: vi.fn(async (id: string) => { store.delete(id); }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn() } }));

import { toast } from "sonner";
import { useOfflineOutbox } from "@/hooks/useOfflineOutbox";

const ORDER = {
  clientUuid: "44444444-4444-4444-4444-444444444444", staffId: "staff-1",
  items: [{ menuItemId: "mi-capp", quantity: 1, modifications: [] }],
  paymentMode: "yoco_deferred", clientTotalZar: 2000, clientTimestamp: "2026-10-11T06:59:59.000Z",
};

function reply409(reason: string) {
  vi.stubGlobal("fetch", vi.fn(async () =>
    new Response(JSON.stringify({ ok: false, outcome: "rejected", reason }), { status: 409 })));
}

beforeEach(() => { store.clear(); store.set(ORDER.clientUuid, ORDER); vi.clearAllMocks(); });
afterEach(() => vi.unstubAllGlobals());

describe("useOfflineOutbox — REPLAY_TOO_OLD is not shown to the barista", () => {
  it.each(["sync", "syncOne"] as const)("%s: replay_too_old → removed from the outbox, no toast at all", async (fn) => {
    reply409("replay_too_old");
    const { result } = renderHook(() => useOfflineOutbox("staff-1"));
    await act(async () => {
      if (fn === "sync") await result.current.sync();
      else await result.current.syncOne(ORDER.clientUuid);
    });
    expect(store.size).toBe(0);
    expect(toast.warning).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("any other rejection (amount_mismatch) keeps its 'flagged for admin review' toast", async () => {
    reply409("amount_mismatch");
    const { result } = renderHook(() => useOfflineOutbox("staff-1"));
    await act(async () => { await result.current.sync(); });
    expect(store.size).toBe(0);
    expect(toast.warning).toHaveBeenCalledWith("1 order flagged for admin review");
  });
});
