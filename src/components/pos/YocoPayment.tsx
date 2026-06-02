"use client";

// Yoco hosted-fields payment — owner: Mine (M4)
// NEVER renders raw card fields. Yoco SDK hosted-fields iframe handles all PAN/CVV/expiry.
// Rule L01: card data never stored, logged, or echoed.
// Docs: docs/API.md → createOrder · docs/BUSINESS_RULES.md

import { useEffect, useRef, useState, useCallback } from "react";
import { Loader2, ShieldCheck, AlertCircle, RotateCcw } from "lucide-react";
import { formatZar } from "@/lib/format";

// Yoco SDK is loaded from CDN via the layout script tag — typed minimally here.
declare global {
  interface Window {
    YocoSDK?: {
      new (config: { publicKey: string }): YocoInstance;
    };
  }
}
type YocoInstance = {
  showPopup: (config: {
    amountInCents: number;
    currency: string;
    name: string;
    description?: string;
    callback: (result: { id?: string; error?: { message: string } }) => void;
  }) => void;
};

const YOCO_PUBLIC_KEY = process.env.NEXT_PUBLIC_YOCO_PUBLIC_KEY ?? "";
const YOCO_SDK_URL = "https://js.yoco.com/sdk/v1/yoco-sdk-web.js";

export type Props = {
  /** Yoco client secret from createOrder (reserved for future hosted-fields flow) */
  clientSecret: string;
  /** Total in cents (ZAR) */
  amountZar: number;
  /** Called with the Yoco payment id on successful charge */
  onSuccess: (yocoPaymentId: string) => void;
  /** Called when user cancels out of the payment view */
  onCancel?: () => void;
};

type PaymentState = "idle" | "loading-sdk" | "ready" | "processing" | "success" | "error";

export default function YocoPayment({ amountZar, onSuccess, onCancel }: Props) {
  const [state, setState] = useState<PaymentState>("loading-sdk");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const yocoRef = useRef<YocoInstance | null>(null);

  // Load the Yoco SDK from CDN once
  useEffect(() => {
    if (window.YocoSDK) {
      initSdk();
      return;
    }
    const script = document.createElement("script");
    script.src = YOCO_SDK_URL;
    script.async = true;
    script.onload = initSdk;
    script.onerror = () => {
      setState("error");
      setErrorMsg("Could not load payment SDK. Check your connection.");
    };
    document.head.appendChild(script);
    return () => {
      // Do not remove script — SDK may be reused across renders
    };
  }, []);

  function initSdk() {
    try {
      if (!window.YocoSDK) throw new Error("YocoSDK not available");
      yocoRef.current = new window.YocoSDK({ publicKey: YOCO_PUBLIC_KEY });
      setState("ready");
    } catch {
      setState("error");
      setErrorMsg("Payment system unavailable. Please retry.");
    }
  }

  const handlePay = useCallback(() => {
    if (!yocoRef.current || state !== "ready") return;
    setState("processing");
    setErrorMsg(null);

    yocoRef.current.showPopup({
      amountInCents: amountZar,
      currency: "ZAR",
      name: "FAVO Café",
      description: "Coffee order",
      callback(result) {
        if (result.error) {
          setState("ready");
          setErrorMsg(result.error.message ?? "Payment declined. Please try again.");
        } else if (result.id) {
          setState("success");
          onSuccess(result.id);
        } else {
          setState("ready");
          setErrorMsg("Payment was not completed.");
        }
      },
    });
  }, [state, amountZar, onSuccess]);

  const handleRetry = useCallback(() => {
    setState("loading-sdk");
    setErrorMsg(null);
    yocoRef.current = null;
    if (window.YocoSDK) {
      initSdk();
    }
  }, []);

  return (
    <div className="flex w-full flex-col items-center gap-[var(--spacing-xl)]">
      {/* Amount display */}
      <div className="text-center">
        <p className="favo-label text-cool-steel mb-[var(--spacing-xs)]">Amount due</p>
        <p className="favo-h1 text-porcelain">{formatZar(amountZar)}</p>
      </div>

      {/* Security badge */}
      <div className="flex items-center gap-[var(--spacing-s)] text-cool-steel">
        <ShieldCheck size={16} strokeWidth={2.25} />
        <span className="favo-small">Card details handled securely by Yoco</span>
      </div>

      {/* State-driven content */}
      {(state === "loading-sdk") && (
        <div className="flex items-center gap-[var(--spacing-s)] text-cool-steel">
          <Loader2 size={20} strokeWidth={2.25} className="animate-spin" />
          <span className="favo-small">Initialising payment…</span>
        </div>
      )}

      {state === "processing" && (
        <div className="flex items-center gap-[var(--spacing-s)] text-cool-steel">
          <Loader2 size={20} strokeWidth={2.25} className="animate-spin" />
          <span className="favo-small">Processing payment…</span>
        </div>
      )}

      {state === "success" && (
        <div className="flex flex-col items-center gap-[var(--spacing-s)]" role="status">
          <ShieldCheck size={40} strokeWidth={2} className="text-[var(--color-success)]" />
          <p className="favo-subhead text-porcelain">Payment successful</p>
        </div>
      )}

      {state === "error" && errorMsg && (
        <div className="flex flex-col items-center gap-[var(--spacing-m)]">
          <div className="flex items-center gap-[var(--spacing-s)] text-[var(--color-error)]">
            <AlertCircle size={16} strokeWidth={2.25} />
            <span className="favo-small">{errorMsg}</span>
          </div>
          <button
            type="button"
            onClick={handleRetry}
            className="flex items-center gap-[var(--spacing-s)] rounded-[var(--radius-btn)] border border-cool-steel/30 px-[var(--spacing-m)] py-[var(--spacing-s)] min-h-[44px] text-cool-steel hover:bg-porcelain/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-crimson-carrot"
          >
            <RotateCcw size={14} strokeWidth={2.25} />
            <span className="favo-small">Retry</span>
          </button>
        </div>
      )}

      {/* Primary CTA — only when ready */}
      {state === "ready" && (
        <button
          type="button"
          onClick={handlePay}
          className={[
            "favo-cta flex w-full items-center justify-center rounded-[var(--radius-btn)]",
            "bg-crimson-carrot px-[var(--spacing-l)] py-[var(--spacing-m)] min-h-[44px]",
            "text-porcelain transition-colors hover:bg-coffee-bean-deep",
            "focus-visible:outline focus-visible:outline-2 focus-visible:outline-porcelain",
          ].join(" ")}
        >
          Pay {formatZar(amountZar)}
        </button>
      )}

      {/* Cancel */}
      {onCancel && state !== "success" && (
        <button
          type="button"
          onClick={onCancel}
          className="favo-small text-cool-steel underline underline-offset-2 hover:text-porcelain min-h-[44px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-crimson-carrot"
        >
          Cancel
        </button>
      )}
    </div>
  );
}
