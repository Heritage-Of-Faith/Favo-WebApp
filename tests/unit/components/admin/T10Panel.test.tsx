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
import { payoutLine, type PayoutLine } from "@/server/reconciliation/payout";

const IMPORT: ImportSummary = {
  version: 1, revenueDay: "2026-08-16", importedAt: "2026-08-17T07:00:00.000Z", uploadedByStaffId: "staff-admin",
  columns: [], notes: [], totalRows: 14, matchedRows: 12, unmatchedRows: 1, yocoGrossZar: 35000, yocoFeeZar: 927,
  annotatedPayments: 12,
  exceptions: [
    { kind: "unmatched", line: 5, yocoPaymentId: "yp_x", paymentId: null, orderId: null, amountZar: 2000, detail: "Yoco holds this payment and FAVO does not." },
    { kind: "tip", line: 6, yocoPaymentId: "yp_t", paymentId: "p1", orderId: "order-abcdef123", amountZar: 2500, detail: "A tip came through the machine." },
  ],
  info: [{ kind: "retail", line: 12, yocoPaymentId: "yp_cups", amountZar: 0, orderId: null }],
  missingFromYoco: [{ paymentId: "p9", orderId: "order-99999999", fundTopupId: null, yocoPaymentId: "yp_9", amountZar: 2000 }],
  rowKeys: [],
};

// CHANGED (T10 finishing: tip clearing, REQ-120 payout, §7.0.4 fee flag): the
// view carries four new fields; the helper defaults them to "nothing to show".
// CHANGED (review item 1): feeRate has no "not configured" state any more (no
// row means 265), so the quiet default is "not applicable".
function view(over: Partial<T10View> = {}): T10View {
  return {
    revenueDay: "2026-08-16", latestImport: IMPORT, writeOffs: [],
    clearedTipPaymentIds: [], payouts: [], defaultDeviceId: "dev-khumo", feeRate: { state: "not_applicable", count: 0 },
    ...over,
  };
}

const line = (check: PayoutLine["check"], clearedTipCount = 0): PayoutLine => payoutLine("2026-08-17T07:00:00.000Z", check, clearedTipCount, null);

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

  describe("DEC-17: clearing a tip", () => {
    const withheld = { ...IMPORT, exceptions: [{ ...IMPORT.exceptions[1], withheld: { feeZar: 66, receiptNo: "2637" } }] };

    it("offers Clear tip beside a tip row whose fee is withheld", () => {
      render(<T10Panel view={view({ latestImport: withheld })} />);
      expect(screen.getAllByRole("button", { name: "Clear tip" })).toHaveLength(1);
    });

    it("a cleared tip says so and offers nothing", () => {
      const { container } = render(<T10Panel view={view({ latestImport: withheld, clearedTipPaymentIds: ["p1"] })} />);
      expect(container.textContent).toContain("Cleared by an Admin.");
      expect(screen.queryByRole("button", { name: "Clear tip" })).toBeNull();
    });

    it("an import from before clearing existed asks for a re-upload instead", () => {
      const { container } = render(<T10Panel view={view()} />);
      expect(container.textContent).toContain("Upload this day's export again to clear this tip.");
      expect(screen.queryByRole("button", { name: "Clear tip" })).toBeNull();
    });
  });

  describe("REQ-120: the payout check", () => {
    it("offers the payout form, defaulting to the configured device", () => {
      render(<T10Panel view={view()} />);
      expect(screen.getByRole("button", { name: "Check payout" })).toBeTruthy();
      expect((screen.getByLabelText("Card machine (device id)") as HTMLInputElement).value).toBe("dev-khumo");
    });

    it("OK, a variance (an open item) and UNAVAILABLE naming the count", () => {
      const { container } = render(
        <T10Panel
          view={view({
            payouts: [
              line({ state: "ok", deviceId: "dev-a", payoutZar: 34073, expectedZar: 34073, differenceZar: 0, count: 13 }),
              line({ state: "variance", deviceId: "dev-b", payoutZar: 34573, expectedZar: 34073, differenceZar: 500, count: 13 }),
              line({ state: "unavailable", deviceId: "dev-c", payoutZar: 100, missingFee: 2, missingCharged: 0, count: 3 }),
            ],
          })}
        />
      );
      const text = container.textContent ?? "";
      expect(text).toContain("Yoco payout check (2 open)");
      expect(text).toMatch(/Device dev-a · payout R\s?340,73 · 13 card payments · charges less fees R\s?340,73 · matches\./);
      expect(text).toMatch(/Device dev-b .* difference \+R\s?5,00/);
      expect(text).toContain("Device dev-c");
      expect(text).toContain("UNAVAILABLE: 2 without a fee yet.");
    });

    const tipped = { state: "variance", deviceId: "dev-b", payoutZar: 34573, expectedZar: 34073, differenceZar: 500, count: 13 } as const;

    // CHANGED (review, DEC-17 strictly): no tip figure exists, so a cleared tip
    // never closes a line by itself — it flags it, and it stays open.
    it("a positive variance on a device with a cleared tip: 'may be a cleared tip: Admin to confirm', warn colour, still open", () => {
      const { container } = render(<T10Panel view={view({ payouts: [line(tipped, 1)] })} />);
      const text = container.textContent ?? "";
      expect(text).toContain("Yoco payout check (1 open)");
      expect(text).toMatch(/Device dev-b · payout R\s?345,73 .* charges less fees R\s?340,73 · difference \+R\s?5,00/);
      expect(text).toContain("difference may be a cleared tip: Admin to confirm");
      expect(screen.getByText(/may be a cleared tip/).getAttribute("style")).toContain("--status-warn");
      expect(container.innerHTML).not.toMatch(/status-success|color-success/);
      expect(screen.getAllByRole("button", { name: "Confirm difference" })).toHaveLength(1);
    });

    it("an Admin's confirmation closes the line: figures and reason still shown, nothing to confirm", () => {
      const confirmation = { reason: "Slip shows a tip", payoutZar: 34573, expectedZar: 34073, at: "2026-08-17T08:00:00.000Z" };
      const closed = payoutLine("2026-08-17T07:00:00.000Z", tipped, 1, confirmation);
      const { container } = render(<T10Panel view={view({ payouts: [closed] })} />);
      expect(container.textContent).toContain("Yoco payout check (0 open)");
      expect(container.textContent).toMatch(/difference \+R\s?5,00 · confirmed by an Admin \(closed\): Slip shows a tip/);
      expect(screen.queryByRole("button", { name: "Confirm difference" })).toBeNull();
    });
  });

  describe("§7.0.4: the fee-rate flag", () => {
    // CHANGED (review item 1): replaces "not configured → nothing shown".
    it("checked against 265 bp when no row exists: the line always shows", () => {
      const { container } = render(
        <T10Panel view={view({ feeRate: { state: "within_band", expectedBp: 265, realisedTenthsBp: 2649, count: 13, grossZar: 35000, feeZar: 927 } })} />
      );
      expect(container.textContent).toContain("realised 264.9 bp against an expected 265 bp, within ±15 bp");
    });

    it("an anomaly is an informational line naming realised against expected", () => {
      const { container } = render(
        <T10Panel view={view({ feeRate: { state: "anomaly", expectedBp: 245, realisedTenthsBp: 2649, count: 13, grossZar: 35000, feeZar: 927 } })} />
      );
      expect(container.textContent).toContain("anomaly — realised 264.9 bp against an expected 245 bp (band ±15 bp)");
    });

    it("fewer than ten card payments → not applicable", () => {
      const { container } = render(<T10Panel view={view({ feeRate: { state: "not_applicable", count: 0 } })} />);
      expect(container.textContent).toContain("not applicable — 0 card payments (needs at least 10)");
    });
  });

  it("a confirmed item shows closed, on its own day only", () => {
    const { container } = render(
      <T10Panel view={view({ writeOffs: [{ ...base, orderId: "o-done", revenueDay: "2026-08-16", confirmedNoPayment: true, status: "confirmed_no_payment", open: false }] })} />
    );
    expect(container.textContent).toContain("Admin confirmed: no Yoco payment (closed)");
    expect(container.textContent).toContain("(0 open)");
  });
});
