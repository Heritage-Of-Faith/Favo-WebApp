"use client";

/**
 * LoyaltyRedeemDialog — task M18, fixed by AT-115 (BUG-Y1).
 *
 * Single-unit redemption (rule L06): 100 pts → R20 off, capped at the order
 * total. The server re-creates the Yoco checkout for the remainder and returns
 * the new clientSecret so the POS can reinitialise the payment form.
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
  /** Order total (cents) — discount is capped at this; R20 off otherwise. */
  orderTotalZar?: number;
  /** Called after a successful redeem so the caller can apply the discount + drop 100 pts. */
  onRedeemed: () => void;
  onClose: () => void;
};

export default function LoyaltyRedeemDialog({
  customerId, customerName, orderId, loyaltyPoints, orderTotalZar, onRedeemed, onClose,
}: Props) {
  const [submitting, setSubmitting] = useState(false);

  // One 100-pt unit is worth R20, but the server caps the discount at the order total.
  const discountZar = orderTotalZar == null ? REDEEM_VALUE_ZAR : Math.min(REDEEM_VALUE_ZAR, orderTotalZar);
  const discountLabel = `R${(discountZar / 100).toFixed(0)}`;

  const confirm = useCallback(async () => {
    if (submitting) return;
    setSubmitting(true);
    const r = await redeemLoyalty(customerId, orderId).catch(() => ({
      ok: false as const, code: "ERR", message: "Could not redeem points.",
    }));
    setSubmitting(false);
    if (r.ok) {
      const applied = r.data.discountZar;
      toast.success(`100 pts redeemed — R${(applied / 100).toFixed(0)} off`);
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
            <span className="text-crimson-carrot font-bold">{discountLabel} off</span> for {customerName}?
          </p>
          <p className="favo-caption text-cool-steel">
            {loyaltyPoints} pts available → {loyaltyPoints - REDEEM_POINTS} pts after.
            {orderTotalZar != null && orderTotalZar < REDEEM_VALUE_ZAR
              ? " Discount is capped at the order total."
              : " R20 off this order."}
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
                : <>Redeem {discountLabel} off</>}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
