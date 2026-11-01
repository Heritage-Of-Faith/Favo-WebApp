// AT-202 part 1 — customer order history carries each line's shots and
// per-unit extra-shot surcharge, so line prices add up to orders.total_zar.
// The history screen (OrderHistoryList) shows only the order total and a
// "qty× name" summary — no line prices — so the total it shows is the stored
// one. PRD fixture: a R20.00 cappuccino at 3 shots on a Sunday is R30.00.
// withCustomerScope is bypassed exactly as in customer-actions.test.ts.

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@db/index", () => ({ db: { select: vi.fn(), update: vi.fn(), insert: vi.fn() } }));
vi.mock("@/lib/db-rls", async () => {
  const { db } = await import("@db/index");
  return { withCustomerScope: (_id: string, fn: (tx: unknown) => unknown) => fn(db) };
});
vi.mock("@/server/audit", () => ({ writeAudit: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/server/auth/customer-session", () => ({ getCustomerSession: vi.fn().mockResolvedValue("cust_louis") }));

import { db } from "@db/index";
import { listCustomerOrders } from "@/server/actions/customer";
import { computeLineTotalZar } from "@/server/orders/pricing";
import OrderHistoryList from "@/components/customer/OrderHistoryList";
import { formatZar } from "@/lib/format";

function chain(rows: unknown[]) {
  const c: Record<string, unknown> = {};
  for (const m of ["from", "where", "orderBy", "leftJoin"]) c[m] = () => c;
  c.limit = async () => rows;
  c.then = (resolve: (v: unknown[]) => void) => resolve(rows);
  return c;
}

describe("listCustomerOrders — shots (AT-202)", () => {
  it("a Sunday 3-shot line: shots 3, surcharge 1000; line prices add up to the R30.00 total shown", async () => {
    vi.mocked(db.select)
      .mockReturnValueOnce(chain([
        { id: "ord-1", state: "collected", placedAt: new Date("2026-10-11T07:00:00Z"), completedAt: null, totalZar: 3000 },
      ]) as unknown as ReturnType<typeof db.select>)
      .mockReturnValueOnce(chain([
        { id: "oi-1", orderId: "ord-1", menuItemId: "mi-1", menuItemName: "Cappuccino", quantity: 1,
          unitPriceZar: 2000, modifications: [], shots: 3, surchargeZar: 1000 },
      ]) as unknown as ReturnType<typeof db.select>);

    const res = await listCustomerOrders();
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const order = res.data[0]!;
    expect(order.items[0]).toMatchObject({ shots: 3, surchargeZar: 1000 });
    expect(order.items.reduce((s, i) => s + computeLineTotalZar(i), 0)).toBe(3000);
    expect(order.totalZar).toBe(3000);

    render(<OrderHistoryList orders={res.data} />);
    expect(screen.getByText("1× Cappuccino")).toBeInTheDocument();
    const shown = [...document.querySelectorAll("span")].filter((s) => s.textContent === formatZar(3000));
    expect(shown).toHaveLength(1); // the order total — the screen shows no line prices
  });
});
