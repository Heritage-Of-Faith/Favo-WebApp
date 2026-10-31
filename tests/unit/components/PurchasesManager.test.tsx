// PurchasesManager — QA r1-admin P2h: a 400-character source pushed the
// Kind / Total / Status columns off screen.
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import PurchasesManager from "@/components/admin/PurchasesManager";

vi.mock("@/server/actions/purchases", () => ({
  listPurchases: vi.fn(),
  approveEmergencyPurchase: vi.fn(),
  recordPurchase: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

describe("PurchasesManager source cell", () => {
  it("truncates a long source and keeps the full text in the title", () => {
    const long = "S".repeat(400);
    render(
      <PurchasesManager
        canApprove
        items={[]}
        initialPurchases={[
          { id: "p1", sourceName: long, receivedAt: "2026-10-26T08:00:00.000Z", totalZar: 22500, kind: "planned", status: "active", adminApprovedBy: null },
        ]}
      />
    );
    const cell = screen.getByText(long);
    expect(cell.getAttribute("title")).toBe(long);
    expect(cell.className).toContain("truncate");
    expect(cell.className).toContain("max-w-[16rem]");
    // QA R5-5: max-width on a <td> does not bind in an auto-layout table, so the
    // truncation lives on a block element inside the cell.
    expect(cell.tagName).toBe("SPAN");
    expect(cell.className).toContain("block");
  });
});
