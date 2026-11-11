"use client";

/**
 * FundChips — the footer's "pays" row: the blessing-fund tender chips
 * (PRD v7.0 §6.10.6, §6.2.4c, REQ-164, REQ-169, REQ-170, L48).
 *
 *   · at most two chips: the bound person's linked fund, and ONE open-fund chip
 *     naming the fund FAVO will draw from (oldest unspent gift), "+N" for the
 *     ones behind it — `Thandeka's group · R180`, `Blessing fund · Louis M. · R340 · +4`
 *   · a radio, not a reveal: one is lit; a tap on the other switches; a tap on
 *     the lit one turns it off and the order goes to the card
 *   · a linked fund that cannot cover the order is shown with its balance and
 *     is not tappable (§6.10.5); an open fund that cannot cover is never offered
 *     (the server leaves it out)
 *   · nothing at all when no fund applies (L48) — the caller also never asks
 *     for options on an order with no net charge
 *
 * Presentational only: the options come from fundOptionsForOrder, and the
 * draw itself is createOrder's (donorFundId) — never a payments row (L47).
 */

import { formatZar } from "@/lib/format";
import type { FundOptions } from "@/server/funds/funds";

export type Props = {
  options: FundOptions;
  /** The fund the order will be paid from; null = the card. */
  selectedFundId: string | null;
  onSelect: (fundId: string | null) => void;
};

export function linkedChipLabel(c: NonNullable<FundOptions["linked"]>): string {
  return `${c.displayName ?? c.code} · ${formatZar(c.balanceZar)}`;
}

export function openChipLabel(c: NonNullable<FundOptions["open"]>): string {
  return `Blessing fund · ${c.displayName ?? c.code} · ${formatZar(c.balanceZar)}${c.behind > 0 ? ` · +${c.behind}` : ""}`;
}

const chip = (lit: boolean) =>
  [
    "flex min-h-11 items-center rounded-[999px] border px-3 favo-caption transition-colors disabled:opacity-40",
    lit ? "border-crimson-carrot bg-crimson-carrot/10 text-coffee-bean font-semibold" : "border-cool-steel/30 text-cool-steel hover:bg-coffee-bean/8",
  ].join(" ");

export default function FundChips({ options, selectedFundId, onSelect }: Props) {
  const { linked, open } = options;
  if (!linked && !open) return null;
  const toggle = (id: string) => onSelect(selectedFundId === id ? null : id);
  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label="pays" data-fund-chips>
      <span className="favo-label text-cool-steel">pays</span>
      {linked && (
        <button type="button" data-fund-chip="linked" aria-pressed={selectedFundId === linked.fundId}
          disabled={!linked.canCover} onClick={() => toggle(linked.fundId)} className={chip(selectedFundId === linked.fundId)}>
          {linkedChipLabel(linked)}
        </button>
      )}
      {open && (
        <button type="button" data-fund-chip="open" aria-pressed={selectedFundId === open.fundId}
          onClick={() => toggle(open.fundId)} className={chip(selectedFundId === open.fundId)}>
          {openChipLabel(open)}
        </button>
      )}
    </div>
  );
}
