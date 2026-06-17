"use client";

/**
 * DeferredPaymentNotice — offline payment fallback (rule R2: Yoco outage).
 *
 * Shown on the payment screen instead of the Yoco card form when the device is
 * offline. The barista takes payment on the standalone Yoco card machine, then
 * taps Confirm; the order stays in `ordered` state and advances normally. If the
 * order was never created online (offline at place-order), the parent's confirm
 * handler queues it to the IndexedDB outbox instead.
 *
 * Self-contained connectivity detection (online/offline event listeners) per
 * spec — renders nothing while online. The parent also gates on connectivity,
 * so this is a defensive second guard that keeps the notice honest if the
 * connection flaps while it is mounted.
 */

import { useEffect, useState } from "react";
import { WifiOff } from "lucide-react";
import { formatZar } from "@/lib/format";

export type Props = {
  totalZar: number;
  onConfirmDeferred: () => void;
  onBack: () => void;
};

export default function DeferredPaymentNotice({ totalZar, onConfirmDeferred, onBack }: Props) {
  const [online, setOnline] = useState(false);

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

  // Back online — let the parent re-mount the Yoco form.
  if (online) return null;

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 px-8 text-center">
      <div
        className="flex h-16 w-16 items-center justify-center rounded-full"
        style={{ background: "color-mix(in srgb, var(--color-warning) 16%, transparent)" }}
      >
        <WifiOff size={30} strokeWidth={1.75} style={{ color: "var(--color-warning)" }} aria-hidden />
      </div>

      <div className="flex flex-col gap-1">
        <h2 className="favo-h3 text-coffee-bean">No connection</h2>
        <p className="favo-small text-cool-steel max-w-[300px]">
          Take payment on the Yoco card machine, then tap Confirm.
        </p>
        <p className="favo-label text-cool-steel mt-2">Amount due</p>
        <p className="favo-subhead text-coffee-bean">{formatZar(totalZar)}</p>
      </div>

      <div className="flex flex-col gap-3 w-full max-w-[300px]">
        <button
          type="button"
          onClick={onConfirmDeferred}
          className="flex w-full items-center justify-center gap-2 rounded-[var(--radius-btn)] py-4 min-h-[52px] transition-all hover:brightness-110 active:scale-[0.99] focus-visible:outline focus-visible:outline-2 focus-visible:outline-porcelain"
          style={{ background: "var(--color-warning)", color: "var(--color-coffee-bean)", fontFamily: "var(--font-sans)", fontWeight: 700, fontSize: "var(--text-small)", letterSpacing: "var(--tracking-cta)", textTransform: "uppercase" }}
        >
          Confirm — paid in person
        </button>
        <button
          type="button"
          onClick={onBack}
          className="favo-small text-cool-steel underline underline-offset-2 hover:text-coffee-bean transition-colors min-h-[44px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-crimson-carrot"
        >
          ← Back to order
        </button>
      </div>
    </div>
  );
}
