// QA R6-3: a long purchase source must wrap inside the stock-take card.
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import StockTakeCounter from "@/components/admin/StockTakeCounter";
import type { StockTakeLine } from "@/lib/types";

describe("StockTakeCounter — long source name", () => {
  it("renders the source with break-words so it stays inside the card", () => {
    const source = "L".repeat(80);
    const line = {
      id: "stl_1", inventoryItemName: "Espresso Beans", lotSourceName: source,
      lotReceivedAt: null, roastDate: null, counted: null, unit: "g", itemKind: "bean",
    } as unknown as StockTakeLine;
    render(
      <StockTakeCounter line={line} index={0} total={1} saving={false} canBack={false}
        onSave={vi.fn()} onSkip={vi.fn()} onBack={vi.fn()} />
    );
    expect(screen.getByText(source).className).toMatch(/\bbreak-words\b/);
  });
});
