// Queue-card payment gate: an unpaid order shows "Take payment" and cannot start
// making; a paid order shows "Start Making". (Rule L01.)

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("next/image", () => ({ default: (p: Record<string, unknown>) => <span data-src={String(p.src ?? "")} /> }));
vi.mock("next/script", () => ({ default: () => null }));
vi.mock("@/server/actions/orders", () => ({ createOrder: vi.fn(), transitionOrder: vi.fn(), cancelOrder: vi.fn() }));
// AT-201 part 2b: the Take-payment dialog runs the card tender through server
// actions. They never settle here, so the dialog stays on its first step.
vi.mock("@/server/actions/tender", () => ({
  beginTender: vi.fn(() => new Promise(() => {})),
  sendToTerminal: vi.fn(() => new Promise(() => {})),
  pollTenderResult: vi.fn(() => new Promise(() => {})),
}));
vi.mock("@/server/actions/auth", () => ({ signOut: vi.fn() }));
vi.mock("@/server/actions/favo", () => ({ getFavo: vi.fn().mockResolvedValue({ ok: true, data: { favo: null } }), setFavo: vi.fn(), clearFavo: vi.fn() }));
vi.mock("@/server/actions/customers", () => ({ searchCustomer: vi.fn() }));
vi.mock("@/server/actions/menu", () => ({ getMenu: vi.fn().mockResolvedValue({ ok: true, data: [] }) }));
vi.mock("@/server/actions/inventory", () => ({
  listInventory: vi.fn().mockResolvedValue({ ok: true, data: { items: [] } }),
  listLots: vi.fn().mockResolvedValue({ ok: true, data: { lots: [] } }),
  listInventoryStatus: vi.fn().mockResolvedValue({ ok: true, data: { statusMap: {} } }),
  getActiveBeanLot: vi.fn().mockResolvedValue({ ok: true, data: { lot: null } }),
}));
vi.mock("@/server/actions/recipes", () => ({ listRecipes: vi.fn().mockResolvedValue({ ok: true, data: { recipes: [] } }) }));
vi.mock("@/server/actions/waste", () => ({ logWaste: vi.fn() }));
vi.mock("@/lib/push/staff-subscribe", () => ({ enableStaffPush: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), message: vi.fn() } }));
vi.mock("@/hooks/useOfflineOutbox", () => ({
  useOfflineOutbox: () => ({ pendingOrders: [], pendingCount: 0, syncing: false, queueOrder: vi.fn(), sync: vi.fn(), syncOne: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("@/hooks/useOrderStream", () => ({
  useOrderStream: () => ({ activeOrders: [{ orderId: "ord_1", state: "ordered", lastUpdatedAt: "2026-06-17T08:00:00Z" }], status: "connected" }),
}));
vi.mock("@/store/draftOrder", () => ({
  lineKey: (x: { menuItemId: string }) => x.menuItemId,
  useDraftOrder: () => ({ customer: null, items: [], totalZar: 0, setCustomer: vi.fn(), addItem: vi.fn(), removeItem: vi.fn(), updateQuantity: vi.fn(), reset: vi.fn() }),
}));

import POSWorkspace from "@/components/pos/POSWorkspace";

function fullOrder(paymentStatus: string) {
  return {
    order: {
      id: "ord_1", customerId: null, customerName: null, staffId: "s1",
      state: "ordered", placedAt: "2026-06-17T08:00:00Z", completedAt: null,
      totalZar: 4500, isStaffDiscount: false, paymentStatus,
      items: [{ id: "oi1", menuItemId: "cap", menuItemName: "Cappuccino", quantity: 1, unitPriceZar: 4500, modifications: [] }],
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(navigator, "onLine", { value: true, configurable: true });
});

// L01 gate is only active when Yoco is configured. REQ-071: the page tells the
// workspace via a server-computed boolean prop — never a client-side Yoco key.
async function expandCard(yocoConfigured = true) {
  render(<POSWorkspace staffName="Sam" staffId="s1" role="barista" yocoConfigured={yocoConfigured} />);
  const card = await screen.findByText("#ORD_1");
  await act(async () => { fireEvent.click(card); });
}

describe("queue payment gate (L01)", () => {
  it("without Yoco configured, order can start without Take payment", async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => fullOrder("pending") }) as unknown as typeof fetch;
    await expandCard(false);
    expect(await screen.findByRole("button", { name: /start making/i })).toBeDefined();
    expect(screen.queryByRole("button", { name: /take payment/i })).toBeNull();
  });

  it("unpaid order shows Take payment and hides Start Making", async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => fullOrder("pending") }) as unknown as typeof fetch;
    await expandCard();
    expect(await screen.findByRole("button", { name: /take payment/i })).toBeDefined();
    expect(screen.queryByRole("button", { name: /start making/i })).toBeNull();
    expect(screen.getByText(/^pending$/i)).toBeDefined();
  });

  it("paid order shows Start Making and no Take payment", async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => fullOrder("successful") }) as unknown as typeof fetch;
    await expandCard();
    expect(await screen.findByRole("button", { name: /start making/i })).toBeDefined();
    expect(screen.queryByRole("button", { name: /take payment/i })).toBeNull();
    expect(screen.getByText(/paid/i)).toBeDefined();
  });

  it("free-cup Decline hides on the queue card while its Take-payment dialog is open", async () => {
    const o = fullOrder("pending");
    const withCup = { order: { ...o.order, isStaffDiscount: true, items: o.order.items.map(i => ({ ...i, discountZar: 0 })) } };
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => withCup }) as unknown as typeof fetch;
    await expandCard();
    expect(await screen.findByRole("button", { name: "Decline" })).toBeDefined();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /take payment/i })); });
    expect(screen.getByRole("dialog", { name: /take payment/i })).toBeDefined();
    expect(screen.queryByRole("button", { name: "Decline" })).toBeNull();
  });

  it("REQ-008 / S4: a SENT attempt that ended unresolved does not hold the drink back — Start Making shows", async () => {
    const o = fullOrder("unresolved");
    const sent = { order: { ...o.order, paymentAwaitingLookup: true } };
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => sent }) as unknown as typeof fetch;
    await expandCard();
    expect(await screen.findByRole("button", { name: /start making/i })).toBeDefined();
    expect(screen.queryByRole("button", { name: /take payment/i })).toBeNull();
  });

  it("a closed-out NEVER-sent attempt (unresolved, nothing sent) is still owed — Take payment shows (re-tenderable)", async () => {
    const o = fullOrder("unresolved");
    const neverSent = { order: { ...o.order, paymentAwaitingLookup: false } };
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => neverSent }) as unknown as typeof fetch;
    await expandCard();
    expect(await screen.findByRole("button", { name: /take payment/i })).toBeDefined();
    expect(screen.queryByRole("button", { name: /start making/i })).toBeNull();
  });

  it("REQ-004 / S3: a declined order stays chargeable — Take payment shows", async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => fullOrder("declined") }) as unknown as typeof fetch;
    await expandCard();
    expect(await screen.findByRole("button", { name: /take payment/i })).toBeDefined();
  });
});
