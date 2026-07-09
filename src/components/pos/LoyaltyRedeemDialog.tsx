"use client";

/**
 * LoyaltyRedeemDialog — AT-110 (multi-unit stepper).
 *
 * Replaces the single-unit confirm dialog with a +/− stepper that lets the
 * barista choose 1–maxUnits of 100-pt units (each = R20 off). The client
 * computes maxUnits for UI display only; the server clamps authoratively in
 * `redeemLoyalty`. Rules: L06, L17.
 */

import { useState, useCallback } from "react";
import { X, Loader2, Star, Minus, Plus } from "lucide-react";
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
  onClose: () => void;
};

export default function LoyaltyRedeemDialog({
  customerId, customerName, orderId, loyaltyPoints, orderTotalZar, onRedeemed, onClose,
}: Props) {
  const maxUnits = Math.min(
    Math.floor(loyaltyPoints / REDEEM_POINTS_UNIT),
    Math.floor(orderTotalZar / REDEEM_VALUE_ZAR),
  );

  const [units, setUnits] = useState(Math.min(1, maxUnits));
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
      onClose();
    } else {
      toast.error(r.message);
    }
  }, [submitting, customerId, orderId, units, onRedeemed, onClose]);

  if (maxUnits < 1) {
    return (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-coffee-bean/60 px-4"
        onClick={(e) => e.target === e.currentTarget && onClose()}
        role="dialog" aria-modal="true" aria-label="Redeem loyalty points"
      >
        <div className="w-full max-w-[360px] rounded-[var(--radius-card)] border border-cool-steel/20 bg-dark-teal shadow-[var(--shadow-2)] px-5 py-6 flex flex-col gap-4">
          <p className="favo-small text-porcelain">Cannot redeem — insufficient points or order total too low.</p>
          <button type="button" onClick={onClose}
            className="rounded-[var(--radius-btn)] border border-cool-steel/30 py-3 min-h-[48px] favo-small text-porcelain hover:bg-porcelain/10">
            Close
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-coffee-bean/60 px-4"
      onClick={(e) => e.target === e.currentTarget && !submitting && onClose()}
      role="dialog" aria-modal="true" aria-label="Redeem loyalty points"
    >
      <div className="w-full max-w-[360px] rounded-[var(--radius-card)] border border-cool-steel/20 bg-dark-teal shadow-[var(--shadow-2)]">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-cool-steel/20 px-5 py-3">
          <div className="flex items-center gap-2">
            <Star size={16} strokeWidth={2.25} className="text-crimson-carrot" />
            <h2 className="favo-h3 text-porcelain leading-tight">Redeem points</h2>
          </div>
          <button type="button" onClick={onClose} disabled={submitting} aria-label="Close"
            className="flex h-9 w-9 items-center justify-center rounded-[var(--radius-btn)] text-cool-steel hover:bg-porcelain/10 hover:text-porcelain disabled:opacity-40">
            <X size={16} strokeWidth={2.25} />
          </button>
        </div>

        <div className="px-5 py-4 flex flex-col gap-4">
          {/* Customer context */}
          <p className="favo-small text-porcelain">
            {customerName} · <span className="text-crimson-carrot font-bold">{formatLoyaltyBalance(loyaltyPoints)}</span> available
          </p>

          {/* Units stepper */}
          <div className="flex items-center justify-between rounded-[var(--radius-card)] border border-cool-steel/20 bg-coffee-bean/30 px-3 py-3">
            <button
              type="button"
              onClick={() => setUnits((u) => Math.max(1, u - 1))}
              disabled={submitting || units <= 1}
              aria-label="Decrease units"
              className="flex h-11 w-11 items-center justify-center rounded-[var(--radius-btn)] border border-cool-steel/30 text-porcelain hover:bg-porcelain/10 disabled:opacity-30 transition-opacity"
            >
              <Minus size={18} strokeWidth={2.5} />
            </button>

            <div className="text-center">
              <p className="text-3xl font-bold text-porcelain tabular-nums leading-none">{units}</p>
              <p className="favo-caption text-cool-steel mt-1">{units === 1 ? "unit" : "units"} · max {maxUnits}</p>
            </div>

            <button
              type="button"
              onClick={() => setUnits((u) => Math.min(maxUnits, u + 1))}
              disabled={submitting || units >= maxUnits}
              aria-label="Increase units"
              className="flex h-11 w-11 items-center justify-center rounded-[var(--radius-btn)] border border-cool-steel/30 text-porcelain hover:bg-porcelain/10 disabled:opacity-30 transition-opacity"
            >
              <Plus size={18} strokeWidth={2.5} />
            </button>
          </div>

          {/* Discount breakdown */}
          <div className="rounded-[var(--radius-card)] border border-cool-steel/20 bg-coffee-bean/20 px-4 py-3 flex flex-col gap-1.5">
            <div className="flex justify-between favo-small">
              <span className="text-cool-steel">Points used</span>
              <span className="text-porcelain font-semibold">{pointsUsed} pts</span>
            </div>
            <div className="flex justify-between favo-small">
              <span className="text-cool-steel">Discount</span>
              <span className="text-crimson-carrot font-bold">−R{(discountZar / 100).toFixed(0)}</span>
            </div>
            <div className="border-t border-cool-steel/20 pt-1.5 mt-0.5 flex justify-between favo-small">
              <span className="text-cool-steel">New total</span>
              <span className="text-porcelain font-bold">
                {newTotalZar === 0 ? "R0 (free)" : `R${(newTotalZar / 100).toFixed(0)}`}
              </span>
            </div>
            <div className="flex justify-between favo-caption text-cool-steel">
              <span>Points after</span>
              <span>{newPoints} pts</span>
            </div>
          </div>

          {/* Actions */}
          <div className="flex gap-2">
            <button type="button" onClick={onClose} disabled={submitting}
              className="flex-1 rounded-[var(--radius-btn)] border border-cool-steel/30 py-3 min-h-[48px] favo-small text-porcelain hover:bg-porcelain/10 disabled:opacity-40">
              Cancel
            </button>
            <button type="button" onClick={confirm} disabled={submitting}
              className="flex flex-[1.4] items-center justify-center gap-2 rounded-[var(--radius-btn)] bg-crimson-carrot py-3 min-h-[48px] transition-all hover:brightness-110 active:scale-[0.99] disabled:opacity-40"
              style={{ color: "var(--color-porcelain)", fontFamily: "var(--font-sans)", fontWeight: 700, fontSize: "var(--text-small)", letterSpacing: "var(--tracking-cta)", textTransform: "uppercase" }}>
              {submitting
                ? <Loader2 size={16} strokeWidth={2.25} className="animate-spin" />
                : <>Redeem R{(discountZar / 100).toFixed(0)} off</>}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
