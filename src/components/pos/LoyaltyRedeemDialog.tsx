"use client";

/**
 * LoyaltyRedeemDialog — task M18.
 *
 * Full loyalty redemption only (rule L06): 100 points → R20 off, applied as a
 * whole-order zeroing. There is no partial-redemption path anywhere by design.
 *
 * Redemption operates on an order that already exists in the `ordered` state
 * (pre-payment) — `redeemLoyalty` validates that server-side and atomically
 * sets `order.totalZar = 0`, deducts exactly 100 points, and writes the audit
 * row. We surface this on the POS payment step, where the order id is known.
 */

import { useState, useCallback } from "react";
import { X, Loader2, Star } from "lucide-react";
import { toast } from "sonner";
import { redeemLoyalty } from "@/server/actions/loyalty";

const REDEEM_POINTS = 100;
const REDEEM_VALUE_ZAR = 2000; // R20,00 in cents — display only; server is source of truth.

export type Props = {
  customerId: string;
  customerName: string;
  orderId: string;
  /** Current points, for the confirmation copy and the optimistic decrement. */
  loyaltyPoints: number;
  /** Current order total in cents — passed by POSWorkspace. */
  orderTotalZar?: number;
  /** Called after a successful redeem so the caller can zero the order + drop 100 pts. */
  onRedeemed: () => void;
  onClose: () => void;
};

export default function LoyaltyRedeemDialog({
  customerId, customerName, orderId, loyaltyPoints, orderTotalZar: _orderTotalZar, onRedeemed, onClose,
}: Props) {
  const [submitting, setSubmitting] = useState(false);

  const confirm = useCallback(async () => {
    if (submitting) return;
    setSubmitting(true);
    const r = await redeemLoyalty(customerId, orderId).catch(() => ({
      ok: false as const, code: "ERR", message: "Could not redeem points.",
    }));
    setSubmitting(false);
    if (r.ok) {
      toast.success("100 pts redeemed — R20 off");
      onRedeemed();
      onClose();
    } else {
      toast.error(r.message);
    }
  }, [submitting, customerId, orderId, onRedeemed, onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-coffee-bean/60 px-4"
      onClick={(e) => e.target === e.currentTarget && !submitting && onClose()}
      role="dialog" aria-modal="true" aria-label="Redeem loyalty points"
    >
      <div className="w-full max-w-[360px] rounded-[var(--radius-card)] border border-cool-steel/20 bg-dark-teal shadow-[var(--shadow-2)]">
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
          <p className="favo-small text-porcelain">
            Redeem <span className="text-crimson-carrot font-bold">{REDEEM_POINTS} points</span> for{" "}
            <span className="text-crimson-carrot font-bold">R20,00 off</span> for {customerName}?
          </p>
          <p className="favo-caption text-cool-steel">
            {loyaltyPoints} pts available → {loyaltyPoints - REDEEM_POINTS} pts after.
            This zeroes the whole order. Full redemption only.
          </p>

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
                : <>Redeem R{(REDEEM_VALUE_ZAR / 100).toFixed(0)} off</>}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
