// AT-202 part 1 — the order view prices a line with its per-unit extra-shot
// surcharge (§7.0.2 line_unit_price = unit + mods + surcharge_zar) and shows
// the shot count. PRD fixture: a quantity-2 cappuccino line at 3 shots on a
// Sunday, R20.00 base, is R60.00 — the surcharge is per unit.

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/server/actions/orders", () => ({ transitionOrder: vi.fn(), cancelOrder: vi.fn(), declineFreeCoffee: vi.fn() }));

import ActiveOrder from "@/components/pos/ActiveOrder";
import { formatZar } from "@/lib/format";
import type { Order } from "@/lib/types";

const ORDER: Order = {
  id: "ord_7", customerId: null, customerName: null, staffId: "staff_louis",
  state: "ordered", placedAt: "2026-10-11T07:00:00Z", completedAt: null,
  totalZar: 6000, isStaffDiscount: false, paymentStatus: "pending",
  items: [{
    id: "oi_7", menuItemId: "menu_cappuccino", menuItemName: "Cappuccino",
    quantity: 2, unitPriceZar: 2000, modifications: [], discountZar: 0, shots: 3, surchargeZar: 1000,
  }],
};

describe("ActiveOrder — shots (AT-202)", () => {
  it("a quantity-2 line at 3 shots reads '3 shots' at R60.00", () => {
    render(<ActiveOrder order={ORDER} />);
    expect(screen.getByText("3 shots")).toBeDefined();
    const spans = [...document.querySelectorAll("span")].filter((s) => s.textContent?.trim() === formatZar(6000));
    // The line price and the order total both read R60.00.
    expect(spans.length).toBeGreaterThanOrEqual(2);
  });
});
