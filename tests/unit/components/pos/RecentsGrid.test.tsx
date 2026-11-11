// PRD §6.2.1 / REQ-050 / REQ-052 — the recents grid on the till: leads the
// customer panel above search; served tiles below and marked; one tap binds;
// empty on a clean database ("On a clean database the grid is empty").

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
const mockSetCustomer = vi.fn();
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
    setCustomer: mockSetCustomer, addItem: vi.fn(), removeItem: vi.fn(), updateQuantity: vi.fn(), reset: vi.fn(),
  }),
}));

import POSWorkspace from "@/components/pos/POSWorkspace";
import { FREE_CUP_COPY } from "@/server/orders/free-coffee";

beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(navigator, "onLine", { value: true, configurable: true });
});

const TILES = [
  // The server sends phoneLast4 only where two tiles read alike (REQ-142).
  { id: "os-a", name: "Ayanda", surname: "Nkosi", phoneLast4: null, served: false },
  { id: "cm-x", name: "Xolani", surname: "Mthembu", phoneLast4: null, served: false },
  { id: "os-b", name: "Bongani", surname: "Zulu", phoneLast4: null, served: true },
];

describe("POSWorkspace — recents grid (§6.2.1, REQ-050, REQ-052)", () => {
  it("leads the customer panel, above the search field, in the server's order", async () => {
    const recents = vi.fn().mockResolvedValue({ ok: true, data: TILES });
    render(<POSWorkspace staffName="Louis" staffId="staff_louis" role="barista" recents={recents} />);
    const grid = await screen.findByRole("list", { name: "Recent customers" });
    const names = [...grid.querySelectorAll("button")].map((b) => b.querySelector("span")?.textContent);
    expect(names).toEqual(["Ayanda Nkosi", "Xolani Mthembu", "Bongani Zulu"]);
    // above the search field
    const search = screen.getByRole("combobox");
    expect(grid.compareDocumentPosition(search) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("marks a served tile visibly, and only that one", async () => {
    const recents = vi.fn().mockResolvedValue({ ok: true, data: TILES });
    render(<POSWorkspace staffName="Louis" staffId="staff_louis" role="barista" recents={recents} />);
    await screen.findByText("Bongani Zulu");
    expect(screen.getAllByText(FREE_CUP_COPY.ENTITLEMENT_USED)).toHaveLength(1);
    expect(screen.getByText("Bongani Zulu").closest("button")?.getAttribute("data-served")).toBe("true");
    expect(screen.getByText("Ayanda Nkosi").closest("button")?.getAttribute("data-served")).toBeNull();
  });

  it("one tap binds the customer, no typing", async () => {
    const recents = vi.fn().mockResolvedValue({ ok: true, data: TILES });
    render(<POSWorkspace staffName="Louis" staffId="staff_louis" role="barista" recents={recents} />);
    fireEvent.click(await screen.findByText("Ayanda Nkosi"));
    expect(mockSetCustomer).toHaveBeenCalledWith({ id: "os-a", name: "Ayanda" });
    expect(mockSearch).not.toHaveBeenCalled();
  });

  it("shows the last four digits exactly as the server sends them, and none where it sends null", async () => {
    const recents = vi.fn().mockResolvedValue({
      ok: true,
      data: [
        { id: "a", name: "André", surname: "Botha", phoneLast4: "4567", served: false },
        { id: "b", name: "Andre", surname: "Botha", phoneLast4: "6543", served: false },
        { id: "c", name: "Nkuli", surname: "Zulu", phoneLast4: null, served: false },
      ],
    });
    render(<POSWorkspace staffName="Louis" staffId="staff_louis" role="barista" recents={recents} />);
    expect(await screen.findByText("…4567")).toBeDefined();
    expect(screen.getByText("…6543")).toBeDefined();
    expect(screen.getByText("Nkuli Zulu").closest("button")?.textContent).toBe("Nkuli Zulu");
  });

  it("is empty on a clean database: no grid, no invented tiles, search still offered", async () => {
    const recents = vi.fn().mockResolvedValue({ ok: true, data: [] });
    render(<POSWorkspace staffName="Louis" staffId="staff_louis" role="barista" recents={recents} />);
    await act(async () => {});
    expect(recents).toHaveBeenCalled();
    expect(screen.queryByRole("list", { name: "Recent customers" })).toBeNull();
    expect(screen.getByRole("combobox")).toBeDefined();
  });
});
