"use client";

/**
 * ChargeOrderDialog — take payment for an order that's already in the queue.
 *
 * The place-order flow charges immediately, but if the customer steps away or
 * the barista backs out, the order sits in `ordered` unpaid with no way to
 * charge it. This dialog reopens payment for a specific queued order:
 *   • online  → the Yoco card form (YocoOrderForm) — charge + webbook confirm
 *   • offline → the deferred notice (take payment on the card machine in person)
 *   • always  → a manual "paid on the card machine / cash" fallback
 *
 * On settle it calls onPaid(orderId); the parent records the order as paid so it
 * can advance (rule L01: no payment → no order). Card payments are confirmed by
 * the backend (paymentStatus); the manual fallback is a counter override —
 * persisting cash/in-person payment needs a backend action (flagged to G6).
 */

import { useEffect, useState } from "react";
import { X, HandCoins } from "lucide-react";
import { formatZar } from "@/lib/format";
import YocoOrderForm from "@/components/pos/YocoOrderForm";
import DeferredPaymentNotice from "@/components/pos/DeferredPaymentNotice";
import type { Order } from "@/lib/types";

export type Props = {
  order: Order;
  onPaid: (orderId: string) => void;
  onClose: () => void;
};

export default function ChargeOrderDialog({ order, onPaid, onClose }: Props) {
  const [online, setOnline] = useState(true);

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
              {/* In-person fallback — payment taken on the standalone card machine or cash. */}
              <button type="button" onClick={settle}
                className="flex w-full items-center justify-center gap-2 rounded-[var(--radius-btn)] border border-cool-steel/30 py-3 min-h-[48px] favo-small text-coffee-bean hover:bg-coffee-bean/8 focus-visible:outline focus-visible:outline-2 focus-visible:outline-crimson-carrot">
                <HandCoins size={15} strokeWidth={2.25} />
                Paid on the card machine / cash — {formatZar(order.totalZar)}
              </button>
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
