// Component tests for A12 (recipients optimistic toggle) and A13 (dual-sign
// role gating). Server actions + sonner are mocked.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { MonthlyReport, AlertRecipient } from "@/lib/types";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const mockApprove = vi.fn();
vi.mock("@/server/actions/monthly-pnl", () => ({
  approveMonthlyPnL: (...args: unknown[]) => mockApprove(...args),
}));

const mockAdd = vi.fn();
const mockRemove = vi.fn();
vi.mock("@/server/actions/alert-recipients", () => ({
  addStockAlertRecipient: (...args: unknown[]) => mockAdd(...args),
  removeStockAlertRecipient: (...args: unknown[]) => mockRemove(...args),
}));

import DualSignBlock from "@/components/admin/DualSignBlock";
import RecipientsEditor from "@/components/admin/RecipientsEditor";

function draftReport(over: Partial<MonthlyReport> = {}): MonthlyReport {
  return {
    id: "rep1",
    month: "2026-05-01",
    revenueZar: 100000,
    cogsZar: 30000,
    expensesZar: 10000,
    grossMarginZar: 70000,
    netZar: 60000,
    status: "awaiting_signatures",
    adminSig: null,
    generatedAt: "2026-06-01T08:00:00+02:00",
    closedAt: null,
    ...over,
  };
}

describe("DualSignBlock — A13 admin-only sign-off", () => {
  beforeEach(() => vi.clearAllMocks());

  it("shows the sign button when canSignAdmin=true and report is unsigned", () => {
    render(
      <DualSignBlock
        report={draftReport()}
        canSignAdmin={true}
        onSigned={() => {}}
      />
    );
    expect(screen.getByRole("button", { name: /sign & close report/i })).toBeInTheDocument();
  });

  it("hides the sign button when canSignAdmin=false", () => {
    render(
      <DualSignBlock
        report={draftReport()}
        canSignAdmin={false}
        onSigned={() => {}}
      />
    );
    expect(screen.queryByRole("button", { name: /sign & close report/i })).toBeNull();
    expect(screen.getByText(/awaiting admin sign-off/i)).toBeInTheDocument();
  });

  it("shows the signer name instead of the button once signed", () => {
    render(
      <DualSignBlock
        report={draftReport({
          adminSig: { signerId: "s1", signerName: "Gian", at: "2026-06-02T09:00:00+02:00" },
        })}
        canSignAdmin={true}
        onSigned={() => {}}
      />
    );
    expect(screen.queryByRole("button", { name: /sign & close report/i })).toBeNull();
    expect(screen.getByText(/Gian/)).toBeInTheDocument();
  });
});

describe("RecipientsEditor — A12 optimistic toggle", () => {
  beforeEach(() => vi.clearAllMocks());

  const items = [{ id: "i1", name: "Beans" }];
  const staff = [{ id: "s1", name: "Sam", role: "barista" }];

  it("reverts the checkbox when the server rejects an add", async () => {
    mockAdd.mockResolvedValue({ ok: false, code: "ERR", message: "nope" });
    render(<RecipientsEditor items={items} staff={staff} initialRecipients={[]} />);

    // Global row + Beans row, each one staff column → 2 checkboxes
    const boxes = screen.getAllByRole("checkbox");
    expect(boxes[0]).not.toBeChecked();

    fireEvent.click(boxes[0]);
    await waitFor(() => expect(mockAdd).toHaveBeenCalledTimes(1));
    // Reverts to unchecked after the failure
    await waitFor(() => expect(boxes[0]).not.toBeChecked());
  });

  it("keeps the checkbox checked when the server accepts an add", async () => {
    mockAdd.mockResolvedValue({ ok: true, data: { recipientId: "r99" } });
    render(<RecipientsEditor items={items} staff={staff} initialRecipients={[]} />);

    const boxes = screen.getAllByRole("checkbox");
    fireEvent.click(boxes[0]);
    await waitFor(() => expect(boxes[0]).toBeChecked());
  });

  it("renders an initially-checked cell for an existing recipient", () => {
    const recipients: AlertRecipient[] = [
      { id: "r1", staffId: "s1", staffName: "Sam", staffRole: "barista", inventoryItemId: null, inventoryItemName: null },
    ];
    render(<RecipientsEditor items={items} staff={staff} initialRecipients={recipients} />);
    // First checkbox is the Global × Sam cell, which has a recipient
    expect(screen.getAllByRole("checkbox")[0]).toBeChecked();
  });
});
