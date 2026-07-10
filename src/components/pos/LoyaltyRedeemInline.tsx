"use client";

/**
 * LoyaltyRedeemInline — AT-140 (rebuild of AT-110's redemption control).
 *
 * Per the ticket's locked clarification: the redemption logic and interaction
 * model (a +/- stepper of R20 units, defaulting to 0/not-redeemed until the
 * barista opts in) are unchanged from AT-110/M18 — this only relocates the
 * control from a floating side dialog into the fixed cart region it lives in,
 * so it reads as part of the order, not an interruption.
 *
 * Collapsed: a single trigger button. Tapping it expands the stepper inline
 * (no backdrop, no overlay) in the same card; Cancel collapses it back to the
 * trigger without calling the server.
 */

import { useCallback, useState } from "react";
import { Loader2, Star, Minus, Plus } from "lucide-react";
import { toast } from "sonner";
import { redeemLoyalty } from "@/server/actions/loyalty";
import { formatLoyaltyBalance } from "@/server/loyalty/calc";

const REDEEM_POINTS_UNIT = 100;
const REDEEM_VALUE_ZAR = 2000; // R20 in cents — display only; server is source of truth.

export type RedeemResult = {
  pointsUsed: number;
  discountZar: number;
  newTotalZar: number;
};

export type Props = {
  customerId: string;
  customerName: string;
  orderId: string;
  loyaltyPoints: number;
  orderTotalZar: number;
  onRedeemed: (result: RedeemResult) => void;
};

export default function LoyaltyRedeemInline({
  customerId, customerName, orderId, loyaltyPoints, orderTotalZar, onRedeemed,
}: Props) {
  const maxUnits = Math.min(
    Math.floor(loyaltyPoints / REDEEM_POINTS_UNIT),
    Math.floor(orderTotalZar / REDEEM_VALUE_ZAR),
  );

  const [expanded, setExpanded] = useState(false);
  const [units, setUnits] = useState(1);
  const [submitting, setSubmitting] = useState(false);

  const discountZar = units * REDEEM_VALUE_ZAR;
  const pointsUsed = units * REDEEM_POINTS_UNIT;
  const newTotalZar = orderTotalZar - discountZar;
  const newPoints = loyaltyPoints - pointsUsed;

  const confirm = useCallback(async () => {
    if (submitting) return;
    setSubmitting(true);
    const r = await redeemLoyalty(customerId, orderId, units).catch(() => ({
      ok: false as const, code: "ERR", message: "Could not redeem points.",
    }));
    setSubmitting(false);
    if (r.ok) {
      toast.success(`${r.data.pointsUsed} pts redeemed — R${(r.data.discountZar / 100).toFixed(0)} off`);
      onRedeemed({ pointsUsed: r.data.pointsUsed, discountZar: r.data.discountZar, newTotalZar: r.data.newTotalZar });
      // No need to reset `expanded` — the parent stops rendering this
      // component once redemption succeeds (redeemedData !== null).
    } else {
      toast.error(r.message);
    }
  }, [submitting, customerId, orderId, units, onRedeemed]);

  if (maxUnits < 1) return null;

  if (!expanded) {
    return (
      <button type="button" onClick={() => { setUnits(1); setExpanded(true); }}
        className="flex w-full items-center justify-center gap-2 rounded-[4px] border border-crimson-carrot/50 py-3 min-h-[48px] favo-small text-crimson-carrot hover:bg-crimson-carrot/8 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-crimson-carrot">
        <Star size={14} strokeWidth={2.25} />
        Redeem loyalty points
      </button>
    );
  }

  return (
    <div className="rounded-[var(--radius-card)] border border-crimson-carrot/40 bg-coffee-bean/5 px-4 py-3 flex flex-col gap-3">
      <p className="favo-small text-coffee-bean">
        {customerName} · <span className="text-crimson-carrot font-bold">{formatLoyaltyBalance(loyaltyPoints)}</span> available
      </p>

      {/* Units stepper — unchanged from AT-110 */}
      <div className="flex items-center justify-between rounded-[2px] border border-cool-steel/30 bg-coffee-bean/5 px-3 py-2">
        <button type="button" onClick={() => setUnits((u) => Math.max(1, u - 1))}
          disabled={submitting || units <= 1} aria-label="Decrease units"
          className="flex h-9 w-9 items-center justify-center rounded-[var(--radius-btn)] border border-cool-steel/30 text-coffee-bean hover:bg-coffee-bean/8 disabled:opacity-30">
          <Minus size={14} strokeWidth={2.25} />
        </button>
        <div className="text-center">
          <p className="favo-subhead text-coffee-bean tabular-nums leading-none">{units}</p>
          <p className="favo-caption text-cool-steel mt-1">{units === 1 ? "unit" : "units"} · max {maxUnits}</p>
        </div>
        <button type="button" onClick={() => setUnits((u) => Math.min(maxUnits, u + 1))}
          disabled={submitting || units >= maxUnits} aria-label="Increase units"
          className="flex h-9 w-9 items-center justify-center rounded-[var(--radius-btn)] border border-cool-steel/30 text-coffee-bean hover:bg-coffee-bean/8 disabled:opacity-30">
          <Plus size={14} strokeWidth={2.25} />
        </button>
      </div>

      {/* Discount breakdown */}
      <div className="flex flex-col gap-1 favo-caption text-cool-steel">
        <div className="flex justify-between">
          <span>Discount</span>
          <span className="text-crimson-carrot font-bold">−R{(discountZar / 100).toFixed(0)}</span>
        </div>
        <div className="flex justify-between">
          <span>New total</span>
          <span className="text-coffee-bean font-bold">
            {newTotalZar === 0 ? "R0 (free)" : `R${(newTotalZar / 100).toFixed(0)}`}
          </span>
        </div>
        <div className="flex justify-between">
          <span>Points after</span>
          <span>{newPoints} pts</span>
        </div>
      </div>

      <div className="flex gap-2">
        <button type="button" onClick={() => setExpanded(false)} disabled={submitting}
          className="flex-1 rounded-[var(--radius-btn)] border border-cool-steel/30 py-2.5 min-h-[44px] favo-small text-coffee-bean hover:bg-coffee-bean/8 disabled:opacity-40">
          Cancel
        </button>
        <button type="button" onClick={confirm} disabled={submitting}
          className="flex flex-[1.4] items-center justify-center gap-2 rounded-[var(--radius-btn)] py-2.5 min-h-[44px] favo-small font-bold uppercase disabled:opacity-40"
          style={{ background: "var(--color-crimson-carrot)", color: "var(--color-porcelain)", letterSpacing: "var(--tracking-cta)" }}>
          {submitting
            ? <Loader2 size={14} strokeWidth={2.25} className="animate-spin" />
            : <>Redeem R{(discountZar / 100).toFixed(0)} off</>}
        </button>
      </div>
    </div>
  );
}
