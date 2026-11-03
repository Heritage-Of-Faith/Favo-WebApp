// AT-203 — /admin/funds (PRD v7.0 §13.9, §6.10.3, §10.7, REQ-161, REQ-173,
// L44, L45). Amounts are the PRD's own, in integer cents: a R500 gift is
// 50000, a R20 draw -2000; typed rands become cents through parseZar, never ×100
// on a float.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act, within } from "@testing-library/react";

const createDonorFund = vi.fn();
const topUpDonorFund = vi.fn();
const listFundsForAdmin = vi.fn();
vi.mock("@/server/actions/funds", () => ({
  createDonorFund: (...a: unknown[]) => createDonorFund(...a),
  topUpDonorFund: (...a: unknown[]) => topUpDonorFund(...a),
  listFundsForAdmin: () => listFundsForAdmin(),
}));
const searchCustomer = vi.fn();
vi.mock("@/server/actions/customers", () => ({ searchCustomer: (...a: unknown[]) => searchCustomer(...a) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import FundsManager, { NON_REFUNDABLE_ACK, TOPUP_UNCONFIRMED, CHECKED_LEDGER, CREATE_UNCONFIRMED, CHECKED_FUNDS } from "@/components/admin/FundsManager";
import type { AdminFundListItem } from "@/server/actions/funds";

const sp = (s: string | null) => (s ?? "").replace(/\s/g, " ");

const LOUIS_FUND: AdminFundListItem = {
  fundId: "f1", code: "FVO-7K2M", displayName: "Louis M.", balanceZar: 48_000, pendingTopupsZar: 0, dormant: false,
  lastDrawAt: "2026-10-25T07:00:00.000Z", memberIds: [], members: [],
  entries: [
    { id: "e1", kind: "top_up", amountZar: 50_000, fundingMethod: "cash", reference: "receipt 1", reason: "gift", orderId: null, at: "2026-10-01T08:00:00.000Z", status: null, counts: true },
    { id: "e2", kind: "spend", amountZar: -2000, fundingMethod: null, reference: null, reason: null, orderId: "ord-1", at: "2026-10-25T07:00:00.000Z", status: null, counts: true },
  ],
};
const GROUP_FUND: AdminFundListItem = {
  fundId: "g1", code: "FVO-9PQR", displayName: "Thandeka's group", balanceZar: 18_000, pendingTopupsZar: 50_000, dormant: false,
  lastDrawAt: null, memberIds: ["cust_thandeka"], members: [{ id: "cust_thandeka", name: "Thandeka M." }],
  entries: [
    { id: "e3", kind: "top_up", amountZar: 18_000, fundingMethod: "eft", reference: "FNB 123", reason: "group", orderId: null, at: "2026-10-02T08:00:00.000Z", status: null, counts: true },
    { id: "e4", kind: "top_up", amountZar: 50_000, fundingMethod: "card", reference: null, reason: null, orderId: null, at: "2026-10-25T07:00:00.000Z", status: "unresolved", counts: false },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  listFundsForAdmin.mockResolvedValue({ ok: true, data: { funds: [LOUIS_FUND, GROUP_FUND] } });
});

describe("the fund list — balance, pending top-ups, members, last draw, ledger", () => {
  it("prints each fund's balance in rands from integer cents, and its ledger signed", () => {
    render(<FundsManager initialFunds={[LOUIS_FUND, GROUP_FUND]} />);
    const louis = screen.getByRole("region", { name: "Louis M." });
    expect(sp(within(louis).getByTestId("fund-balance").textContent)).toMatch(/^Balance R ?480,00$/);
    expect(within(louis).getByTestId("fund-code").textContent).toBe("FVO-7K2M");
    expect(within(louis).getByTestId("fund-members").textContent).toBe("For anyone");
    const rows = within(within(louis).getByRole("table")).getAllByRole("row").slice(1);
    expect(rows.map((r) => sp(within(r).getAllByRole("cell")[2].textContent))).toEqual([expect.stringMatching(/^R ?500,00$/), expect.stringMatching(/^-R ?20,00$/)]);
  });

  it("REQ-173: an open card top-up is shown with its payment status, as not counted — the balance excludes it", () => {
    render(<FundsManager initialFunds={[GROUP_FUND]} />);
    const g = screen.getByRole("region", { name: "Thandeka's group" });
    expect(sp(within(g).getByTestId("fund-balance").textContent)).toMatch(/^Balance R ?180,00$/);
    expect(sp(within(g).getByTestId("fund-pending").textContent)).toMatch(/R ?500,00/);
    expect(within(g).getByText("unresolved · not counted")).toBeDefined();
    expect(within(g).getByTestId("fund-members").textContent).toBe("For: Thandeka M.");
  });

  it("no fund yet: the reason and the next action, never a bare blank", () => {
    render(<FundsManager initialFunds={[]} />);
    expect(screen.getByText("No blessing funds yet — create one above.")).toBeDefined();
  });

  it("no refund, void or tip wording on the screen (L02); the banned word is held by verify-v7's grep gate", () => {
    const { container } = render(<FundsManager initialFunds={[LOUIS_FUND, GROUP_FUND]} />);
    expect(container.textContent).not.toMatch(/\brefund\b|\bvoid\b|\btip\b/i);
  });
});

describe("REQ-161 — the cash/EFT top-up carries a funding_method and a reference", () => {
  it("records EFT R500 as 50000 cents with its reference and reason", async () => {
    topUpDonorFund.mockResolvedValue({ ok: true, data: { entryId: "e9", balanceZar: 98_000 } });
    render(<FundsManager initialFunds={[LOUIS_FUND]} />);
    const form = screen.getByRole("group", { name: "Record a cash or EFT gift" });
    fireEvent.click(within(form).getByRole("button", { name: "EFT" }));
    fireEvent.change(within(form).getByLabelText("Amount (R)"), { target: { value: "500" } });
    fireEvent.change(within(form).getByLabelText("Reference"), { target: { value: "FNB 0042" } });
    fireEvent.change(within(form).getByLabelText("Reason"), { target: { value: "Gift from the Meyers" } });
    await act(async () => { fireEvent.click(within(form).getByRole("button", { name: "Record top-up" })); });
    expect(topUpDonorFund).toHaveBeenCalledWith({ fundId: "f1", amountZar: 50_000, fundingMethod: "eft", reference: "FNB 0042", reason: "Gift from the Meyers" });
    expect(listFundsForAdmin).toHaveBeenCalled();
  });

  it("no method or reference: the server's VALIDATION message shows on the form and the values stay", async () => {
    topUpDonorFund.mockResolvedValue({ ok: false, code: "VALIDATION", message: "Choose how the gift arrived: cash or EFT. A card gift is taken at the counter." });
    render(<FundsManager initialFunds={[LOUIS_FUND]} />);
    const form = screen.getByRole("group", { name: "Record a cash or EFT gift" });
    fireEvent.change(within(form).getByLabelText("Amount (R)"), { target: { value: "150,50" } });
    await act(async () => { fireEvent.click(within(form).getByRole("button", { name: "Record top-up" })); });
    expect(topUpDonorFund).toHaveBeenCalledWith(expect.objectContaining({ amountZar: 15_050, fundingMethod: null, reference: "" }));
    expect(within(form).getByRole("alert").textContent).toBe("Choose how the gift arrived: cash or EFT. A card gift is taken at the counter.");
    expect((within(form).getByLabelText("Amount (R)") as HTMLInputElement).value).toBe("150,50");
  });

  it("an amount that is not rands is refused on the form, and nothing is sent", async () => {
    render(<FundsManager initialFunds={[LOUIS_FUND]} />);
    const form = screen.getByRole("group", { name: "Record a cash or EFT gift" });
    fireEvent.change(within(form).getByLabelText("Amount (R)"), { target: { value: "500.555" } });
    await act(async () => { fireEvent.click(within(form).getByRole("button", { name: "Record top-up" })); });
    expect(topUpDonorFund).not.toHaveBeenCalled();
    expect(within(form).getByRole("alert")).toBeDefined();
  });
});

describe("§6.10.3 step 1 — create a fund: For specific people or For anyone, and L45's acknowledgement", () => {
  it("For anyone, R500: no names, the acknowledgement passed through as given", async () => {
    createDonorFund.mockResolvedValue({ ok: true, data: { fundId: "f9", code: "FVO-3XYZ", displayName: "Easter gift" } });
    render(<FundsManager initialFunds={[]} />);
    const form = screen.getByRole("region", { name: "Create a blessing fund" });
    fireEvent.change(within(form).getByLabelText("Name"), { target: { value: "Easter gift" } });
    fireEvent.click(within(form).getByRole("button", { name: "For anyone" }));
    fireEvent.change(within(form).getByLabelText("Amount (R)"), { target: { value: "R500,00" } });
    fireEvent.click(within(form).getByLabelText(NON_REFUNDABLE_ACK));
    await act(async () => { fireEvent.click(within(form).getByRole("button", { name: "Create fund" })); });
    expect(createDonorFund).toHaveBeenCalledWith({
      displayName: "Easter gift", forSpecificPeople: false, customerIds: [], nonRefundableAcknowledged: true, amountZar: 50_000,
    });
  });

  it("For specific people: the linked names chosen from search are sent", async () => {
    searchCustomer.mockResolvedValue({ ok: true, data: [{ id: "cust_thandeka", name: "Thandeka", surname: "M.", phoneLast4: null }] });
    createDonorFund.mockResolvedValue({ ok: true, data: { fundId: "g9", code: "FVO-9PQR", displayName: "Thandeka's group" } });
    render(<FundsManager initialFunds={[]} />);
    const form = screen.getByRole("region", { name: "Create a blessing fund" });
    fireEvent.click(within(form).getByRole("button", { name: "For specific people" }));
    fireEvent.change(within(form).getByLabelText("Search people"), { target: { value: "Than" } });
    await act(async () => { fireEvent.click(within(form).getByRole("button", { name: "Search" })); });
    fireEvent.click(within(form).getByRole("button", { name: "Add Thandeka M." }));
    fireEvent.change(within(form).getByLabelText("Amount (R)"), { target: { value: "180" } });
    fireEvent.click(within(form).getByLabelText(NON_REFUNDABLE_ACK));
    await act(async () => { fireEvent.click(within(form).getByRole("button", { name: "Create fund" })); });
    expect(createDonorFund).toHaveBeenCalledWith(expect.objectContaining({ forSpecificPeople: true, customerIds: ["cust_thandeka"], amountZar: 18_000 }));
  });

  it("L45: without the acknowledgement the server refuses, and its words are shown", async () => {
    createDonorFund.mockResolvedValue({ ok: false, code: "VALIDATION", message: "Tell the donor the gift is non-refundable, and confirm they understood." });
    render(<FundsManager initialFunds={[]} />);
    const form = screen.getByRole("region", { name: "Create a blessing fund" });
    fireEvent.click(within(form).getByRole("button", { name: "For anyone" }));
    fireEvent.change(within(form).getByLabelText("Amount (R)"), { target: { value: "500" } });
    await act(async () => { fireEvent.click(within(form).getByRole("button", { name: "Create fund" })); });
    expect(createDonorFund).toHaveBeenCalledWith(expect.objectContaining({ nonRefundableAcknowledged: false }));
    expect(within(form).getByRole("alert").textContent).toBe(NON_REFUNDABLE_ACK);
  });
});

describe("no answer from the server is not 'nothing was saved' — no blind retry (no idempotency key, no undo)", () => {
  it("top-up: says it is NOT confirmed, reloads the ledger, and offers no Record button until the Admin has checked", async () => {
    topUpDonorFund.mockRejectedValue(new Error("network dropped"));
    render(<FundsManager initialFunds={[LOUIS_FUND]} />);
    const form = screen.getByRole("group", { name: "Record a cash or EFT gift" });
    fireEvent.click(within(form).getByRole("button", { name: "Cash" }));
    fireEvent.change(within(form).getByLabelText("Amount (R)"), { target: { value: "500" } });
    fireEvent.change(within(form).getByLabelText("Reference"), { target: { value: "receipt 7" } });
    fireEvent.change(within(form).getByLabelText("Reason"), { target: { value: "gift" } });
    await act(async () => { fireEvent.click(within(form).getByRole("button", { name: "Record top-up" })); });
    expect(within(form).getByRole("alert").textContent).toBe(TOPUP_UNCONFIRMED);
    expect(TOPUP_UNCONFIRMED).toMatch(/couldn't confirm whether/i);
    expect(TOPUP_UNCONFIRMED).not.toMatch(/nothing was saved|try again/i);
    expect(listFundsForAdmin).toHaveBeenCalledTimes(1); // the ledger reloads by itself
    expect(within(form).queryByRole("button", { name: "Record top-up" })).toBeNull();
    // A deliberate step, not a retry: it records nothing by itself.
    await act(async () => { fireEvent.click(within(form).getByRole("button", { name: CHECKED_LEDGER })); });
    expect(topUpDonorFund).toHaveBeenCalledTimes(1);
    expect(within(form).getByRole("button", { name: "Record top-up" })).toBeDefined();
  });

  it("create: says it is NOT confirmed, reloads the list, and offers no Create button until the Admin has checked", async () => {
    createDonorFund.mockRejectedValue(new Error("network dropped"));
    render(<FundsManager initialFunds={[]} />);
    const form = screen.getByRole("region", { name: "Create a blessing fund" });
    fireEvent.click(within(form).getByRole("button", { name: "For anyone" }));
    fireEvent.change(within(form).getByLabelText("Amount (R)"), { target: { value: "500" } });
    fireEvent.click(within(form).getByLabelText(NON_REFUNDABLE_ACK));
    await act(async () => { fireEvent.click(within(form).getByRole("button", { name: "Create fund" })); });
    expect(within(form).getByRole("alert").textContent).toBe(CREATE_UNCONFIRMED);
    expect(listFundsForAdmin).toHaveBeenCalledTimes(1);
    expect(within(form).queryByRole("button", { name: "Create fund" })).toBeNull();
    await act(async () => { fireEvent.click(within(form).getByRole("button", { name: CHECKED_FUNDS })); });
    expect(createDonorFund).toHaveBeenCalledTimes(1);
    expect(within(form).getByRole("button", { name: "Create fund" })).toBeDefined();
  });
});
