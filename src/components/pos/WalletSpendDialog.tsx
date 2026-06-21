"use client";

/**
 * WalletSpendDialog — AT-113 (wallet spend POS UI).
 *
 * Lets the barista apply the customer's wallet balance against the current
 * order. Applies min(walletZar, orderTotalZar) — the server enforces L16
 * clamping authoritatively in `walletSpend`. Shown only when the customer
 * has a wallet balance > 0 and the order total > 0.
 */

import { useState, useCallback } from "react";
import { X, Loader2, Wallet } from "lucide-react";
import { toast } from "sonner";
import { walletSpend } from "@/server/actions/wallet";
import { formatZar } from "@/lib/format";

export type WalletSpendResult = {
  amountSpent: number;
  newTotalZar: number;
};

export type Props = {
  customerId: string;
  customerName: string;
  orderId: string;
  walletZar: number;
  orderTotalZar: number;
  onApplied: (result: WalletSpendResult) => void;
  onClose: () => void;
};

export default function WalletSpendDialog({
  customerId, customerName, orderId, walletZar, orderTotalZar, onApplied, onClose,
}: Props) {
  const [submitting, setSubmitting] = useState(false);

  // Server clamps: spend at most min(walletZar, orderTotalZar).
  const applicableAmount = Math.min(walletZar, orderTotalZar);
  const newTotalZar = orderTotalZar - applicableAmount;

  const confirm = useCallback(async () => {
    if (submitting) return;
    setSubmitting(true);
    const r = await walletSpend(customerId, orderId, applicableAmount).catch(() => ({
      ok: false as const, code: "ERR", message: "Could not apply wallet.",
    }));
    setSubmitting(false);
    if (r.ok) {
      toast.success(`${formatZar(applicableAmount)} from wallet applied`);
      onApplied({ amountSpent: applicableAmount, newTotalZar: r.data.newTotalZar });
      onClose();
    } else {
      toast.error(r.message);
    }
  }, [submitting, customerId, orderId, applicableAmount, onApplied, onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-coffee-bean/60 px-4"
      onClick={(e) => e.target === e.currentTarget && !submitting && onClose()}
      role="dialog" aria-modal="true" aria-label="Spend from wallet"
    >
      <div className="w-full max-w-[360px] rounded-[var(--radius-card)] border border-cool-steel/20 bg-dark-teal shadow-[var(--shadow-2)]">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-cool-steel/20 px-5 py-3">
          <div className="flex items-center gap-2">
            <Wallet size={16} strokeWidth={2.25} className="text-crimson-carrot" />
            <h2 className="favo-h3 text-porcelain leading-tight">Spend from wallet</h2>
          </div>
          <button type="button" onClick={onClose} disabled={submitting} aria-label="Close"
            className="flex h-9 w-9 items-center justify-center rounded-[var(--radius-btn)] text-cool-steel hover:bg-porcelain/10 hover:text-porcelain disabled:opacity-40">
            <X size={16} strokeWidth={2.25} />
          </button>
        </div>

        <div className="px-5 py-4 flex flex-col gap-4">
          {/* Customer context */}
          <p className="favo-small text-porcelain">
            {customerName} · wallet balance{" "}
            <span className="text-crimson-carrot font-bold">{formatZar(walletZar)}</span>
          </p>

          {/* Breakdown */}
          <div className="rounded-[var(--radius-card)] border border-cool-steel/20 bg-coffee-bean/20 px-4 py-3 flex flex-col gap-1.5">
            <div className="flex justify-between favo-small">
              <span className="text-cool-steel">Wallet applied</span>
              <span className="text-crimson-carrot font-bold">−{formatZar(applicableAmount)}</span>
            </div>
            <div className="border-t border-cool-steel/20 pt-1.5 mt-0.5 flex justify-between favo-small">
              <span className="text-cool-steel">New total</span>
              <span className="text-porcelain font-bold">
                {newTotalZar === 0 ? "R0 (free)" : formatZar(newTotalZar)}
              </span>
            </div>
            <div className="flex justify-between favo-caption text-cool-steel">
              <span>Wallet after</span>
              <span>{formatZar(walletZar - applicableAmount)}</span>
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
                : <>Apply {formatZar(applicableAmount)}</>}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
