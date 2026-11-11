// REQ-061 / PRD §9.5.1, L36 — the till's Hand over control and the 5-minute
// idle lock both return to the PIN screen WITH ALL WORK PRESERVED.
// REQ-053 / L37 — a repeat tap flashes the matching line; the quantity stays.
// Uses the REAL draft store.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";

const mockPush = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mockPush }), usePathname: () => "/pos/queue" }));
vi.mock("next/image", () => ({ default: (p: Record<string, unknown>) => <span data-src={String(p.src ?? "")} /> }));
vi.mock("next/script", () => ({ default: () => null }));
vi.mock("@/server/actions/orders", () => ({ createOrder: vi.fn(), transitionOrder: vi.fn(), cancelOrder: vi.fn(), declineFreeCoffee: vi.fn() }));
vi.mock("@/server/actions/tender", () => ({ beginTender: vi.fn(), sendToTerminal: vi.fn(), pollTenderResult: vi.fn() }));
const mockSignOut = vi.fn();
vi.mock("@/server/actions/auth", () => ({ signOut: (...a: unknown[]) => mockSignOut(...a) }));
const mockEnd = vi.fn();
vi.mock("@/server/actions/hand-over", () => ({ endTillSession: (...a: unknown[]) => mockEnd(...a) }));
vi.mock("@/server/actions/favo", () => ({ getFavo: vi.fn().mockResolvedValue({ ok: true, data: { favo: null } }), setFavo: vi.fn(), clearFavo: vi.fn() }));
vi.mock("@/server/actions/customers", () => ({ searchCustomer: vi.fn(), resolveCustomer: vi.fn().mockResolvedValue({ ok: true, data: { id: "c1", name: "Naledi" } }) }));
vi.mock("@/server/actions/menu", () => ({ getMenu: vi.fn().mockResolvedValue({ ok: true, data: [] }) }));
vi.mock("@/server/actions/inventory", () => ({
  listInventory: vi.fn().mockResolvedValue({ ok: true, data: { items: [] } }),
  listLots: vi.fn().mockResolvedValue({ ok: true, data: { lots: [] } }),
  listInventoryStatus: vi.fn().mockResolvedValue({ ok: true, data: { statusMap: {} } }),
  getActiveBeanLot: vi.fn().mockResolvedValue({ ok: true, data: { lot: null } }),
}));
vi.mock("@/server/actions/containers", () => ({ listOpenContainers: vi.fn().mockResolvedValue({ ok: true, data: { containers: [] } }), openContainer: vi.fn(), closeContainer: vi.fn() }));
vi.mock("@/server/actions/recipes", () => ({ listRecipes: vi.fn().mockResolvedValue({ ok: true, data: { recipes: [] } }) }));
vi.mock("@/server/actions/waste", () => ({ logWaste: vi.fn() }));
vi.mock("@/server/actions/vouchers", () => ({ getVoucherContext: vi.fn().mockResolvedValue({ ok: false }) }));
vi.mock("@/lib/push/staff-subscribe", () => ({ enableStaffPush: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), message: vi.fn() } }));
vi.mock("@/hooks/useOrderStream", () => ({ useOrderStream: () => ({ activeOrders: [], status: "connected" }) }));
vi.mock("@/hooks/useOfflineOutbox", () => ({
  useOfflineOutbox: () => ({ pendingOrders: [], pendingCount: 0, syncing: false, queueOrder: vi.fn(), sync: vi.fn(), syncOne: vi.fn(), refresh: vi.fn() }),
}));

import POSWorkspace from "@/components/pos/POSWorkspace";
import { useDraftOrder, lineKey } from "@/store/draftOrder";
import { revenueDay } from "@/lib/format";

const AMERICANO = { menuItemId: "ame", menuItemName: "Americano", unitPriceZar: 3000, modifications: [] };
const mount = (staffId = "s1") => render(<POSWorkspace staffName="Sam" staffId={staffId} role="barista" />);

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  useDraftOrder.getState().reset();
  useDraftOrder.setState({ draftOwner: `s1|${revenueDay()}` });
  useDraftOrder.getState().addItem(AMERICANO);
  mockEnd.mockResolvedValue({ ok: true, data: undefined });
});
afterEach(() => vi.useRealTimers());

describe("Hand over (REQ-061)", () => {
  it("is visible on the till and needs one tap: the session ends, the PIN screen follows", async () => {
    mount();
    await act(async () => { fireEvent.click(await screen.findByRole("button", { name: /hand over/i })); });
    expect(mockEnd).toHaveBeenCalledWith("hand_over");
    expect(mockPush).toHaveBeenCalledWith("/pos");
    expect(mockSignOut).not.toHaveBeenCalled();
  });

  it("keeps the order in progress — and the next barista to sign in today gets it", async () => {
    useDraftOrder.getState().setCustomer({ id: "c1", name: "Naledi" });
    const view = mount();
    await act(async () => { fireEvent.click(await screen.findByRole("button", { name: /hand over/i })); });
    expect(useDraftOrder.getState().items).toHaveLength(1);
    const saved = sessionStorage.getItem("favo-pos-draft")!;
    expect(saved).toContain("Americano");
    view.unmount();

    // A reload as Thandeka (s2): the kept draft is restored, now hers.
    useDraftOrder.setState({ items: [], totalZar: 0, customer: null, draftOwner: null });
    sessionStorage.setItem("favo-pos-draft", saved);
    mount("s2");
    expect(await screen.findByText("Americano")).toBeDefined();
    await waitFor(() => expect(useDraftOrder.getState().draftOwner).toBe(`s2|${revenueDay()}`));
    expect(useDraftOrder.getState().customer?.id).toBe("c1");
  });

  it("if the server refuses, the barista stays signed in on the till", async () => {
    mockEnd.mockResolvedValue({ ok: false, code: "INTERNAL", message: "x" });
    mount();
    await act(async () => { fireEvent.click(await screen.findByRole("button", { name: /hand over/i })); });
    expect(mockPush).not.toHaveBeenCalled();
  });
});

describe("5-minute idle lock (REQ-061, L36)", () => {
  it("after 5 minutes idle the till asks to lock; outside a window it returns to the PIN screen, draft kept", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    mount();
    await act(async () => { await vi.advanceTimersByTimeAsync(4 * 60_000 + 59_000); });
    expect(mockEnd).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    expect(mockEnd).toHaveBeenCalledWith("idle_lock");
    expect(mockPush).toHaveBeenCalledWith("/pos");
    expect(useDraftOrder.getState().items).toHaveLength(1);
  });

  it("a touch restarts the five minutes", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    mount();
    await act(async () => { await vi.advanceTimersByTimeAsync(4 * 60_000); });
    fireEvent.pointerDown(window);
    await act(async () => { await vi.advanceTimersByTimeAsync(4 * 60_000); });
    expect(mockEnd).not.toHaveBeenCalled();
  });

  it("inside an opening window the server refuses: the till stays exactly where it was", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    mockEnd.mockResolvedValue({ ok: false, code: "IN_OPENING_WINDOW", message: "" });
    mount();
    await act(async () => { await vi.advanceTimersByTimeAsync(5 * 60_000); });
    expect(mockEnd).toHaveBeenCalledWith("idle_lock");
    expect(mockPush).not.toHaveBeenCalled();
    expect(screen.getByText("Americano")).toBeDefined();
  });
});

describe("repeat tap (REQ-053, L37)", () => {
  it("flashes the matching line and its stepper; the quantity stays 1", async () => {
    const { container } = mount();
    await screen.findByText("Americano");
    expect(container.querySelector("[data-flash]")).toBeNull();
    act(() => { useDraftOrder.getState().addItem(AMERICANO); });
    expect(useDraftOrder.getState().items[0].quantity).toBe(1);
    expect(useDraftOrder.getState().flashKey).toBe(lineKey(AMERICANO));
    await waitFor(() => expect(container.querySelector("[data-flash] [data-stepper]")).not.toBeNull());
  });
});
