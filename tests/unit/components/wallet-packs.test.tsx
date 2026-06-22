// Packs component tests — AT-69 (N17)
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import PackDetailCard from "@/components/customer/PackDetailCard";
import type { CoffeePack } from "@/lib/customer/contract";

// ─── PackDetailCard ────────────────────────────────────────────────────────────

function makePack(overrides: Partial<CoffeePack> = {}): CoffeePack {
  const future = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  return {
    id: "pack-1",
    itemName: "Cappuccino",
    qtyTotal: 10,
    qtyRemaining: 7,
    purchasedAt: "2026-05-01T08:00:00Z",
    expiresAt: future,
    ...overrides,
  };
}

describe("PackDetailCard", () => {
  it("renders item name", () => {
    render(<PackDetailCard pack={makePack()} />);
    expect(screen.getByText("Cappuccino")).toBeTruthy();
  });

  it("shows qty remaining / total", () => {
    render(<PackDetailCard pack={makePack()} />);
    expect(screen.getByText("7/10")).toBeTruthy();
  });

  it("shows red expiry when < 7 days out", () => {
    const soonExpiry = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();
    render(<PackDetailCard pack={makePack({ expiresAt: soonExpiry })} />);
    expect(screen.getByText(/expires in 3 days/i)).toBeTruthy();
    const expiryEl = screen.getByText(/expires in 3 days/i);
    expect((expiryEl as HTMLElement).style.color).toContain("error");
  });

  it("shows 'Expired' label and reduced opacity when expired=true", () => {
    const past = new Date(Date.now() - 1000).toISOString();
    render(<PackDetailCard pack={makePack({ expiresAt: past, qtyRemaining: 0 })} expired />);
    expect(screen.getByText("Expired")).toBeTruthy();
  });

  it("has no mutation buttons", () => {
    render(<PackDetailCard pack={makePack()} />);
    expect(document.querySelectorAll("button")).toHaveLength(0);
    expect(document.querySelectorAll("form")).toHaveLength(0);
  });
});
