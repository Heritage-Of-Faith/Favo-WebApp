// AT-203 — the blessing-fund chips in the POS footer (PRD v7.0 §6.10.6,
// §6.2.4c, REQ-164, REQ-169, REQ-170, L47, L48). Assertions are on the
// RENDERED TREE (§15.1's L48 row). Amounts are the PRD's own, in integer
// cents: R20 cappuccino 2000, `Thandeka's group · R180` 18000,
// `Blessing fund · Louis M. · R340 · +4` 34000.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("next/image", () => ({ default: (p: Record<string, unknown>) => <span data-src={String(p.src ?? "")} /> }));
vi.mock("next/script", () => ({ default: () => null }));

const mockCreateOrder = vi.fn();
vi.mock("@/server/actions/orders", () => ({
  createOrder: (...a: unknown[]) => mockCreateOrder(...a),
  declineFreeCoffee: vi.fn(), transitionOrder: vi.fn(), cancelOrder: vi.fn(),
}));
const mockBeginTender = vi.fn(() => new Promise(() => {}));
vi.mock("@/server/actions/tender", () => ({
  beginTender: () => mockBeginTender(),
  sendToTerminal: vi.fn(() => new Promise(() => {})),
  pollTenderResult: vi.fn(() => new Promise(() => {})),
}));
vi.mock("@/server/actions/vouchers", () => ({ getVoucherContext: vi.fn().mockResolvedValue({ ok: true, data: { available: false, kind: null, kinds: [] } }) }));
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
vi.mock("@/hooks/useOrderStream", () => ({ useOrderStream: () => ({ activeOrders: [], status: "connected" }) }));
vi.mock("@/hooks/useOfflineOutbox", () => ({
  useOfflineOutbox: () => ({ pendingOrders: [], pendingCount: 0, syncing: false, queueOrder: vi.fn(), sync: vi.fn(), syncOne: vi.fn(), refresh: vi.fn() }),
}));

import POSWorkspace from "@/components/pos/POSWorkspace";
import { useDraftOrder } from "@/store/draftOrder";
import { revenueDay } from "@/lib/format";
import { FAIL_CLOSED_POLICY } from "@/server/orders/shot-surcharge";
import type { FundOptions } from "@/server/funds/funds";

const OWNER = `staff_thandeka|${revenueDay()}`;
const CAPP = { menuItemId: "mi_capp", menuItemName: "Cappuccino", unitPriceZar: 2000, modifications: [], quantity: 1 };
const THANDEKA = { id: "cust_thandeka", name: "Thandeka", surname: "M.", phoneLast4: null };

const LINKED = { fundId: "g1", code: "FVO-9PQR", displayName: "Thandeka's group", balanceZar: 18_000, canCover: true, lit: true };
const OPEN = { fundId: "f1", code: "FVO-7K2M", displayName: "Louis M.", balanceZar: 34_000, behind: 4 };
const OPEN_LIST = [OPEN, ...[2, 3, 4, 5].map((n) => ({ fundId: `f${n}`, code: `FVO-000${n}`, displayName: null, balanceZar: 5000 }))];
const NONE: FundOptions = { linked: null, open: null, openList: [] };

const fundOptions = vi.fn();
const chipText = (s: string) => s.replace(/\s/g, " ");

function seed(customer: typeof THANDEKA | null = null) {
  useDraftOrder.getState().reset();
  useDraftOrder.setState({ draftOwner: OWNER });
  useDraftOrder.getState().addItem(CAPP);
  if (customer) useDraftOrder.getState().setCustomer(customer);
}

async function mount(props: Partial<Parameters<typeof POSWorkspace>[0]> = {}) {
  render(<POSWorkspace staffName="Thandeka" staffId="staff_thandeka" role="barista" fundOptions={fundOptions} {...props} />);
  await act(async () => { await Promise.resolve(); });
  await act(async () => { await Promise.resolve(); });
}

const chips = () => document.querySelectorAll("[data-fund-chip]");
const linkedChip = () => document.querySelector("[data-fund-chip='linked']") as HTMLButtonElement;
const openChip = () => document.querySelector("[data-fund-chip='open']") as HTMLButtonElement;
const placeButton = () => screen.getByRole("button", { name: /^(charge r|send to queue)/i });

beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(navigator, "onLine", { value: true, configurable: true });
});

describe("REQ-170 — one open-fund chip, at any number of open funds", () => {
  it("names the fund FAVO draws from and the count behind it; never more than two chips", async () => {
    fundOptions.mockResolvedValue({ ok: true, data: { linked: null, open: OPEN, openList: OPEN_LIST } });
    seed();
    await mount();
    expect(fundOptions).toHaveBeenCalledWith({ customerId: null, netZar: 2000 });
    expect(chips()).toHaveLength(1);
    expect(chipText(openChip().textContent ?? "")).toMatch(/^Blessing fund · Louis M\. · R ?340,00 · \+4$/);
    expect(openChip().getAttribute("aria-pressed")).toBe("false"); // explicit tap for an open fund
  });

  it("no '+0' when it is the only open fund", async () => {
    fundOptions.mockResolvedValue({ ok: true, data: { linked: null, open: { ...OPEN, behind: 0 }, openList: [OPEN] } });
    seed();
    await mount();
    expect(chipText(openChip().textContent ?? "")).toMatch(/^Blessing fund · Louis M\. · R ?340,00$/);
  });

  it("no fund can cover the order: no chip at all (L48) — not a chip that refuses", async () => {
    fundOptions.mockResolvedValue({ ok: true, data: NONE });
    seed();
    await mount();
    expect(chips()).toHaveLength(0);
    expect(screen.queryByRole("group", { name: "pays" })).toBeNull();
  });
});

describe("L48 — an order owing nothing offers no fund", () => {
  it("weekday mode: options are never asked for and no chip renders", async () => {
    fundOptions.mockResolvedValue({ ok: true, data: { linked: LINKED, open: OPEN, openList: OPEN_LIST } });
    seed(THANDEKA);
    await mount({ shotPolicy: { ...FAIL_CLOSED_POLICY, mode: "weekday" } });
    expect(fundOptions).not.toHaveBeenCalled();
    expect(chips()).toHaveLength(0);
  });

  it("no fundOptions passed: no chip", async () => {
    seed();
    await mount({ fundOptions: undefined });
    expect(chips()).toHaveLength(0);
  });
});

describe("REQ-164 / REQ-169 — the linked fund arrives lit; a radio, one tap for every outcome", () => {
  it("bound to a linked person: their chip is lit, the open chip beside it unlit, and Place charges nothing to the card", async () => {
    fundOptions.mockResolvedValue({ ok: true, data: { linked: LINKED, open: OPEN, openList: OPEN_LIST } });
    seed(THANDEKA);
    await mount();
    expect(fundOptions).toHaveBeenCalledWith({ customerId: "cust_thandeka", netZar: 2000 });
    expect(chips()).toHaveLength(2);
    expect(chipText(linkedChip().textContent ?? "")).toMatch(/^Thandeka's group · R ?180,00$/);
    expect(linkedChip().getAttribute("aria-pressed")).toBe("true");
    expect(openChip().getAttribute("aria-pressed")).toBe("false");
    expect(placeButton().textContent).toBe("Send to queue");
  });

  it("one tap on the lit chip turns it off: the order goes to the card", async () => {
    fundOptions.mockResolvedValue({ ok: true, data: { linked: LINKED, open: OPEN, openList: OPEN_LIST } });
    seed(THANDEKA);
    await mount();
    await act(async () => { fireEvent.click(linkedChip()); });
    expect(linkedChip().getAttribute("aria-pressed")).toBe("false");
    expect(openChip().getAttribute("aria-pressed")).toBe("false");
    expect(chipText(placeButton().textContent ?? "")).toMatch(/^Charge R ?20,00$/);
  });

  it("one tap on the open chip switches the tender: it lights, the group chip goes dark", async () => {
    fundOptions.mockResolvedValue({ ok: true, data: { linked: LINKED, open: OPEN, openList: OPEN_LIST } });
    seed(THANDEKA);
    await mount();
    await act(async () => { fireEvent.click(openChip()); });
    expect(openChip().getAttribute("aria-pressed")).toBe("true");
    expect(linkedChip().getAttribute("aria-pressed")).toBe("false");
  });

  it("§6.10.5: a linked fund that cannot cover the order shows its balance and is not tappable", async () => {
    fundOptions.mockResolvedValue({ ok: true, data: { linked: { ...LINKED, balanceZar: 1000, canCover: false, lit: false }, open: null, openList: [] } });
    seed(THANDEKA);
    await mount();
    expect(chipText(linkedChip().textContent ?? "")).toMatch(/^Thandeka's group · R ?10,00$/);
    expect(linkedChip().disabled).toBe(true);
    expect(chipText(placeButton().textContent ?? "")).toMatch(/^Charge R ?20,00$/);
  });
});

describe("L47 — Place with a fund lit: createOrder draws it, nothing goes to the card machine", () => {
  it("sends donorFundId; a successful draw returns to the till with no tender at all", async () => {
    fundOptions.mockResolvedValue({ ok: true, data: { linked: LINKED, open: OPEN, openList: OPEN_LIST } });
    mockCreateOrder.mockResolvedValue({
      ok: true,
      data: { orderId: "ord-1", cardCheckout: true, totalZar: 2000, freeCup: { applied: false, code: null, message: null, discountZar: 0 }, tender: null,
        fundDraw: { ok: true, fundId: "g1", amountZar: 2000, balanceAfterZar: 16_000 } },
    });
    seed(THANDEKA);
    await mount();
    await act(async () => { fireEvent.click(placeButton()); });
    expect(mockCreateOrder).toHaveBeenCalledWith(expect.objectContaining({ customerId: "cust_thandeka", donorFundId: "g1" }));
    expect(mockBeginTender).not.toHaveBeenCalled();
    expect(screen.queryByText(/Amount due/i)).toBeNull();
    expect(screen.getByText(/Order paid — sent to the queue\./)).toBeDefined();
  });

  it("the card chosen: no donorFundId is sent", async () => {
    fundOptions.mockResolvedValue({ ok: true, data: { linked: LINKED, open: null, openList: [] } });
    mockCreateOrder.mockResolvedValue({ ok: false, code: "X", message: "stop" });
    seed(THANDEKA);
    await mount();
    await act(async () => { fireEvent.click(linkedChip()); });
    await act(async () => { fireEvent.click(placeButton()); });
    expect(mockCreateOrder.mock.calls[0][0]).not.toHaveProperty("donorFundId");
  });

  it("the draw is refused: the server's reason is shown and nothing is sent to the card machine", async () => {
    fundOptions.mockResolvedValue({ ok: true, data: { linked: null, open: { ...OPEN, behind: 0 }, openList: [OPEN] } });
    mockCreateOrder.mockResolvedValue({
      ok: true,
      data: { orderId: "ord-2", cardCheckout: false, totalZar: 2000, freeCup: { applied: false, code: null, message: null, discountZar: 0 }, tender: null,
        fundDraw: { ok: false, code: "FUND_INSUFFICIENT", message: "This fund holds R 10,00 — not enough for R 20,00." } },
    });
    seed();
    await mount({ fundOptions, initialOrders: [] });
    // A target is required (L28): "No notification" for a stranger.
    const none = screen.queryByRole("button", { name: /no notification/i });
    if (none) await act(async () => { fireEvent.click(none); });
    await act(async () => { fireEvent.click(openChip()); });
    await act(async () => { fireEvent.click(placeButton()); });
    expect(mockCreateOrder).toHaveBeenCalledWith(expect.objectContaining({ donorFundId: "f1" }));
    expect(await screen.findByText("This fund holds R 10,00 — not enough for R 20,00.")).toBeDefined();
    expect(mockBeginTender).not.toHaveBeenCalled();
  });
});

describe("REQ-164 race — Place never proceeds as if no fund applies before the bound person's fund is checked", () => {
  it("options still loading for a bound customer: Place is disabled and says why", async () => {
    fundOptions.mockReturnValue(new Promise(() => {}));
    seed(THANDEKA);
    await mount();
    expect(placeButton().hasAttribute("disabled")).toBe(true);
    expect(screen.getByText("Checking the blessing fund…")).toBeDefined();
    await act(async () => { fireEvent.click(placeButton()); });
    expect(mockCreateOrder).not.toHaveBeenCalled();
  });

  it("the check failed: Place stays disabled, the failure is named and a retry is offered; the retry re-checks", async () => {
    fundOptions.mockRejectedValueOnce(new Error("network")).mockResolvedValue({ ok: true, data: { linked: LINKED, open: null, openList: [] } });
    seed(THANDEKA);
    await mount();
    expect(placeButton().hasAttribute("disabled")).toBe(true);
    expect(screen.getByText("Couldn't check the blessing fund.")).toBeDefined();
    expect(chips()).toHaveLength(0);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Try again" })); });
    await act(async () => { await Promise.resolve(); });
    expect(fundOptions).toHaveBeenCalledTimes(2);
    expect(linkedChip().getAttribute("aria-pressed")).toBe("true");
    expect(placeButton().hasAttribute("disabled")).toBe(false);
    expect(screen.queryByText("Couldn't check the blessing fund.")).toBeNull();
  });

  it("a server refusal (ok:false) is a failed check too — never read as 'no fund applies'", async () => {
    fundOptions.mockResolvedValue({ ok: false, code: "UNAUTHORIZED", message: "x" });
    seed(THANDEKA);
    await mount();
    expect(placeButton().hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button", { name: "Try again" })).toBeDefined();
  });

  it("loaded with no fund that applies: Place proceeds normally to the card", async () => {
    fundOptions.mockResolvedValue({ ok: true, data: NONE });
    mockCreateOrder.mockResolvedValue({ ok: false, code: "X", message: "stop" });
    seed(THANDEKA);
    await mount();
    expect(placeButton().hasAttribute("disabled")).toBe(false);
    expect(chipText(placeButton().textContent ?? "")).toMatch(/^Charge R ?20,00$/);
    await act(async () => { fireEvent.click(placeButton()); });
    expect(mockCreateOrder.mock.calls[0][0]).not.toHaveProperty("donorFundId");
  });

  it("no person bound: a pending or failed check never holds the order back (an open fund needs a tap)", async () => {
    fundOptions.mockReturnValue(new Promise(() => {}));
    seed();
    await mount();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "No notification" })); });
    expect(placeButton().hasAttribute("disabled")).toBe(false);
    expect(screen.queryByText("Checking the blessing fund…")).toBeNull();
  });
});
