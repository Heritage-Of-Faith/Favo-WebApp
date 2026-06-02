"use client";

// Customer search + select — owner: Mine (M2)
// Debounced ILIKE search via searchCustomer action.
// Barista can skip (guest order) or select a customer for loyalty tracking.
// Docs: docs/API.md → searchCustomer · docs/DESIGN.md → POS Rules

import { useState, useEffect, useRef, useCallback } from "react";
import { Search, X, User, Star } from "lucide-react";
import { searchCustomer } from "@/server/actions/customers";
import type { Customer } from "@/lib/types";

const DEBOUNCE_MS = 320;

export type Props = {
  onSelect: (customer: Customer | null) => void;
  /** Pre-selected customer (controlled) */
  selected?: Customer | null;
};

export default function CustomerSearch({ onSelect, selected = null }: Props) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const search = useCallback(async (q: string) => {
    if (q.trim().length < 2) {
      setResults([]);
      setOpen(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await searchCustomer(q);
      if (result.ok) {
        setResults(result.data);
        setOpen(true);
      } else {
        setError(result.message);
        setResults([]);
      }
    } catch {
      setError("Search failed. Please try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => search(query), DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, search]);

  const handleSelect = (customer: Customer) => {
    onSelect(customer);
    setQuery("");
    setResults([]);
    setOpen(false);
  };

  const handleClear = () => {
    onSelect(null);
    setQuery("");
    setResults([]);
    setOpen(false);
    inputRef.current?.focus();
  };

  // ── If a customer is selected, show the selection chip ──────────────────────
  if (selected) {
    return (
      <div
        className="flex items-center justify-between gap-[var(--spacing-m)] rounded-[var(--radius-btn)] border border-cool-steel/30 bg-porcelain/10 px-[var(--spacing-m)] py-[var(--spacing-s)]"
        role="status"
        aria-label={`Customer selected: ${selected.name}`}
      >
        <div className="flex items-center gap-[var(--spacing-s)]">
          <User size={16} strokeWidth={2.25} className="text-cool-steel shrink-0" />
          <div>
            <p className="favo-subhead text-porcelain leading-tight">{selected.name}</p>
            {selected.phone && (
              <p className="favo-small text-cool-steel">{selected.phone}</p>
            )}
          </div>
          {selected.loyaltyPoints > 0 && (
            <span className="ml-[var(--spacing-s)] flex items-center gap-1 rounded-[var(--radius-pill)] bg-crimson-carrot/10 px-[var(--spacing-s)] py-px">
              <Star size={10} strokeWidth={2.25} className="text-crimson-carrot" />
              <span className="favo-caption text-crimson-carrot">
                {selected.loyaltyPoints} pts
              </span>
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={handleClear}
          aria-label="Remove selected customer"
          className="flex h-[44px] w-[44px] items-center justify-center rounded-[var(--radius-btn)] text-cool-steel transition-colors hover:bg-porcelain/20 hover:text-porcelain focus-visible:outline focus-visible:outline-2 focus-visible:outline-crimson-carrot"
        >
          <X size={16} strokeWidth={2.25} />
        </button>
      </div>
    );
  }

  return (
    <div className="relative w-full">
      {/* Search input */}
      <label htmlFor="customer-search" className="favo-label text-cool-steel block mb-[var(--spacing-xs)]">
        Customer (optional)
      </label>
      <div className="relative flex items-center">
        <Search
          size={16}
          strokeWidth={2.25}
          className="pointer-events-none absolute left-[var(--spacing-m)] text-cool-steel"
        />
        <input
          ref={inputRef}
          id="customer-search"
          type="search"
          inputMode="text"
          autoComplete="off"
          placeholder="Search by name or phone…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => results.length > 0 && setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          className={[
            "w-full rounded-[var(--radius-btn)] border bg-porcelain/10 py-[var(--spacing-s)]",
            "pl-10 pr-[var(--spacing-m)] text-porcelain placeholder:text-cool-steel",
            "favo-body transition-colors duration-[var(--dur-fast)]",
            "border-cool-steel/30 focus:border-crimson-carrot focus:outline-none",
            "min-h-[44px]",
          ].join(" ")}
          aria-autocomplete="list"
          aria-controls="customer-results"
          aria-expanded={open}
        />
        {loading && (
          <span className="absolute right-[var(--spacing-m)] text-cool-steel animate-pulse favo-small">
            …
          </span>
        )}
      </div>

      {/* Error */}
      {error && (
        <p className="favo-small text-[var(--color-error)] mt-[var(--spacing-xs)]" role="alert">
          {error}
        </p>
      )}

      {/* Results dropdown */}
      {open && results.length > 0 && (
        <ul
          id="customer-results"
          role="listbox"
          aria-label="Customer search results"
          className="absolute z-50 mt-1 w-full overflow-hidden rounded-[var(--radius-card)] border border-cool-steel/20 bg-dark-teal shadow-[var(--shadow-2)]"
        >
          {results.map((customer) => (
            <li key={customer.id} role="option" aria-selected={false}>
              <button
                type="button"
                onMouseDown={() => handleSelect(customer)}
                className={[
                  "flex w-full items-center justify-between px-[var(--spacing-m)] py-[var(--spacing-s)]",
                  "min-h-[44px] text-left transition-colors duration-[var(--dur-fast)]",
                  "hover:bg-porcelain/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-crimson-carrot",
                ].join(" ")}
              >
                <div>
                  <p className="favo-subhead text-porcelain leading-snug">{customer.name}</p>
                  {customer.phone && (
                    <p className="favo-small text-cool-steel">{customer.phone}</p>
                  )}
                </div>
                {customer.loyaltyPoints > 0 && (
                  <span className="flex items-center gap-1 rounded-[var(--radius-pill)] bg-crimson-carrot/10 px-[var(--spacing-s)] py-px">
                    <Star size={10} strokeWidth={2.25} className="text-crimson-carrot" />
                    <span className="favo-caption text-crimson-carrot">
                      {customer.loyaltyPoints} pts
                    </span>
                  </span>
                )}
              </button>
            </li>
          ))}
          {/* Skip / guest option */}
          <li role="option" aria-selected={false}>
            <button
              type="button"
              onMouseDown={() => handleClear()}
              className={[
                "flex w-full items-center gap-[var(--spacing-s)] px-[var(--spacing-m)] py-[var(--spacing-s)]",
                "min-h-[44px] border-t border-cool-steel/20 text-cool-steel",
                "transition-colors hover:bg-porcelain/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-crimson-carrot",
              ].join(" ")}
            >
              <X size={14} strokeWidth={2.25} />
              <span className="favo-small">Continue as guest</span>
            </button>
          </li>
        </ul>
      )}
    </div>
  );
}
