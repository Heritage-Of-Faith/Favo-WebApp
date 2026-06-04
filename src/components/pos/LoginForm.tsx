"use client";

// PIN login form — owner: Mine (M1)
// Numeric PIN pad, 4–6 digits, masked dots, large keys (≥44×44px).
// Calls loginWithPin server action then navigates to /pos/queue.
// Docs: docs/DESIGN.md → POS Rules

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { Delete } from "lucide-react";
import { loginWithPin } from "@/server/actions/auth";

const MIN_PIN = 4;
const MAX_PIN = 6;

const PAD_KEYS = [
  "1", "2", "3",
  "4", "5", "6",
  "7", "8", "9",
  "clear", "0", "submit",
] as const;

export type Props = {
  /** Optional override for redirect target after successful login. */
  redirectTo?: string;
  /** Which surface the form sits on — controls the sub-label only. */
  surface?: "pos" | "admin";
};

const SURFACE_LABEL: Record<NonNullable<Props["surface"]>, string> = {
  pos: "Point of Sale",
  admin: "Admin",
};

export default function LoginForm({ redirectTo = "/pos/queue", surface = "pos" }: Props) {
  const router = useRouter();
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleDigit = useCallback((digit: string) => {
    setError(null);
    setPin((prev) => (prev.length < MAX_PIN ? prev + digit : prev));
  }, []);

  const handleClear = useCallback(() => {
    setError(null);
    setPin((prev) => prev.slice(0, -1));
  }, []);

  const handleSubmit = useCallback(async () => {
    if (pin.length < MIN_PIN || loading) return;
    setLoading(true);
    setError(null);

    try {
      const result = await loginWithPin(pin);
      if (result.ok) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        router.push(redirectTo as any);
      } else {
        setError(result.message);
        setPin("");
      }
    } catch {
      setError("Something went wrong. Please try again.");
      setPin("");
    } finally {
      setLoading(false);
    }
  }, [pin, loading, router, redirectTo]);

  const canSubmit = pin.length >= MIN_PIN && !loading;

  return (
    <div
      className="flex w-full max-w-[360px] flex-col items-center gap-[var(--spacing-xl)]"
      aria-label="PIN login"
    >
      {/* Logo */}
      <div className="flex flex-col items-center gap-[var(--spacing-s)]">
        <Image
          src="/brand/logo-monogram.svg"
          alt="FAVO Café"
          width={56}
          height={56}
          priority
          className="opacity-90"
        />
        <span className="favo-label tracking-[var(--tracking-label)] text-cool-steel">
          {SURFACE_LABEL[surface]}
        </span>
      </div>

      {/* Heading */}
      <h1 className="favo-h2 text-center text-porcelain">
        Enter your PIN
      </h1>

      {/* PIN dot display */}
      <div
        role="status"
        aria-label={`${pin.length} digit${pin.length !== 1 ? "s" : ""} entered`}
        aria-live="polite"
        className="flex h-12 items-center justify-center gap-[var(--spacing-m)]"
      >
        {Array.from({ length: MAX_PIN }).map((_, i) => (
          <span
            key={i}
            className={[
              "block h-3.5 w-3.5 rounded-full border-2 transition-all duration-[var(--dur-fast)]",
              i < pin.length
                ? "border-crimson-carrot bg-crimson-carrot scale-110"
                : "border-porcelain/40 bg-transparent",
            ].join(" ")}
          />
        ))}
      </div>

      {/* Error message */}
      <div aria-live="assertive" className="min-h-[20px] text-center">
        {error && (
          <p className="favo-small text-[var(--color-error)]" role="alert">
            {error}
          </p>
        )}
      </div>

      {/* PIN pad */}
      <div
        className="grid w-full grid-cols-3 gap-[var(--spacing-s)]"
        role="group"
        aria-label="PIN keypad"
      >
        {PAD_KEYS.map((key) => {
          if (key === "clear") {
            return (
              <button
                key="clear"
                type="button"
                onClick={handleClear}
                disabled={pin.length === 0 || loading}
                aria-label="Delete last digit"
                className={[
                  "flex min-h-[44px] min-w-[44px] items-center justify-center",
                  "rounded-[var(--radius-btn)] border border-porcelain/20",
                  "bg-porcelain/10 text-porcelain",
                  "transition-colors duration-[var(--dur-fast)]",
                  "hover:bg-porcelain/20 active:bg-porcelain/30",
                  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-crimson-carrot",
                  "disabled:opacity-30 disabled:cursor-not-allowed",
                ].join(" ")}
              >
                <Delete size={20} strokeWidth={2.25} />
              </button>
            );
          }

          if (key === "submit") {
            return (
              <button
                key="submit"
                type="button"
                onClick={handleSubmit}
                disabled={!canSubmit}
                aria-label="Confirm PIN"
                className={[
                  "flex min-h-[44px] min-w-[44px] items-center justify-center",
                  "rounded-[var(--radius-btn)]",
                  "bg-crimson-carrot text-porcelain favo-cta text-porcelain",
                  "transition-colors duration-[var(--dur-fast)]",
                  "hover:bg-[var(--color-coffee-bean-deep)] active:scale-95",
                  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-porcelain",
                  "disabled:opacity-30 disabled:cursor-not-allowed",
                  loading ? "animate-pulse" : "",
                ].join(" ")}
              >
                {loading ? "…" : "GO"}
              </button>
            );
          }

          // Digit keys 0–9
          return (
            <button
              key={key}
              type="button"
              onClick={() => handleDigit(key)}
              disabled={pin.length >= MAX_PIN || loading}
              aria-label={`Digit ${key}`}
              className={[
                "flex min-h-[44px] min-w-[44px] items-center justify-center",
                "rounded-[var(--radius-btn)] border border-porcelain/20",
                "bg-porcelain/10 text-porcelain",
                "font-sans text-[var(--text-h3)] font-600",
                "transition-colors duration-[var(--dur-fast)]",
                "hover:bg-porcelain/20 active:bg-porcelain/30 active:scale-95",
                "focus-visible:outline focus-visible:outline-2 focus-visible:outline-crimson-carrot",
                "disabled:opacity-30 disabled:cursor-not-allowed",
              ].join(" ")}
            >
              {key}
            </button>
          );
        })}
      </div>
    </div>
  );
}
