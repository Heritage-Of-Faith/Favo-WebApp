"use client";

/**
 * PackPurchaseDialog — task M17 (purchase half).
 *
 * Counter-only coffee-pack purchase (rule L16). Select a coffee item + qty
 * (default 10); pack expires 90 days from purchase. Pays via Yoco
 * (intent kind encoded server-side by purchasePack).
 *
 * NOTE: pack *redemption* (PackRedeemPicker → redeemFromPack) is intentionally
 * not built here — the `redeemFromPack` server action does not yet exist on the
 * backend (G18 shipped purchase only). Tracked as a backend follow-up.
 */

import { useState, useMemo, useCallback } from "react";
import { X, Loader2, CheckCircle, Package, Plus, Minus } from "lucide-react";
import { toast } from "sonner";
import YocoPayment from "@/components/pos/YocoPayment";
import { purchasePack } from "@/server/actions/loyalty";
import { formatZar, formatDate } from "@/lib/format";
import type { MenuItem } from "@/lib/types";

const PACK_DAYS = 90;
const DEFAULT_QTY = 10;

export type Props = {
  customerId: string;
  customerName: string;
  /** Coffee-category items the pack can be bought against. */
  coffeeItems: MenuItem[];
  onClose: () => void;
};

type Step = "configure" | "pay" | "done";

export default function PackPurchaseDialog({ customerId, customerName, coffeeItems, onClose }: Props) {
  const [step, setStep] = useState<Step>("configure");
  const [itemId, setItemId] = useState(coffeeItems[0]?.id ?? "");
  const [qty, setQty] = useState(DEFAULT_QTY);
  const [clientSecret, setClientSecret] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const item = coffeeItems.find((i) => i.id === itemId);
  const totalCents = (item?.currentPriceZar ?? 0) * qty;

  // Expiry is display-only here; the server is the source of truth.
  const expiryLabel = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() + PACK_DAYS);
    return formatDate(d);
  }, []);

  const startCharge = useCallback(async () => {
    if (!itemId || qty < 1 || submitting) return;
    setSubmitting(true);
    const r = await purchasePack(customerId, itemId, qty).catch(() => ({
      ok: false as const, code: "ERR", message: "Could not start pack purchase.",
    }));
    setSubmitting(false);
    if (r.ok) { setClientSecret(r.data.yocoClientSecret); setStep("pay"); }
    else toast.error(r.message);
  }, [itemId, qty, submitting, customerId]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-coffee-bean/60 px-4"
      onClick={(e) => e.target === e.currentTarget && onClose()}
      role="dialog" aria-modal="true" aria-label="Buy coffee pack"
    >
      <div className="w-full max-w-[400px] rounded-[var(--radius-card)] border border-cool-steel/20 bg-dark-teal shadow-[var(--shadow-2)]">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-cool-steel/20 px-5 py-3">
          <div className="flex items-center gap-2">
            <Package size={16} strokeWidth={2.25} className="text-cool-steel" />
            <div>
              <h2 className="favo-h3 text-porcelain leading-tight">Coffee Pack</h2>
              <p className="favo-caption text-cool-steel">{customerName}</p>
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
              <label htmlFor="pack-item" className="favo-label text-cool-steel">Coffee</label>
              <select id="pack-item" value={itemId} onChange={(e) => setItemId(e.target.value)}
                className="min-h-[44px] rounded-[var(--radius-btn)] border border-cool-steel/30 bg-porcelain/10 px-3 text-porcelain favo-small focus:border-crimson-carrot focus:outline-none">
                {coffeeItems.map((i) => (
                  <option key={i.id} value={i.id} className="bg-dark-teal">{i.name} · {formatZar(i.currentPriceZar)}</option>
                ))}
              </select>

              <label className="favo-label text-cool-steel">Quantity</label>
              <div className="flex items-center gap-3">
                <button type="button" onClick={() => setQty((q) => Math.max(1, q - 1))} aria-label="Decrease quantity"
                  className="flex h-11 w-11 items-center justify-center rounded-[var(--radius-btn)] border border-cool-steel/30 text-porcelain hover:bg-porcelain/10">
                  <Minus size={16} strokeWidth={2.25} />
                </button>
                <span className="favo-h3 text-porcelain w-10 text-center">{qty}</span>
                <button type="button" onClick={() => setQty((q) => Math.min(99, q + 1))} aria-label="Increase quantity"
                  className="flex h-11 w-11 items-center justify-center rounded-[var(--radius-btn)] border border-cool-steel/30 text-porcelain hover:bg-porcelain/10">
                  <Plus size={16} strokeWidth={2.25} />
                </button>
              </div>

              <div className="mt-1 flex items-center justify-between border-t border-cool-steel/15 pt-3">
                <span className="favo-small text-cool-steel">Total</span>
                <span className="favo-h3 text-porcelain">{formatZar(totalCents)}</span>
              </div>
              <p className="favo-caption text-cool-steel">Expires {expiryLabel} (90 days)</p>

              <button type="button" onClick={startCharge} disabled={!item || submitting}
                className="mt-2 flex w-full items-center justify-center gap-2 rounded-[var(--radius-btn)] bg-crimson-carrot py-3 min-h-[48px] transition-all hover:brightness-110 active:scale-[0.99] disabled:opacity-40"
                style={{ color: "var(--color-porcelain)", fontFamily: "var(--font-sans)", fontWeight: 700, fontSize: "var(--text-small)", letterSpacing: "var(--tracking-cta)", textTransform: "uppercase" }}>
                {submitting ? <Loader2 size={16} strokeWidth={2.25} className="animate-spin" /> : `Charge ${formatZar(totalCents)}`}
              </button>
            </div>
          )}

          {step === "pay" && (
            <YocoPayment
              clientSecret={clientSecret}
              amountZar={totalCents}
              onSuccess={() => { setStep("done"); toast.success(`Pack of ${qty} ${item?.name} purchased`); }}
              onCancel={() => setStep("configure")}
            />
          )}

          {step === "done" && (
            <div className="flex flex-col items-center gap-3 py-6 text-center">
              <CheckCircle size={40} strokeWidth={2} className="text-[var(--color-success)]" />
              <p className="favo-subhead text-porcelain">{qty} × {item?.name} pack</p>
              <p className="favo-small text-cool-steel">Added to {customerName}&apos;s account · expires {expiryLabel}.</p>
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
