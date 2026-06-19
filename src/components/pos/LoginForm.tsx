"use client";

// Staff PIN login form — owner: Mine (M1)
// Single sign-in surface for all staff (barista + admin). Numeric PIN pad,
// 4–6 digits, masked dots, large keys (≥44×44px). Calls loginWithPin then
// routes by role: admin → /admin, barista → /pos/queue. An explicit
// `redirectTo` prop overrides role-based routing (e.g. deep-link return).
// Docs: docs/DESIGN.md → POS Rules

import { useState, useCallback } from "react";
import Image from "next/image";
import { Delete } from "lucide-react";
import { loginWithPin } from "@/server/actions/auth";

const MIN_PIN = 4;
const MAX_PIN = 4;

const PAD_KEYS = [
  "1", "2", "3",
  "4", "5", "6",
  "7", "8", "9",
  "clear", "0", "submit",
] as const;

export type Props = {
  /**
   * Optional override for the post-login redirect. When omitted, the user is
   * routed by role: admin → /admin, everyone else → /pos/queue.
   */
  redirectTo?: string;
};

export default function LoginForm({ redirectTo }: Props) {
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
        // Route by role unless an explicit target was supplied.
        const dest = redirectTo ?? (result.data.role === "admin" ? "/admin" : "/pos/queue");
        // Full navigation so the session cookie committed by the Server Action
        // is included in the request — router.push fires before cookies settle.
        window.location.href = dest;
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
  }, [pin, loading, redirectTo]);

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
          Staff
        </span>
      </div>

      {/* Heading */}
      <h1 className="favo-h2 text-center text-text-strong">
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
                : "border-text-muted/40 bg-transparent",
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
                  "rounded-[var(--radius-btn)] border border-border-subtle",
                  "bg-surface text-text-strong",
                  "transition-colors duration-[var(--dur-fast)]",
                  "hover:bg-porcelain-soft active:bg-porcelain-soft",
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
                  "bg-crimson-carrot text-porcelain font-bold uppercase tracking-[var(--tracking-cta)] text-[var(--text-small)]",
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
                "rounded-[var(--radius-btn)] border border-border-subtle",
                "bg-surface text-text-strong",
                "font-heading text-[var(--text-h3)] font-bold tracking-[var(--tracking-head)]",
                "transition-colors duration-[var(--dur-fast)]",
                "hover:bg-porcelain-soft active:bg-porcelain-soft active:scale-95",
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
