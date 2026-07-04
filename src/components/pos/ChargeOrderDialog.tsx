"use client";

/**
 * ChargeOrderDialog — take payment for an order that's already in the queue.
 *
 * The place-order flow charges immediately, but if the customer steps away or
 * the barista backs out, the order sits in `ordered` unpaid. This dialog
 * reopens payment for a specific queued order:
 *   • online  → the Yoco card form (YocoOrderForm), OR a manual confirmation
 *               for payments tendered another way (cash / card machine / EFT) —
 *               confirmManualPayment persists the payment and accrues loyalty.
 *   • offline → the deferred notice (take payment on the card machine in person;
 *               the deferred-payment cron reconciles + earns when connectivity
 *               returns).
 *
 * On settle it calls onPaid(orderId). Card data is never stored — L01/AT-122:
 * the manual path only records THAT the order was paid, never how much card.
 */

import { useEffect, useState } from "react";
import { X, HandCoins } from "lucide-react";
import YocoOrderForm from "@/components/pos/YocoOrderForm";
import DeferredPaymentNotice from "@/components/pos/DeferredPaymentNotice";
import { confirmManualPayment } from "@/server/actions/orders";
import { formatZar } from "@/lib/format";
import type { Order } from "@/lib/types";

export type Props = {
  order: Order;
  onPaid: (orderId: string) => void;
  onClose: () => void;
};

export default function ChargeOrderDialog({ order, onPaid, onClose }: Props) {
  const [online, setOnline] = useState(true);
  const [manualBusy, setManualBusy] = useState(false);
  const [manualErr, setManualErr] = useState<string | null>(null);

  useEffect(() => {
    setOnline(navigator.onLine);
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  const settle = () => { onPaid(order.id); onClose(); };

  // Manual confirmation (cash / card machine / EFT) — persists the payment as
  // successful server-side and accrues loyalty (L06). Online only: it needs the
  // network. Offline tender goes through DeferredPaymentNotice instead.
  async function confirmManual() {
    setManualBusy(true);
    setManualErr(null);
    const r = await confirmManualPayment(order.id).catch(
      () => ({ ok: false as const, code: "ERR", message: "Could not confirm payment." })
    );
    setManualBusy(false);
    if (r.ok) settle();
    else setManualErr(r.message);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-coffee-bean/60 px-4"
      onClick={(e) => e.target === e.currentTarget && onClose()}
      role="dialog" aria-modal="true" aria-label="Take payment"
    >
      <div className="flex w-full max-w-[420px] flex-col rounded-[var(--radius-card)] border border-cool-steel/20 bg-surface shadow-[var(--shadow-2)]">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-cool-steel/20 px-5 py-3">
          <div>
            <p className="favo-label text-cool-steel">Take payment</p>
            <h2 className="favo-h3 text-coffee-bean leading-tight">
              Order #{order.id.slice(-6).toUpperCase()}
            </h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Close"
            className="flex h-9 w-9 items-center justify-center rounded-[var(--radius-btn)] text-cool-steel hover:bg-coffee-bean/8 hover:text-coffee-bean">
            <X size={16} strokeWidth={2.25} />
          </button>
        </div>

        <div className="flex flex-col gap-4 px-5 py-5">
          {online ? (
            <>
              <YocoOrderForm orderId={order.id} amountZar={order.totalZar} onPaid={settle} />

              {/* Manual tender — cash / card machine / EFT. Persists + earns. */}
              <div className="flex items-center gap-3">
                <span className="h-px flex-1 bg-cool-steel/20" />
                <span className="favo-caption text-cool-steel">or paid another way</span>
                <span className="h-px flex-1 bg-cool-steel/20" />
              </div>

              <button
                type="button"
                onClick={confirmManual}
                disabled={manualBusy}
                className="flex w-full items-center justify-center gap-2 rounded-[var(--radius-btn)] border border-cool-steel/30 px-4 py-3 favo-label text-coffee-bean hover:bg-coffee-bean/8 disabled:opacity-50"
              >
                <HandCoins size={18} strokeWidth={2} />
                {manualBusy ? "Confirming…" : `Mark as paid — cash / card machine / EFT (${formatZar(order.totalZar)})`}
              </button>

              {manualErr && (
                <p className="favo-caption text-center" style={{ color: "var(--color-warning)" }}>
                  {manualErr}
                </p>
              )}
            </>
          ) : (
            <DeferredPaymentNotice
              totalZar={order.totalZar}
              onConfirmDeferred={settle}
              onBack={onClose}
            />
          )}
        </div>
      </div>
    </div>
  );
}
