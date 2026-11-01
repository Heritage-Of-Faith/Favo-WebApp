// AT-204 Wave 2 — the voucher chip on the POS order line (§6.9.3, §6.2.4c,
// L48, REQ-146, REQ-147). Assertions are on the RENDERED TREE (§15.1 L48 row):
// the chip is absent — not hidden, not disabled — when vouchers do not apply.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act, within } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("next/image", () => ({ default: (p: Record<string, unknown>) => <span data-src={String(p.src ?? "")} /> }));
vi.mock("next/script", () => ({ default: () => null }));

const mockCreateOrder = vi.fn();
vi.mock("@/server/actions/orders", () => ({
  createOrder: (...a: unknown[]) => mockCreateOrder(...a),
  declineFreeCoffee: vi.fn(), transitionOrder: vi.fn(), cancelOrder: vi.fn(),
}));
// AT-201 part 2b: the card tender's server actions never settle here.
vi.mock("@/server/actions/tender", () => ({
  beginTender: vi.fn(() => new Promise(() => {})),
  sendToTerminal: vi.fn(() => new Promise(() => {})),
  pollTenderResult: vi.fn(() => new Promise(() => {})),
}));
const mockVoucherCtx = vi.fn();
vi.mock("@/server/actions/vouchers", () => ({ getVoucherContext: () => mockVoucherCtx() }));
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
const mockStream = vi.fn(() => ({ activeOrders: [] as unknown[], status: "connected" }));
vi.mock("@/hooks/useOrderStream", () => ({ useOrderStream: () => mockStream() }));
vi.mock("@/hooks/useOfflineOutbox", () => ({
  useOfflineOutbox: () => ({ pendingOrders: [], pendingCount: 0, syncing: false, queueOrder: vi.fn(), sync: vi.fn(), syncOne: vi.fn(), refresh: vi.fn() }),
}));

import POSWorkspace from "@/components/pos/POSWorkspace";
import { useDraftOrder } from "@/store/draftOrder";
import { revenueDay } from "@/lib/format";

// The saved draft belongs to this staff member today (main's draft restore,
// #279) — otherwise POSWorkspace drops the seeded lines on mount.
const OWNER = `staff_thandeka|${revenueDay()}`;

// §6.2.4c's drawing: R20 cappuccino, R20 hot chocolate.
const CAPP = { menuItemId: "mi_capp", menuItemName: "Cappuccino", unitPriceZar: 2000, modifications: [] };
const HOT = { menuItemId: "mi_hot", menuItemName: "Hot Chocolate", unitPriceZar: 2000, modifications: [] };

const LIVE = { ok: true, data: { available: true, kind: "untracked_hot_drink", kinds: ["untracked_hot_drink"] } };
const OFF = { ok: true, data: { available: false, kind: null, kinds: [] } };

function seed(items: Array<typeof CAPP & { quantity: number; voucherCount?: number }>) {
  useDraftOrder.getState().reset();
  useDraftOrder.setState({ draftOwner: OWNER });
  for (const i of items) {
    const { voucherCount, ...rest } = i;
    useDraftOrder.getState().addItem(rest);
    if (voucherCount) useDraftOrder.getState().setVoucherCount(`${i.menuItemId}:`, voucherCount);
  }
}

async function mount() {
  render(<POSWorkspace staffName="Thandeka" staffId="staff_thandeka" role="barista" />);
  await act(async () => { await Promise.resolve(); });
}

beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(navigator, "onLine", { value: true, configurable: true });
  mockStream.mockReturnValue({ activeOrders: [], status: "connected" });
});

describe("L48 / REQ-146 — the chip is absent when vouchers cannot apply", () => {
  it("no voucher kind in force (weekday, no session, or empty kinds): no chip in the tree", async () => {
    mockVoucherCtx.mockResolvedValue(OFF);
    seed([{ ...CAPP, quantity: 1 }]);
    await mount();
    expect(screen.getByText("Cappuccino")).toBeDefined();
    expect(screen.queryByRole("button", { name: /voucher/i })).toBeNull();
    expect(screen.queryByText(/voucher/i)).toBeNull();
  });

  it("the read fails: no chip (never a chip that can only refuse)", async () => {
    mockVoucherCtx.mockRejectedValue(new Error("offline"));
    seed([{ ...CAPP, quantity: 1 }]);
    await mount();
    expect(screen.queryByRole("button", { name: /voucher/i })).toBeNull();
  });

  it("a voucher kind in force: the chip renders on every line", async () => {
    mockVoucherCtx.mockResolvedValue(LIVE);
    seed([{ ...CAPP, quantity: 1 }, { ...HOT, quantity: 1 }]);
    await mount();
    expect(await screen.findAllByRole("button", { name: /voucher/i })).toHaveLength(2);
    expect(screen.getAllByText("voucher")).toHaveLength(2);
  });

  it("a session change re-reads the context (opening prompt → chip appears)", async () => {
    mockVoucherCtx.mockResolvedValueOnce(OFF).mockResolvedValue(LIVE);
    seed([{ ...CAPP, quantity: 1 }]);
    await mount();
    expect(screen.queryByRole("button", { name: /voucher/i })).toBeNull();
    await act(async () => { window.dispatchEvent(new Event("favo:session-changed")); });
    expect(await screen.findByRole("button", { name: /voucher/i })).toBeDefined();
  });
});

describe("§6.9.3 — one tap, no confirm; REQ-147 m of n", () => {
  it("one tap on a quantity-1 line strikes it to R0 with 1 of 1; a second tap removes it", async () => {
    mockVoucherCtx.mockResolvedValue(LIVE);
    seed([{ ...HOT, quantity: 1 }]);
    await mount();
    const chip = await screen.findByRole("button", { name: /voucher/i });
    expect(chip.getAttribute("aria-pressed")).toBe("false");
    await act(async () => { fireEvent.click(chip); });
    expect(useDraftOrder.getState().items[0].voucherCount).toBe(1);
    expect(screen.getByText("1 of 1")).toBeDefined();
    expect(screen.getByRole("button", { name: /voucher/i }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.queryByRole("dialog")).toBeNull(); // no confirmation step
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /voucher/i })); });
    expect(useDraftOrder.getState().items[0].voucherCount).toBe(0);
    expect(screen.queryByText("1 of 1")).toBeNull();
  });

  it("a partly vouchered line reads 2 of 3 and its remaining price R20.00, struck from R60.00", async () => {
    mockVoucherCtx.mockResolvedValue(LIVE);
    seed([{ ...CAPP, quantity: 3, voucherCount: 2 }]);
    await mount();
    const line = (await screen.findByText("2 of 3")).closest("[data-line]") as HTMLElement;
    expect(line).not.toBeNull();
    expect(within(line).getByText(/R\s?20[.,]00/)).toBeDefined();
    const struck = within(line).getByText(/R\s?60[.,]00/);
    expect(struck.tagName).toBe("S");
  });
});

describe("Place — the createOrder call and the button", () => {
  it("T10 mixed order: the button charges the paid portion and createOrder gets voucherCount + voucherKind", async () => {
    mockVoucherCtx.mockResolvedValue(LIVE);
    seed([{ ...CAPP, quantity: 1 }, { ...HOT, quantity: 1, voucherCount: 1 }]);
    mockCreateOrder.mockResolvedValue({
      ok: true, data: { orderId: "ord_t10", tender: null, totalZar: 2000, freeCup: { applied: false, code: null, message: null, discountZar: 0 } },
    });
    await mount();
    const place = await screen.findByRole("button", { name: /^charge r\s?20[.,]00$/i });
    // L28 / REQ-046: no customer attached, so the barista taps "No notification".
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "No notification" })); });
    await act(async () => { fireEvent.click(place); });
    expect(mockCreateOrder).toHaveBeenCalledWith({
      customerId: undefined,
      notificationTarget: "none",
      items: [
        { menuItemId: "mi_capp", quantity: 1, modifications: [] },
        { menuItemId: "mi_hot", quantity: 1, modifications: [], voucherCount: 1 },
      ],
      voucherKind: "untracked_hot_drink",
    });
  });

  it("T9 an order that nets R0 reads 'Send to queue', not a charge", async () => {
    mockVoucherCtx.mockResolvedValue(LIVE);
    seed([{ ...HOT, quantity: 2, voucherCount: 2 }, { ...CAPP, quantity: 3, voucherCount: 3 }]);
    await mount();
    expect(await screen.findByRole("button", { name: "Send to queue" })).toBeDefined();
    expect(screen.queryByRole("button", { name: /^charge r/i })).toBeNull();
  });

  it("with no vouchers the call shape is unchanged (no voucherCount, no voucherKind)", async () => {
    mockVoucherCtx.mockResolvedValue(LIVE);
    seed([{ ...CAPP, quantity: 1 }]);
    mockCreateOrder.mockResolvedValue({ ok: false, code: "X", message: "stop" });
    await mount();
    // L28 / REQ-046: no customer attached, so the barista taps "No notification".
    await act(async () => { fireEvent.click(await screen.findByRole("button", { name: "No notification" })); });
    await act(async () => { fireEvent.click(await screen.findByRole("button", { name: /^charge r/i })); });
    expect(mockCreateOrder).toHaveBeenCalledWith({
      customerId: undefined, notificationTarget: "none", items: [{ menuItemId: "mi_capp", quantity: 1, modifications: [] }],
    });
  });
});

describe("the queue's order panel shows 'Voucher' on vouchered units", () => {
  it("a placed line carrying vouchers reads Voucher, not Free cup", async () => {
    mockVoucherCtx.mockResolvedValue(OFF);
    seed([]);
    mockStream.mockReturnValue({
      activeOrders: [{ orderId: "ord_v", state: "ordered", lastUpdatedAt: "2026-07-12T17:10:00Z", customerName: null }],
      status: "connected",
    });
    const order = {
      id: "ord_v", customerId: null, customerName: null, staffId: "staff_thandeka", state: "ordered",
      placedAt: "2026-07-12T17:10:00Z", completedAt: null, totalZar: 2000, isStaffDiscount: false,
      paymentStatus: null, cardCheckout: false,
      items: [{ id: "oi_1", menuItemId: "mi_capp", menuItemName: "Cappuccino", quantity: 2, unitPriceZar: 2000, discountZar: 2000, voucherCount: 1, modifications: [] }],
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ order }) }));
    await mount();
    await act(async () => { fireEvent.click(screen.getByText("Walk-in")); });
    expect(await screen.findByText(/Voucher · 1 of 2/)).toBeDefined();
    expect(screen.queryByText(/Free cup/)).toBeNull();
    vi.unstubAllGlobals();
  });
});
