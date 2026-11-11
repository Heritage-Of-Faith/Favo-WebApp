// T10 screen (PRD v7.0 §6.8.3): unmatched rate, both directions, tips and
// variances, retail as information, and REQ-034's open write-offs. The only
// action offered is the tender chain's own lookup ("Check with Yoco").

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock("@/server/actions/tender", () => ({ resolveTenderByLookup: vi.fn() }));

import T10Panel from "@/components/admin/T10Panel";
import type { T10View } from "@/server/reconciliation/t10-view";
import type { ImportSummary } from "@/server/reconciliation/import";

const IMPORT: ImportSummary = {
  version: 1, revenueDay: "2026-08-16", importedAt: "2026-08-17T07:00:00.000Z", uploadedByStaffId: "staff-admin",
  columns: [], notes: [], totalRows: 14, matchedRows: 12, unmatchedRows: 1, yocoGrossZar: 35000, yocoFeeZar: 927,
  annotatedPayments: 12,
  exceptions: [
    { kind: "unmatched", line: 5, yocoPaymentId: "yp_x", paymentId: null, orderId: null, amountZar: 2000, detail: "Yoco holds this payment and FAVO does not." },
    { kind: "tip", line: 6, yocoPaymentId: "yp_t", paymentId: "p1", orderId: "order-abcdef123", amountZar: 2500, detail: "A tip of 500 cents came through the machine." },
  ],
  info: [{ kind: "retail", line: 12, yocoPaymentId: "yp_cups", amountZar: 0, orderId: null }],
  missingFromYoco: [{ paymentId: "p9", orderId: "order-99999999", fundTopupId: null, yocoPaymentId: "yp_9", amountZar: 2000 }],
  rowKeys: [],
};

function view(over: Partial<T10View> = {}): T10View {
  return { revenueDay: "2026-08-16", latestImport: IMPORT, writeOffs: [], ...over };
}

describe("T10Panel", () => {
  it("reports the unmatched rate, the exceptions, both directions and retail as information", () => {
    const { container } = render(<T10Panel view={view()} />);
    const text = container.textContent ?? "";
    expect(text).toContain("1 of 14 rows unmatched");
    expect(text).toContain("In Yoco, not in FAVO");
    expect(text).toContain("Tip came through");
    expect(text).toContain("In FAVO, not in Yoco's export (1)");
    expect(text).toContain("Retail sale outside the menu");
    expect(text).toContain("Yoco id yp_cups");
  });

  it("no import: says the day's fees stay unavailable", () => {
    const { container } = render(<T10Panel view={view({ latestImport: null })} />);
    expect(container.textContent).toContain("No Yoco export has been imported for 2026-08-16");
  });

  const base = { totalZar: 2000, yocoPaymentIds: ["yp_1"], clientReferences: ["cu:1"], confirmedNoPayment: false };

  it("REQ-034: open write-offs are listed; Check with Yoco only where Yoco shows a payment; Confirm only where the export has no row", () => {
    render(
      <T10Panel
        view={view({
          writeOffs: [
            { ...base, orderId: "o-shows", revenueDay: "2026-08-16", status: "yoco_shows_payment", open: true },
            { ...base, orderId: "o-wait", revenueDay: "2026-08-15", status: "waiting_for_export", open: true },
            { ...base, orderId: "o-nomatch", revenueDay: "2026-08-16", status: "export_no_match", open: true },
          ],
        })}
      />
    );
    expect(screen.getByText(/3 open/)).toBeTruthy();
    expect(screen.getByText(/Export has no matching row: Admin to confirm/)).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Check with Yoco" })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "Confirm no payment" })).toHaveLength(1);
  });

  it("a confirmed item shows closed, on its own day only", () => {
    const { container } = render(
      <T10Panel view={view({ writeOffs: [{ ...base, orderId: "o-done", revenueDay: "2026-08-16", confirmedNoPayment: true, status: "confirmed_no_payment", open: false }] })} />
    );
    expect(container.textContent).toContain("Admin confirmed: no Yoco payment (closed)");
    expect(container.textContent).toContain("(0 open)");
  });
});
