// QA round 1 UX fixes (UI only): double-tap guard, no stale cart after send,
// customer search UX, confirmations, draft survives reload. Uses the REAL draft store.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => "/pos/queue" }));
vi.mock("next/image", () => ({ default: (p: Record<string, unknown>) => <span data-src={String(p.src ?? "")} /> }));
vi.mock("next/script", () => ({ default: () => null }));

const mockCreateOrder = vi.fn();
const mockSignOut = vi.fn();
const mockSearch = vi.fn();
vi.mock("@/server/actions/orders", () => ({
  createOrder: (...a: unknown[]) => mockCreateOrder(...a),
  transitionOrder: vi.fn(), cancelOrder: vi.fn(), declineFreeCoffee: vi.fn(),
}));
vi.mock("@/server/actions/auth", () => ({ signOut: (...a: unknown[]) => mockSignOut(...a) }));
vi.mock("@/server/actions/favo", () => ({ getFavo: vi.fn().mockResolvedValue({ ok: true, data: { favo: null } }), setFavo: vi.fn(), clearFavo: vi.fn() }));
const mockResolve = vi.fn();
vi.mock("@/server/actions/customers", () => ({
  searchCustomer: (...a: unknown[]) => mockSearch(...a),
  resolveCustomer: (...a: unknown[]) => mockResolve(...a),
}));
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
vi.mock("@/lib/push/staff-subscribe", () => ({ enableStaffPush: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), message: vi.fn() } }));
vi.mock("@/hooks/useOrderStream", () => ({ useOrderStream: () => ({ activeOrders: [], status: "connected" }) }));
vi.mock("@/hooks/useOfflineOutbox", () => ({
  useOfflineOutbox: () => ({ pendingOrders: [], pendingCount: 0, syncing: false, queueOrder: vi.fn(), sync: vi.fn(), syncOne: vi.fn(), refresh: vi.fn() }),
}));

import POSWorkspace from "@/components/pos/POSWorkspace";
import { useDraftOrder } from "@/store/draftOrder";
import { revenueDay } from "@/lib/format";

const OWNER = `s1|${revenueDay()}`;

const AMERICANO = { menuItemId: "ame", menuItemName: "Americano", unitPriceZar: 3000, modifications: [] };
const FREE_RESULT = {
  ok: true as const,
  data: { orderId: "o1", yocoClientSecret: "", totalZar: 0, cardCheckout: false, freeCup: { applied: true, message: "" } },
};

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  useDraftOrder.getState().reset();
  useDraftOrder.setState({ draftOwner: OWNER });
  mockResolve.mockResolvedValue({ ok: true, data: { id: "c1", name: "Naledi Khumalo" } });
  useDraftOrder.getState().addItem(AMERICANO);
  Object.defineProperty(navigator, "onLine", { value: true, configurable: true });
});

const sendButton = () => screen.findByRole("button", { name: /^charge r/i });
const mount = () => render(<POSWorkspace staffName="Sam" staffId="s1" role="barista" />);
// L28 / REQ-046: with no customer attached the barista taps "No notification" before sending.
const tapNoNotification = async () => {
  await act(async () => { fireEvent.click(await screen.findByRole("button", { name: "No notification" })); });
};

describe("Send button", () => {
  it("ignores a double tap: one order, cart kept until the first result", async () => {
    let resolve!: (v: unknown) => void;
    mockCreateOrder.mockReturnValue(new Promise((r) => { resolve = r; }));
    mount();
    await tapNoNotification();
    const btn = await sendButton();
    fireEvent.click(btn);
    fireEvent.click(btn);
    expect(mockCreateOrder).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Americano")).toBeDefined(); // cart still there while pending
    await act(async () => { resolve(FREE_RESULT); });
  });

  it("keeps the cart and customer when the order is refused", async () => {
    mockCreateOrder.mockResolvedValue({ ok: false, code: "X", message: "Free cup already claimed today" });
    useDraftOrder.getState().setCustomer({ id: "c1", name: "Naledi Khumalo" });
    mount();
    await act(async () => { fireEvent.click(await sendButton()); });
    expect(await screen.findByText("Free cup already claimed today")).toBeDefined();
    expect(screen.getByText("Americano")).toBeDefined();
    expect(screen.getAllByText("Naledi Khumalo").length).toBeGreaterThan(0);
  });
});

describe("after the order is sent", () => {
  it("offers New order, not Back to order or a second send, and never restores the sent cart", async () => {
    mockCreateOrder.mockResolvedValue(FREE_RESULT);
    mount();
    await tapNoNotification();
    await act(async () => { fireEvent.click(await sendButton()); });
    expect(screen.queryByText(/back to order/i)).toBeNull();
    expect(screen.queryByText(/send to queue/i)).toBeNull();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /^new order$/i })); });
    expect(screen.getByText("No items yet")).toBeDefined();
    expect(useDraftOrder.getState().items).toHaveLength(0);
  });
});

describe("Clear and sign out", () => {
  it("asks before clearing and keeps the customer attached", async () => {
    useDraftOrder.getState().setCustomer({ id: "c1", name: "Naledi Khumalo" });
    mount();
    fireEvent.click(await screen.findByRole("button", { name: /^clear$/i }));
    expect(useDraftOrder.getState().items).toHaveLength(1); // not cleared yet
    expect(screen.getByText(/clear 1 item\?/i)).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: /keep/i }));
    expect(useDraftOrder.getState().items).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: /^clear$/i }));
    fireEvent.click(screen.getByRole("button", { name: /yes, clear/i }));
    expect(useDraftOrder.getState().items).toHaveLength(0);
    expect(useDraftOrder.getState().customer?.name).toBe("Naledi Khumalo");
  });

  it("warns before signing out with a non-empty cart", async () => {
    mount();
    fireEvent.click(await screen.findByRole("button", { name: /sign out/i }));
    expect(mockSignOut).not.toHaveBeenCalled();
    expect(screen.getByRole("alertdialog")).toBeDefined();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /sign out anyway/i })); });
    expect(mockSignOut).toHaveBeenCalledTimes(1);
    expect(useDraftOrder.getState().items).toHaveLength(0);
  });

  it("signs out straight away when the cart is empty", async () => {
    useDraftOrder.getState().reset();
    mount();
    await act(async () => { fireEvent.click(await screen.findByRole("button", { name: /sign out/i })); });
    expect(mockSignOut).toHaveBeenCalledTimes(1);
  });
});

describe("customer search", () => {
  async function type(value: string) {
    mount();
    const box = await screen.findByPlaceholderText(/search name or phone/i);
    await act(async () => { fireEvent.change(box, { target: { value } }); await new Promise((r) => setTimeout(r, 400)); });
    return box;
  }

  it("shows a No results line when nothing matches", async () => {
    mockSearch.mockResolvedValue({ ok: true, data: [] });
    await type("zzzz");
    expect(await screen.findByText("No results")).toBeDefined();
  });

  it("ArrowDown + Enter selects a result", async () => {
    mockSearch.mockResolvedValue({ ok: true, data: [{ id: "c1", name: "Louis Dlamini", phoneLast4: "4567" }, { id: "c2", name: "Louis Botha", phoneLast4: "1111" }] });
    const box = await type("louis");
    fireEvent.keyDown(box, { key: "ArrowDown" });
    fireEvent.keyDown(box, { key: "ArrowDown" });
    fireEvent.keyDown(box, { key: "Enter" });
    await waitFor(() => expect(useDraftOrder.getState().customer).toEqual({ id: "c2", name: "Louis Botha" }));
  });
});

describe("draft survives navigation", () => {
  it("is written to sessionStorage and restored on mount", async () => {
    const raw = sessionStorage.getItem("favo-pos-draft")!;
    expect(raw).toContain("Americano");
    useDraftOrder.setState({ items: [], totalZar: 0 });
    sessionStorage.setItem("favo-pos-draft", raw); // simulate a reload: storage still holds the cart
    mount();
    expect(await screen.findByText("Americano")).toBeDefined();
  });
});

describe("a sent cart never comes back (review blocker)", () => {
  it("after a successful send the saved draft is empty, and a rehydrate restores nothing", async () => {
    mockCreateOrder.mockResolvedValue({
      ok: true,
      data: { orderId: "o9", yocoClientSecret: "cs_1", totalZar: 3000, cardCheckout: true, freeCup: { applied: false, message: "" } },
    });
    mount();
    await tapNoNotification();
    await act(async () => { fireEvent.click(await sendButton()); });
    expect(useDraftOrder.getState().items).toHaveLength(0);
    expect(sessionStorage.getItem("favo-pos-draft")).not.toContain("Americano");
    // Reload / History trip: state is gone, storage is read back.
    useDraftOrder.setState({ items: [], totalZar: 0 });
    await act(async () => { await useDraftOrder.persist.rehydrate(); });
    expect(useDraftOrder.getState().items).toHaveLength(0);
    // The payment screen still shows what was charged.
    expect(screen.getByText("R 30,00")).toBeDefined();
  });
});

describe("restoring a saved draft", () => {
  function saveDraft(owner: string | null, customer: { id: string; name: string } | null) {
    useDraftOrder.setState({ draftOwner: owner, customer });
    const raw = sessionStorage.getItem("favo-pos-draft")!;
    useDraftOrder.setState({ items: [], totalZar: 0, customer: null, draftOwner: null });
    sessionStorage.setItem("favo-pos-draft", raw);
  }

  it("drops a draft that belongs to another staff member", async () => {
    saveDraft("someone-else|" + revenueDay(), null);
    mount();
    await waitFor(() => expect(useDraftOrder.getState().draftOwner).toBe(OWNER));
    expect(useDraftOrder.getState().items).toHaveLength(0);
  });

  it("drops a draft from another day", async () => {
    saveDraft("s1|2020-01-01", null);
    mount();
    await waitFor(() => expect(useDraftOrder.getState().draftOwner).toBe(OWNER));
    expect(useDraftOrder.getState().items).toHaveLength(0);
  });

  it("keeps the cart but drops a customer who no longer exists", async () => {
    mockResolve.mockResolvedValue({ ok: false, code: "NOT_FOUND", message: "Customer not found." });
    saveDraft(OWNER, { id: "gone", name: "Old Name" });
    mount();
    await waitFor(() => expect(useDraftOrder.getState().customer).toBeNull());
    expect(useDraftOrder.getState().items).toHaveLength(1);
  });

  it("refreshes a customer's name from the server", async () => {
    mockResolve.mockResolvedValue({ ok: true, data: { id: "c1", name: "Naledi K." } });
    saveDraft(OWNER, { id: "c1", name: "Stale" });
    mount();
    await waitFor(() => expect(useDraftOrder.getState().customer?.name).toBe("Naledi K."));
  });
});

describe("search results belong to the current query", () => {
  it("Enter during the debounce does not pick a result from the previous query", async () => {
    mockSearch.mockResolvedValueOnce({ ok: true, data: [{ id: "c1", name: "Louis Dlamini", phoneLast4: "4567" }] });
    mount();
    const box = await screen.findByPlaceholderText(/search name or phone/i);
    await act(async () => { fireEvent.change(box, { target: { value: "louis" } }); await new Promise((r) => setTimeout(r, 400)); });
    expect(await screen.findByText("Louis Dlamini")).toBeDefined();
    fireEvent.change(box, { target: { value: "louisa" } }); // new query, debounce still running
    fireEvent.keyDown(box, { key: "Enter" });
    expect(useDraftOrder.getState().customer).toBeNull();
  });

  it("drops an older response that arrives after a newer one", async () => {
    let first!: (v: unknown) => void;
    mockSearch
      .mockReturnValueOnce(new Promise((r) => { first = r; }))
      .mockResolvedValueOnce({ ok: true, data: [{ id: "c2", name: "Louis Botha", phoneLast4: null }] });
    mount();
    const box = await screen.findByPlaceholderText(/search name or phone/i);
    await act(async () => { fireEvent.change(box, { target: { value: "lou" } }); await new Promise((r) => setTimeout(r, 400)); });
    await act(async () => { fireEvent.change(box, { target: { value: "louis b" } }); await new Promise((r) => setTimeout(r, 400)); });
    expect(await screen.findByText("Louis Botha")).toBeDefined();
    await act(async () => { first({ ok: true, data: [{ id: "c1", name: "Louis Dlamini", phoneLast4: null }] }); });
    expect(screen.queryByText("Louis Dlamini")).toBeNull();
    expect(screen.getByText("Louis Botha")).toBeDefined();
  });
});
