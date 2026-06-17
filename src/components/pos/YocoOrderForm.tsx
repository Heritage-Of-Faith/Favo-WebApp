"use client";

/**
 * YocoOrderForm — task M4 / AT-13. Real card capture for the POS order payment.
 *
 * Flow (composes with G23 backend):
 *   1. createOrder has already created a Yoco checkout + a `pending` payments row
 *      keyed by the checkout id, and returned the checkout id (yocoCheckoutId).
 *   2. This form loads the Yoco SDK and captures the card. The charge carries
 *      `metadata.orderId`, so Yoco's `payment.succeeded` webhook can link the
 *      charge back to the order (the webhook backfills `yoco_payment_id` via the
 *      orderId fallback and flips `payments.status` → 'successful').
 *   3. The webhook is the SOURCE OF TRUTH. After the card is tapped we poll
 *      GET /api/pos/order/:id until `paymentStatus === 'successful'` (or 'failed'),
 *      then advance. We never trust the client callback alone for revenue state.
 *
 * Rule L01: card data is never stored, logged, or echoed — the Yoco SDK owns the
 * card fields. The checkout id is never shown in any user-visible message.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import Script from "next/script";
import { Loader2, ShieldCheck, AlertCircle, RotateCcw, CreditCard } from "lucide-react";
import { formatZar } from "@/lib/format";

const YOCO_SDK_URL = "https://js.yoco.com/sdk/v1/yoco-sdk-web.js";
const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 30000;

// Minimal typing for the Yoco web SDK (loaded from CDN). Accessed via a local
// cast rather than a global `declare` so it doesn't collide with the global
// Window.YocoSDK augmentation in YocoPayment.tsx.
type YocoInstance = {
  showPopup: (config: {
    amountInCents: number;
    currency: string;
    name: string;
    description?: string;
    metadata?: Record<string, string>;
    callback: (result: { id?: string; error?: { message: string } }) => void;
  }) => void;
};
type YocoCtor = new (config: { publicKey: string }) => YocoInstance;

function getYocoCtor(): YocoCtor | undefined {
  return (globalThis as unknown as { YocoSDK?: YocoCtor }).YocoSDK;
}

type FormState =
  | "loading-sdk"
  | "ready"
  | "awaiting-card"
  | "processing"
  | "success"
  | "failed"
  | "timeout"
  | "error";

export type Props = {
  orderId: string;
  /** Amount in integer cents (ZAR). */
  amountZar: number;
  /** Called once payment is confirmed successful by the backend. */
  onPaid: () => void;
};

export default function YocoOrderForm({ orderId, amountZar, onPaid }: Props) {
  const [state, setState] = useState<FormState>("loading-sdk");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const yocoRef = useRef<YocoInstance | null>(null);
  const pollAbort = useRef(false);

  const initSdk = useCallback(() => {
    try {
      const Ctor = getYocoCtor();
      if (!Ctor) throw new Error("YocoSDK unavailable");
      const publicKey = process.env.NEXT_PUBLIC_YOCO_PUBLIC_KEY ?? "";
      if (!publicKey) throw new Error("missing public key");
      yocoRef.current = new Ctor({ publicKey });
      setState("ready");
    } catch {
      setState("error");
      setErrorMsg("Payment system unavailable. Please retry.");
    }
  }, []);

  // If the SDK was already loaded by an earlier mount, init immediately.
  useEffect(() => {
    if (getYocoCtor() && !yocoRef.current) initSdk();
  }, [initSdk]);

  // Cancel any in-flight poll on unmount.
  useEffect(() => () => { pollAbort.current = true; }, []);

  /** Poll the order endpoint until the webhook flips payment status. */
  const pollUntilResolved = useCallback(async () => {
    const deadline = Date.now() + POLL_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (pollAbort.current) return;
      try {
        const r = await fetch(`/api/pos/order/${orderId}`, { cache: "no-store" });
        if (r.ok) {
          const d = (await r.json()) as { order?: { paymentStatus?: string | null } };
          const status = d.order?.paymentStatus ?? null;
          if (status === "successful") { setState("success"); onPaid(); return; }
          if (status === "failed") {
            setState("failed");
            setErrorMsg("Payment was declined. Ask the customer to try another card.");
            return;
          }
        }
      } catch {
        // transient — keep polling until the deadline
      }
      await new Promise((res) => setTimeout(res, POLL_INTERVAL_MS));
    }
    // Webhook hasn't landed in time — order is safe in the queue; let the barista move on.
    setState("timeout");
  }, [orderId, onPaid]);

  const handlePay = useCallback(() => {
    if (!yocoRef.current || (state !== "ready" && state !== "failed" && state !== "timeout")) return;
    setErrorMsg(null);
    setState("awaiting-card");
    yocoRef.current.showPopup({
      amountInCents: amountZar,
      currency: "ZAR",
      name: "FAVO Café",
      description: "Coffee order",
      metadata: { orderId },
      callback(result) {
        if (result.error) {
          setState("failed");
          setErrorMsg(result.error.message ?? "Payment declined. Please try again.");
          return;
        }
        // Card captured — wait for the webhook to confirm via the backend.
        setState("processing");
        pollAbort.current = false;
        void pollUntilResolved();
      },
    });
  }, [state, amountZar, orderId, pollUntilResolved]);

  const handleRetry = useCallback(() => {
    setErrorMsg(null);
    pollAbort.current = true;
    if (getYocoCtor()) { setState("ready"); } else { setState("loading-sdk"); }
  }, []);

  const showPayButton = state === "ready" || state === "failed";
  const busy = state === "awaiting-card" || state === "processing";

  return (
    <div className="flex w-full flex-col items-center gap-4">
      <Script
        src={YOCO_SDK_URL}
        strategy="lazyOnload"
        onLoad={initSdk}
        onError={() => { setState("error"); setErrorMsg("Could not load the payment SDK. Check the connection."); }}
      />

      {/* Mount target for the Yoco card capture (rule L01: SDK owns the fields). */}
      <div id="yoco-inline-form" className="w-full" />

      <div className="flex items-center gap-2 text-cool-steel">
        <ShieldCheck size={14} strokeWidth={2.25} aria-hidden />
        <span className="favo-small">Card handled securely by Yoco</span>
      </div>

      {state === "loading-sdk" && (
        <div className="flex items-center gap-2 text-cool-steel" role="status">
          <Loader2 size={18} strokeWidth={2.25} className="animate-spin" aria-hidden />
          <span className="favo-small">Loading card form…</span>
        </div>
      )}

      {state === "awaiting-card" && (
        <div className="flex items-center gap-2 text-cool-steel" role="status">
          <Loader2 size={18} strokeWidth={2.25} className="animate-spin" aria-hidden />
          <span className="favo-small">Waiting for card…</span>
        </div>
      )}

      {state === "processing" && (
        <div className="flex items-center gap-2 text-cool-steel" role="status">
          <Loader2 size={18} strokeWidth={2.25} className="animate-spin" aria-hidden />
          <span className="favo-small">Payment processing…</span>
        </div>
      )}

      {state === "success" && (
        <div className="flex flex-col items-center gap-2" role="status">
          <ShieldCheck size={36} strokeWidth={2} style={{ color: "var(--color-success)" }} aria-hidden />
          <p className="favo-subhead text-coffee-bean">Payment confirmed</p>
        </div>
      )}

      {state === "timeout" && (
        <div className="flex flex-col items-center gap-3 text-center" role="status">
          <p className="favo-small" style={{ color: "var(--color-warning)" }}>
            Still confirming with the bank. The order is safe in the queue — it will
            flip to paid automatically when the bank responds.
          </p>
          <button type="button" onClick={onPaid}
            className="rounded-[var(--radius-btn)] border border-cool-steel/30 px-4 py-2 min-h-[44px] favo-small text-coffee-bean hover:bg-coffee-bean/8 focus-visible:outline focus-visible:outline-2 focus-visible:outline-crimson-carrot">
            Back to orders
          </button>
        </div>
      )}

      {(state === "failed" || state === "error") && errorMsg && (
        <div className="flex flex-col items-center gap-3">
          <div className="flex items-center gap-2" style={{ color: "var(--color-error)" }} role="alert">
            <AlertCircle size={16} strokeWidth={2.25} aria-hidden />
            <span className="favo-small">{errorMsg}</span>
          </div>
          <button type="button" onClick={handleRetry}
            className="flex items-center gap-2 rounded-[var(--radius-btn)] border border-cool-steel/30 px-4 py-2 min-h-[44px] favo-small text-coffee-bean hover:bg-coffee-bean/8 focus-visible:outline focus-visible:outline-2 focus-visible:outline-crimson-carrot">
            <RotateCcw size={14} strokeWidth={2.25} aria-hidden /> Retry
          </button>
        </div>
      )}

      {showPayButton && (
        <button
          type="button"
          onClick={handlePay}
          disabled={busy}
          className="flex w-full items-center justify-center gap-2 rounded-[var(--radius-btn)] py-4 min-h-[52px] transition-all hover:brightness-110 active:scale-[0.99] disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-crimson-carrot"
          style={{ background: "var(--color-crimson-carrot)", color: "var(--color-porcelain)", fontFamily: "var(--font-sans)", fontWeight: 700, fontSize: "var(--text-small)", letterSpacing: "var(--tracking-cta)", textTransform: "uppercase" }}
        >
          <CreditCard size={16} strokeWidth={2.25} aria-hidden />
          {state === "failed" ? `Try again — ${formatZar(amountZar)}` : `Charge card — ${formatZar(amountZar)}`}
        </button>
      )}
    </div>
  );
}
