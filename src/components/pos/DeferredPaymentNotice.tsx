"use client";

/**
 * DeferredPaymentNotice — task M19.
 *
 * Shown in place of the Yoco hosted-fields screen when the barista places an
 * order while offline. Yoco can't be reached, so payment is taken in person and
 * the order is queued with paymentMode='yoco_deferred'. The deferred-retry cron
 * (G22) reconciles the charge once WAN returns — flipping it to `success` or to
 * `sync_conflicts` for admin review.
 *
 * The confirm CTA calls back to the parent, which writes to the IndexedDB
 * outbox (see POSWorkspace.handlePlaceOrder offline path).
 */

import { CloudOff, Loader2, HandCoins } from "lucide-react";
import { formatZar } from "@/lib/format";

export type Props = {
  totalZar: number;
  queueing: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

export default function DeferredPaymentNotice({ totalZar, queueing, onConfirm, onCancel }: Props) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 px-8">
      <div
        className="flex h-16 w-16 items-center justify-center rounded-full"
        style={{ background: "color-mix(in srgb, var(--color-warning) 16%, transparent)" }}
      >
        <CloudOff size={30} strokeWidth={1.75} style={{ color: "var(--color-warning)" }} aria-hidden />
      </div>

      <div className="text-center">
        <p className="favo-label text-cool-steel mb-1">Amount due</p>
        <p className="favo-h2 text-coffee-bean">{formatZar(totalZar)}</p>
        <p className="favo-small mt-2 max-w-[280px]" style={{ color: "var(--color-warning)" }}>
          You&apos;re offline — take payment in person (cash or card machine).
          The order queues and the card charge reconciles automatically on reconnect.
        </p>
      </div>

      <div className="flex flex-col gap-3 w-full max-w-[280px]">
        <button type="button" onClick={onConfirm} disabled={queueing}
          className="flex w-full items-center justify-center gap-2 rounded-[var(--radius-btn)] py-4 min-h-[52px] transition-all hover:brightness-110 active:scale-[0.99] disabled:opacity-40"
          style={{ background: "var(--color-warning)", color: "var(--color-coffee-bean)", fontFamily: "var(--font-sans)", fontWeight: 700, fontSize: "var(--text-small)", letterSpacing: "var(--tracking-cta)", textTransform: "uppercase" }}>
          {queueing
            ? <><Loader2 size={16} strokeWidth={2.25} className="animate-spin" /> Queueing…</>
            : <><HandCoins size={16} strokeWidth={2.25} /> Take payment &amp; queue order</>}
        </button>
        <button type="button" onClick={onCancel} disabled={queueing}
          className="favo-small text-cool-steel underline underline-offset-2 hover:text-coffee-bean transition-colors disabled:opacity-40">
          ← Back to order
        </button>
      </div>
    </div>
  );
}
