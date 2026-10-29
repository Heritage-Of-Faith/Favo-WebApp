// AT-202 part 1 — the §6.2.3c shot picker on the POS. Asserted on the
// rendered tree (PRD §15 "L48 · nothing inert on screen"):
//   - weekday renders TWO segments, not four greyed ones (REQ-138);
//   - Sunday renders T15 = 4 segments; default 1;
//   - a drink with no coffee renders no picker (L48);
//   - segments are 44 px targets with 8 px between them, under one label;
//   - the draft line shows the shot count and the surcharge-inclusive price,
//     and two lines at different shots do not merge (L37).
// Literal values: a R20.00 cappuccino at 3 shots on a Sunday is R30.00.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act, within } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("next/image", () => ({ default: (p: Record<string, unknown>) => <span data-src={String(p.src ?? "")} /> }));
const mockCreateOrder = vi.fn();
vi.mock("@/server/actions/orders", () => ({
  createOrder: (...a: unknown[]) => mockCreateOrder(...a), transitionOrder: vi.fn(), cancelOrder: vi.fn(), declineFreeCoffee: vi.fn(),
}));
vi.mock("@/server/actions/auth", () => ({ signOut: vi.fn() }));
vi.mock("@/server/actions/favo", () => ({ getFavo: vi.fn().mockResolvedValue({ ok: true, data: { favo: null } }), setFavo: vi.fn(), clearFavo: vi.fn() }));
vi.mock("@/server/actions/customers", () => ({ searchCustomer: vi.fn() }));
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
vi.mock("@/hooks/useOrderStream", () => ({ useOrderStream: () => ({ activeOrders: [], status: "connected" }) }));
vi.mock("@/hooks/useOfflineOutbox", () => ({
  useOfflineOutbox: () => ({ pendingOrders: [], pendingCount: 0, syncing: false, queueOrder: vi.fn(), sync: vi.fn(), syncOne: vi.fn(), refresh: vi.fn() }),
}));

const MENU = vi.hoisted(() => [
  { id: "menu_capp", name: "Cappuccino", category: "coffee", active: true, currentPriceZar: 2000, customisations: [], takesShots: true },
  { id: "menu_choc", name: "Hot Chocolate", category: "other", active: true, currentPriceZar: 2000, customisations: [], takesShots: false },
]);
vi.mock("@/server/actions/menu", () => ({ getMenu: vi.fn().mockResolvedValue({ ok: true, data: MENU }) }));

import POSWorkspace from "@/components/pos/POSWorkspace";
import { useDraftOrder } from "@/store/draftOrder";
import { formatZar } from "@/lib/format";

const WEEKDAY = { mode: "weekday" as const, maxShots: 2, surchargeInForce: false, extraShotZar: 1000 };
const SUNDAY = { mode: "sunday" as const, maxShots: 4, surchargeInForce: true, extraShotZar: 1000 };

async function openDrink(name: RegExp) {
  const tile = await screen.findByRole("button", { name });
  await act(async () => { fireEvent.click(tile); });
}
const segments = () => within(screen.getByRole("group", { name: "Shots" })).getAllByRole("button");
const addToOrder = async () => act(async () => { fireEvent.click(screen.getByRole("button", { name: /add to order/i })); });

beforeEach(() => {
  vi.clearAllMocks();
  useDraftOrder.getState().reset();
  Object.defineProperty(navigator, "onLine", { value: true, configurable: true });
});

describe("AT-202 — shot picker (§6.2.3c, REQ-138, L48)", () => {
  it("weekday: two segments, 1 and 2 — not four greyed ones", async () => {
    render(<POSWorkspace staffName="Sam" staffId="s1" role="barista" shotPolicy={WEEKDAY} />);
    await openDrink(/cappuccino/i);
    expect(segments().map((b) => b.textContent)).toEqual(["1", "2"]);
    expect(screen.queryByRole("button", { name: "3 shots" })).toBeNull();
  });

  it("no policy passed: fails closed to two segments", async () => {
    render(<POSWorkspace staffName="Sam" staffId="s1" role="barista" />);
    await openDrink(/cappuccino/i);
    expect(segments()).toHaveLength(2);
  });

  it("Sunday: four segments, 1 selected by default; spaced 44 px targets under one label", async () => {
    render(<POSWorkspace staffName="Sam" staffId="s1" role="barista" shotPolicy={SUNDAY} />);
    await openDrink(/cappuccino/i);
    const segs = segments();
    expect(segs.map((b) => b.textContent)).toEqual(["1", "2", "3", "4"]);
    expect(segs.map((b) => b.getAttribute("aria-pressed"))).toEqual(["true", "false", "false", "false"]);
    for (const b of segs) expect(b.className).toMatch(/\bh-11\b.*\bw-11\b/); // 44 px
    expect(segs[0].parentElement?.className).toMatch(/\bgap-2\b/); // 8 px between, never flush
    expect(within(screen.getByRole("group", { name: "Shots" })).getByText("Shots")).toBeDefined();
  });

  it("a drink with no coffee renders no picker (L48)", async () => {
    render(<POSWorkspace staffName="Sam" staffId="s1" role="barista" shotPolicy={SUNDAY} />);
    await openDrink(/hot chocolate/i);
    expect(screen.queryByRole("group", { name: "Shots" })).toBeNull();
  });

  it("Sunday triple: the draft line reads '3 shots' at R30.00; a double stays its own line; total R50.00", async () => {
    render(<POSWorkspace staffName="Sam" staffId="s1" role="barista" shotPolicy={SUNDAY} />);
    await openDrink(/cappuccino/i);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "3 shots" })); });
    await addToOrder();
    await openDrink(/cappuccino/i);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "2 shots" })); });
    await addToOrder();

    const items = useDraftOrder.getState().items;
    expect(items.map((i) => ({ shots: i.shots, surchargeZar: i.surchargeZar }))).toEqual([
      { shots: 3, surchargeZar: 1000 },
      { shots: 2, surchargeZar: 0 },
    ]);
    expect(useDraftOrder.getState().totalZar).toBe(5000);
    expect(screen.getByText("3 shots")).toBeDefined();
    expect(screen.getByText("2 shots")).toBeDefined();
    // The line's price element reads exactly R30.00 (3000 cents, surcharge-inclusive).
    const priceOf = (cents: number) =>
      [...document.querySelectorAll("span")].filter((s) => s.textContent === formatZar(cents));
    expect(priceOf(3000).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: /^charge r/i }).textContent).toBe(`Charge ${formatZar(5000)}`);
  });

  it("Place sends each line's shots to createOrder; a non-coffee line sends 1", async () => {
    mockCreateOrder.mockResolvedValue({ ok: false, code: "X", message: "stop here" });
    render(<POSWorkspace staffName="Sam" staffId="s1" role="barista" shotPolicy={SUNDAY} />);
    await openDrink(/cappuccino/i);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "4 shots" })); });
    await addToOrder();
    await openDrink(/hot chocolate/i);
    await addToOrder();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /^no notification$/i })); });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /^charge r/i })); });

    expect(mockCreateOrder).toHaveBeenCalledTimes(1);
    const input = mockCreateOrder.mock.calls[0][0] as { items: { menuItemId: string; shots: number }[] };
    expect(input.items.map((i) => [i.menuItemId, i.shots])).toEqual([["menu_capp", 4], ["menu_choc", 1]]);
    // The client never sends a price or a surcharge — the server prices.
    expect(JSON.stringify(input)).not.toMatch(/surcharge|priceZar/i);
  });
});
