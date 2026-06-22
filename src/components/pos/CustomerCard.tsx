"use client";

/**
 * CustomerCard — task M18 (extends the M2 customer selection).
 *
 * Shows the attached customer's loyalty standing at a glance: loyalty points
 * always, plus wallet balance and active-pack count when available.
 * `walletBalanceZar` and `activePackCount` are optional so callers that only
 * have partial data don't need to supply everything.
 */

import { Star, Wallet, Package, X } from "lucide-react";
import { formatZar } from "@/lib/format";
import type { Customer } from "@/lib/types";

export type Props = {
  customer: Customer;
  /** Optional — only rendered when supplied (see backend-gap note above). */
  walletBalanceZar?: number;
  activePackCount?: number;
  onClear?: () => void;
};

export default function CustomerCard({ customer, walletBalanceZar, activePackCount, onClear }: Props) {
  return (
    <div className="flex items-center gap-3 rounded-[var(--radius-btn)] border border-crimson-carrot/30 bg-crimson-carrot/8 px-3 py-2">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-crimson-carrot/15">
        <Star size={14} strokeWidth={2.25} className="text-crimson-carrot" />
      </div>

      <div className="min-w-0 flex-1">
        <p className="favo-small font-semibold text-coffee-bean truncate">{customer.name}</p>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
          <span className="favo-caption text-crimson-carrot">
            {customer.loyaltyPoints} pts
          </span>
          {typeof walletBalanceZar === "number" && (
            <span className="favo-caption text-cool-steel flex items-center gap-1">
              <Wallet size={10} strokeWidth={2.25} aria-hidden /> {formatZar(walletBalanceZar)}
            </span>
          )}
          {typeof activePackCount === "number" && activePackCount > 0 && (
            <span className="favo-caption text-cool-steel flex items-center gap-1">
              <Package size={10} strokeWidth={2.25} aria-hidden /> {activePackCount} pack{activePackCount === 1 ? "" : "s"}
            </span>
          )}
        </div>
      </div>

      {onClear && (
        <button type="button" onClick={onClear} aria-label="Remove customer"
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[var(--radius-btn)] text-cool-steel hover:bg-coffee-bean/8 hover:text-coffee-bean">
          <X size={14} strokeWidth={2.25} />
        </button>
      )}
    </div>
  );
}
