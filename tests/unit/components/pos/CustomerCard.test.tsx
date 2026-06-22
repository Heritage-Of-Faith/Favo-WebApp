// Unit tests for M18 — CustomerCard display

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import CustomerCard from "@/components/pos/CustomerCard";
import type { Customer } from "@/lib/types";

const CUST: Customer = { id: "c1", name: "Thandeka", phone: null, email: null, loyaltyPoints: 145, walletZar: 0, activePackCount: 0 };

describe("CustomerCard", () => {
  it("always shows name and loyalty points", () => {
    render(<CustomerCard customer={CUST} />);
    expect(screen.getByText("Thandeka")).toBeDefined();
    expect(screen.getByText(/145 pts/)).toBeDefined();
  });

  it("shows wallet balance only when supplied", () => {
    const { rerender } = render(<CustomerCard customer={CUST} />);
    expect(screen.queryByText(/R/)).toBeNull();
    rerender(<CustomerCard customer={CUST} walletBalanceZar={5000} />);
    expect(screen.getByText(/50,00/)).toBeDefined();
  });

  it("shows pack count only when > 0", () => {
    const { rerender } = render(<CustomerCard customer={CUST} activePackCount={0} />);
    expect(screen.queryByText(/pack/i)).toBeNull();
    rerender(<CustomerCard customer={CUST} activePackCount={2} />);
    expect(screen.getByText(/2 packs/)).toBeDefined();
  });

  it("fires onClear when the remove button is clicked", () => {
    const onClear = vi.fn();
    render(<CustomerCard customer={CUST} onClear={onClear} />);
    fireEvent.click(screen.getByRole("button", { name: /remove customer/i }));
    expect(onClear).toHaveBeenCalledOnce();
  });
});
