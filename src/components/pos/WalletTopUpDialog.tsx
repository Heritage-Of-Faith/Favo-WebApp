"use client";

/**
 * WalletTopUpDialog — task M16.
 *
 * Counter-only wallet top-up (rule L16). Barista enters an amount, taps Charge,
 * and the customer pays via Yoco hosted fields (intent kind encoded server-side
 * by topUpWallet). No in-app top-up exists on the customer PWA.
 *
 * Flow: amount → topUpWallet(customerId, amountZar) → { yocoClientSecret }
 *       → <YocoPayment> → onSuccess → confirmation.
 */

import { useState, useCallback } from "react";
import { X, Loader2, CheckCircle, Wallet } from "lucide-react";
import { toast } from "sonner";
import AmountKeypad from "@/components/pos/AmountKeypad";
import YocoPayment from "@/components/pos/YocoPayment";
import { topUpWallet } from "@/server/actions/loyalty";
import { formatZar } from "@/lib/format";

export type Props = {
  customerId: string;
  customerName: string;
  onClose: () => void;
};

type Step = "amount" | "pay" | "done";

export default function WalletTopUpDialog({ customerId, customerName, onClose }: Props) {
  const [step, setStep] = useState<Step>("amount");
  const [amountCents, setAmountCents] = useState(0);
  const [clientSecret, setClientSecret] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const startCharge = useCallback(async () => {
    if (amountCents <= 0 || submitting) return;
    setSubmitting(true);
    const r = await topUpWallet(customerId, amountCents).catch(() => ({
      ok: false as const, code: "ERR", message: "Could not start top-up.",
    }));
    setSubmitting(false);
    if (r.ok) {
      setClientSecret(r.data.yocoClientSecret);
      setStep("pay");
    } else {
      toast.error(r.message);
    }
  }, [amountCents, submitting, customerId]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-coffee-bean/60 px-4"
      onClick={(e) => e.target === e.currentTarget && onClose()}
      role="dialog"
      aria-modal="true"
      aria-label="Wallet top-up"
    >
      <div className="w-full max-w-[400px] rounded-[var(--radius-card)] border border-cool-steel/20 bg-dark-teal shadow-[var(--shadow-2)]">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-cool-steel/20 px-5 py-3">
          <div className="flex items-center gap-2">
            <Wallet size={16} strokeWidth={2.25} className="text-cool-steel" />
            <div>
              <h2 className="favo-h3 text-porcelain leading-tight">Wallet Top-up</h2>
              <p className="favo-caption text-cool-steel">{customerName}</p>
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label="Close"
            className="flex h-9 w-9 items-center justify-center rounded-[var(--radius-btn)] text-cool-steel hover:bg-porcelain/10 hover:text-porcelain">
            <X size={16} strokeWidth={2.25} />
          </button>
        </div>

        <div className="px-5 py-4">
          {step === "amount" && (
            <>
              <AmountKeypad valueCents={amountCents} onChange={setAmountCents} />
              <button type="button" onClick={startCharge} disabled={amountCents <= 0 || submitting}
                className="mt-4 flex w-full items-center justify-center gap-2 rounded-[var(--radius-btn)] bg-crimson-carrot py-3 min-h-[48px] transition-all hover:brightness-110 active:scale-[0.99] disabled:opacity-40"
                style={{ color: "var(--color-porcelain)", fontFamily: "var(--font-sans)", fontWeight: 700, fontSize: "var(--text-small)", letterSpacing: "var(--tracking-cta)", textTransform: "uppercase" }}>
                {submitting ? <Loader2 size={16} strokeWidth={2.25} className="animate-spin" /> : `Charge ${formatZar(amountCents)}`}
              </button>
            </>
          )}

          {step === "pay" && (
            <YocoPayment
              clientSecret={clientSecret}
              amountZar={amountCents}
              onSuccess={() => { setStep("done"); toast.success(`Wallet topped up ${formatZar(amountCents)}`); }}
              onCancel={() => setStep("amount")}
            />
          )}

          {step === "done" && (
            <div className="flex flex-col items-center gap-3 py-6 text-center">
              <CheckCircle size={40} strokeWidth={2} className="text-[var(--color-success)]" />
              <p className="favo-subhead text-porcelain">Topped up {formatZar(amountCents)}</p>
              <p className="favo-small text-cool-steel">{customerName}&apos;s wallet has been credited.</p>
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
