"use client";

/**
 * WalletTopUpDialog — wires the topUpWallet server action (L16).
 *
 * Counter-only wallet top-up. Barista enters a rand amount on the keypad,
 * pays via Yoco (intent kind "wallet_topup" encoded server-side by
 * topUpWallet); the webhook credits wallet_zar on payment success.
 * Mirrors PackPurchaseDialog's configure → pay → done flow.
 */

import { useState, useCallback } from "react";
import { X, Loader2, CheckCircle, Wallet } from "lucide-react";
import { toast } from "sonner";
import AmountKeypad from "@/components/pos/AmountKeypad";
import YocoPayment from "@/components/pos/YocoPayment";
import { topUpWallet } from "@/server/actions/loyalty";
import { formatZar } from "@/lib/format";

// Mirror the server caps (L16) so the UI blocks before a round-trip.
const MAX_TOPUP_ZAR = 100_000; // R1,000 per top-up
const MAX_BALANCE_ZAR = 250_000; // R2,500 max wallet balance

export type Props = {
  customerId: string;
  customerName: string;
  /** Current wallet balance in integer cents (for the max-balance guard + display). */
  walletZar: number;
  /** Called with the new (optimistic) balance after a successful top-up. */
  onToppedUp?: (newWalletZar: number) => void;
  onClose: () => void;
};

type Step = "configure" | "pay" | "done";

export default function WalletTopUpDialog({ customerId, customerName, walletZar, onToppedUp, onClose }: Props) {
  const [step, setStep] = useState<Step>("configure");
  const [amountCents, setAmountCents] = useState(0);
  const [clientSecret, setClientSecret] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const remainingRoom = Math.max(0, MAX_BALANCE_ZAR - walletZar);
  const overSingleCap = amountCents > MAX_TOPUP_ZAR;
  const overBalanceCap = amountCents > remainingRoom;
  const invalid = amountCents < 1 || overSingleCap || overBalanceCap;

  const startCharge = useCallback(async () => {
    if (invalid || submitting) return;
    setSubmitting(true);
    const r = await topUpWallet(customerId, amountCents).catch(() => ({
      ok: false as const, code: "ERR", message: "Could not start wallet top-up.",
    }));
    setSubmitting(false);
    if (r.ok) { setClientSecret(r.data.yocoClientSecret); setStep("pay"); }
    else toast.error(r.message);
  }, [invalid, submitting, customerId, amountCents]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-coffee-bean/60 px-4"
      onClick={(e) => e.target === e.currentTarget && onClose()}
      role="dialog" aria-modal="true" aria-label="Top up wallet"
    >
      <div className="w-full max-w-[400px] rounded-[var(--radius-card)] border border-cool-steel/20 bg-dark-teal shadow-[var(--shadow-2)]">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-cool-steel/20 px-5 py-3">
          <div className="flex items-center gap-2">
            <Wallet size={16} strokeWidth={2.25} className="text-cool-steel" />
            <div>
              <h2 className="favo-h3 text-porcelain leading-tight">Top Up Wallet</h2>
              <p className="favo-caption text-cool-steel">{customerName} · balance {formatZar(walletZar)}</p>
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label="Close"
            className="flex h-9 w-9 items-center justify-center rounded-[var(--radius-btn)] text-cool-steel hover:bg-porcelain/10 hover:text-porcelain">
            <X size={16} strokeWidth={2.25} />
          </button>
        </div>

        <div className="px-5 py-4">
          {step === "configure" && (
            <div className="flex flex-col gap-3">
              <AmountKeypad valueCents={amountCents} onChange={setAmountCents} />

              {overSingleCap && (
                <p className="favo-caption text-[var(--color-error)]">
                  Single top-up cannot exceed {formatZar(MAX_TOPUP_ZAR)}.
                </p>
              )}
              {!overSingleCap && overBalanceCap && (
                <p className="favo-caption text-[var(--color-error)]">
                  Would exceed the {formatZar(MAX_BALANCE_ZAR)} wallet cap · room left {formatZar(remainingRoom)}.
                </p>
              )}

              <button type="button" onClick={startCharge} disabled={invalid || submitting}
                className="mt-1 flex w-full items-center justify-center gap-2 rounded-[var(--radius-btn)] bg-crimson-carrot py-3 min-h-[48px] transition-all hover:brightness-110 active:scale-[0.99] disabled:opacity-40"
                style={{ color: "var(--color-porcelain)", fontFamily: "var(--font-sans)", fontWeight: 700, fontSize: "var(--text-small)", letterSpacing: "var(--tracking-cta)", textTransform: "uppercase" }}>
                {submitting ? <Loader2 size={16} strokeWidth={2.25} className="animate-spin" /> : `Charge ${formatZar(amountCents)}`}
              </button>
            </div>
          )}

          {step === "pay" && (
            <YocoPayment
              clientSecret={clientSecret}
              amountZar={amountCents}
              onSuccess={() => {
                setStep("done");
                onToppedUp?.(walletZar + amountCents);
                toast.success(`${formatZar(amountCents)} added to ${customerName}'s wallet`);
              }}
              onCancel={() => setStep("configure")}
            />
          )}

          {step === "done" && (
            <div className="flex flex-col items-center gap-3 py-6 text-center">
              <CheckCircle size={40} strokeWidth={2} className="text-[var(--color-success)]" />
              <p className="favo-subhead text-porcelain">Wallet topped up</p>
              <p className="favo-small text-cool-steel">
                {formatZar(amountCents)} added to {customerName}&apos;s wallet · new balance {formatZar(walletZar + amountCents)}.
              </p>
              <button type="button" onClick={onClose}
                className="mt-2 rounded-[var(--radius-btn)] border border-cool-steel/30 px-5 py-2 min-h-[44px] favo-small text-porcelain hover:bg-porcelain/10">
                Done
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
