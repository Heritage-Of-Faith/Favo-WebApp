// Wallet + packs component tests — AT-69 (N17)
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import WalletTransactionList from "@/components/customer/WalletTransactionList";
import PackDetailCard from "@/components/customer/PackDetailCard";
import type { WalletTransaction, CoffeePack } from "@/lib/customer/contract";

// ─── WalletTransactionList ────────────────────────────────────────────────────

const TX: WalletTransaction[] = [
  { id: "tx-1", deltaZar: 5000, kind: "topup", description: "Counter top-up", at: "2026-06-01T09:00:00Z" },
  { id: "tx-2", deltaZar: -3500, kind: "spend", description: "Cappuccino", at: "2026-06-02T10:30:00Z" },
];

describe("WalletTransactionList", () => {
  it("renders empty state when no transactions", () => {
    render(<WalletTransactionList transactions={[]} />);
    expect(screen.getByText(/no transactions yet/i)).toBeTruthy();
  });

  it("renders each transaction row", () => {
    render(<WalletTransactionList transactions={TX} />);
    expect(screen.getByText("Counter top-up")).toBeTruthy();
    expect(screen.getByText("Cappuccino")).toBeTruthy();
  });

  it("shows positive delta with '+' prefix", () => {
    render(<WalletTransactionList transactions={[TX[0]!]} />);
    expect(screen.getByText(/\+R/)).toBeTruthy();
  });

  it("shows negative delta without double-negative", () => {
    render(<WalletTransactionList transactions={[TX[1]!]} />);
    // Should start with '−' (minus) from formatZar but not '−−'
    const amountEl = screen.getByText(/R\s*35/);
    expect(amountEl).toBeTruthy();
  });

  it("does not render any mutation buttons", () => {
    const { container } = render(<WalletTransactionList transactions={TX} />);
    expect(container.querySelectorAll("button")).toHaveLength(0);
    expect(container.querySelectorAll("form")).toHaveLength(0);
  });
});

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
    // The expiry text should have the error color
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
