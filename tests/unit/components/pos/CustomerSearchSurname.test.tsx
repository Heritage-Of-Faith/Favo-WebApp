// AT-213 / REQ-142 — POS customer search: two people with one given name are
// told apart. PRD §6.9.4a (DEF-F): "Surname always renders beside the given
// name, and where two results still read alike the last four digits of the
// phone are shown."

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("next/image", () => ({ default: (p: Record<string, unknown>) => <span data-src={String(p.src ?? "")} /> }));
vi.mock("next/script", () => ({ default: () => null }));

vi.mock("@/server/actions/orders", () => ({
  createOrder: vi.fn(), declineFreeCoffee: vi.fn(), transitionOrder: vi.fn(), cancelOrder: vi.fn(),
}));
vi.mock("@/server/actions/auth", () => ({ signOut: vi.fn() }));
vi.mock("@/server/actions/favo", () => ({ getFavo: vi.fn().mockResolvedValue({ ok: true, data: { favo: null } }), setFavo: vi.fn(), clearFavo: vi.fn() }));
const mockSearch = vi.fn();
vi.mock("@/server/actions/customers", () => ({ searchCustomer: (...a: unknown[]) => mockSearch(...a) }));
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
vi.mock("@/hooks/useOrderStream", () => ({ useOrderStream: () => ({ activeOrders: [], status: "connected" }) }));
vi.mock("@/hooks/useOfflineOutbox", () => ({
  useOfflineOutbox: () => ({ pendingOrders: [], pendingCount: 0, syncing: false, queueOrder: vi.fn(), sync: vi.fn(), syncOne: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("@/store/draftOrder", () => ({
  lineKey: (x: { menuItemId: string }) => x.menuItemId,
  useDraftOrder: () => ({
    customer: null, items: [], totalZar: 0,
    setCustomer: vi.fn(), addItem: vi.fn(), removeItem: vi.fn(), updateQuantity: vi.fn(), reset: vi.fn(),
  }),
}));

import POSWorkspace from "@/components/pos/POSWorkspace";

beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(navigator, "onLine", { value: true, configurable: true });
});

async function search(query: string) {
  render(<POSWorkspace staffName="Louis" staffId="staff_louis" role="barista" />);
  // #279 gives the search input role="combobox" (keyboard-navigable results list).
  const input = screen.getByRole("combobox");
  await act(async () => { fireEvent.change(input, { target: { value: query } }); });
}

describe("POSWorkspace — customer search results (REQ-142, DEF-F)", () => {
  it("renders the surname beside the given name, so two Thandekas are told apart", async () => {
    mockSearch.mockResolvedValue({
      ok: true,
      data: [
        { id: "c1", name: "Thandeka", surname: "Dlamini", phoneLast4: "4567" },
        { id: "c2", name: "Thandeka", surname: "Mokoena", phoneLast4: "6543" },
      ],
    });
    await search("tha");

    expect(await screen.findByText("Thandeka Dlamini")).toBeDefined();
    expect(screen.getByText("Thandeka Mokoena")).toBeDefined();
    // Surnames already tell them apart — no phone digits needed.
    expect(screen.queryByText("…4567")).toBeNull();
    expect(screen.queryByText("…6543")).toBeNull();
  });

  it("where two results still read alike, shows the last four phone digits", async () => {
    mockSearch.mockResolvedValue({
      ok: true,
      data: [
        { id: "c1", name: "Louis", surname: "Botha", phoneLast4: "4567" },
        { id: "c2", name: "Louis", surname: "Botha", phoneLast4: "6543" },
        { id: "c3", name: "Louis", surname: null, phoneLast4: "1111" },
      ],
    });
    await search("lou");

    expect(await screen.findAllByText("Louis Botha")).toHaveLength(2);
    expect(screen.getByText("…4567")).toBeDefined();
    expect(screen.getByText("…6543")).toBeDefined();
    // A customer with no surname renders the given name alone, and reads unlike the others.
    expect(screen.getByRole("button", { name: "Louis" })).toBeDefined();
    expect(screen.queryByText("…1111")).toBeNull();
  });
});
