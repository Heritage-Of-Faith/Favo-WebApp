"use client";

// Customer auth form — email + password (sign-up and sign-in).
// Calls registerCustomer / loginCustomer server actions, then redirects to /customer.

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { Route } from "next";
import {
  registerCustomer,
  loginCustomer,
  requestPasswordReset,
  resendVerificationEmail,
} from "@/server/actions/customer-auth";

type Mode = "signin" | "signup";

export type Props = {
  mode: Mode;
};

const COPY: Record<Mode, {
  heading: string;
  sub: string;
  cta: string;
  submitting: string;
  altText: string;
  altHref: Route;
  altLabel: string;
}> = {
  signin: {
    heading: "Welcome back",
    sub: "Sign in to your FAVO rewards account.",
    cta: "Sign in",
    submitting: "Signing in…",
    altText: "New to FAVO?",
    altHref: "/signup" as Route,
    altLabel: "Create an account",
  },
  signup: {
    heading: "Join FAVO",
    sub: "Create your rewards account. Earn points on every cup.",
    cta: "Create account",
    submitting: "Creating account…",
    altText: "Already have an account?",
    altHref: "/login" as Route,
    altLabel: "Sign in",
  },
};

const inputClass =
  "h-12 w-full rounded-[var(--radius-btn)] border border-porcelain/20 bg-porcelain/10 px-4 text-porcelain placeholder:text-porcelain/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-crimson-carrot";

export default function AuthForm({ mode }: Props) {
  const copy = COPY[mode];
  const router = useRouter();

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Forgot password flow
  const [forgotSent, setForgotSent] = useState(false);
  const [sendingReset, setSendingReset] = useState(false);

  // Email verification flow (signup with confirmation enabled, or login before verification)
  const [verificationEmail, setVerificationEmail] = useState<string | null>(null);
  const [resendSent, setResendSent] = useState(false);
  const [resending, setResending] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (mode === "signup" && password !== confirm) {
      setError("Passwords don't match.");
      return;
    }

    setSubmitting(true);
    try {
      if (mode === "signup") {
        const res = await registerCustomer({ name, email, phone, password });
        if (!res.ok) {
          setError(res.message);
          return;
        }
        if (res.data.verificationSent) {
          setVerificationEmail(email);
          return;
        }
      } else {
        const res = await loginCustomer({ email, password });
        if (!res.ok) {
          if (res.code === "EMAIL_NOT_VERIFIED") {
            setVerificationEmail(email);
            return;
          }
          setError(res.message);
          return;
        }
      }

      router.refresh();
      router.push("/customer");
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  // ── Verification pending screen ───────────────────────────────────────────

  if (verificationEmail) {
    return (
      <div className="w-full max-w-[400px] text-center">
        <Link
          href="/"
          aria-label="Back to FAVO home"
          className="favo-hero inline-block text-[clamp(2.75rem,10vw,4.5rem)] leading-none"
          style={{ color: "var(--color-porcelain)", textDecoration: "none" }}
        >
          FAVO
        </Link>
        <h1 className="favo-h2 mt-5 text-porcelain">Check your email</h1>
        <p className="favo-body mt-3 text-porcelain/80">
          We sent a confirmation link to{" "}
          <span className="text-porcelain font-medium">{verificationEmail}</span>.
          Click it to activate your account.
        </p>
        <p className="favo-small mt-6 text-porcelain/60">
          Can&apos;t find it? Check your spam folder.
        </p>

        {resendSent ? (
          <p className="favo-small mt-4 text-porcelain/70">Resent — check your inbox.</p>
        ) : (
          <button
            type="button"
            disabled={resending}
            onClick={async () => {
              setResending(true);
              await resendVerificationEmail(verificationEmail);
              setResending(false);
              setResendSent(true);
            }}
            className="mt-4 favo-small text-crimson-carrot underline underline-offset-2 disabled:opacity-50"
          >
            {resending ? "Resending…" : "Resend confirmation email"}
          </button>
        )}

        <div className="mt-8">
          <Link
            href="/login"
            className="favo-small text-porcelain/60 underline underline-offset-2"
          >
            Back to sign in
          </Link>
        </div>
      </div>
    );
  }

  // ── Main form ─────────────────────────────────────────────────────────────

  return (
    <div className="w-full max-w-[400px]">
      {/* Logo */}
      <div className="text-center">
        <Link
          href="/"
          aria-label="Back to FAVO home"
          className="favo-hero inline-block text-[clamp(2.75rem,10vw,4.5rem)] leading-none"
          style={{ color: "var(--color-porcelain)", textDecoration: "none" }}
        >
          FAVO
        </Link>
        <h1 className="favo-h2 mt-5 text-porcelain">{copy.heading}</h1>
        <p className="favo-body mt-3 text-porcelain/80">{copy.sub}</p>
      </div>

      <form onSubmit={handleSubmit} className="mt-8 flex flex-col gap-4" noValidate>
        {/* Name — signup only */}
        {mode === "signup" && (
          <div className="flex flex-col gap-1.5">
            <label htmlFor="name" className="favo-label text-cool-steel">
              Full name
            </label>
            <input
              id="name"
              name="name"
              type="text"
              autoComplete="name"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={inputClass}
              placeholder="Thandeka Mokoena"
            />
          </div>
        )}

        {/* Phone — signup only. Captured so baristas can find the customer at
            the POS counter (FAVO searches customers by phone). */}
        {mode === "signup" && (
          <div className="flex flex-col gap-1.5">
            <label htmlFor="phone" className="favo-label text-cool-steel">
              Mobile number
            </label>
            <input
              id="phone"
              name="phone"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              required
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className={inputClass}
              placeholder="082 123 4567"
            />
          </div>
        )}

        {/* Email */}
        <div className="flex flex-col gap-1.5">
          <label htmlFor="email" className="favo-label text-cool-steel">
            Email address
          </label>
          <input
            id="email"
            name="email"
            type="email"
            inputMode="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={inputClass}
            placeholder="you@example.com"
          />
        </div>

        {/* Password */}
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <label htmlFor="password" className="favo-label text-cool-steel">
              Password
            </label>
            {mode === "signin" && (
              <button
                type="button"
                disabled={sendingReset}
                onClick={async () => {
                  if (!email) {
                    setError("Enter your email above, then click Forgot password.");
                    return;
                  }
                  setSendingReset(true);
                  await requestPasswordReset(email);
                  setSendingReset(false);
                  setForgotSent(true);
                }}
                className="favo-small text-crimson-carrot underline underline-offset-2 disabled:opacity-50"
              >
                {sendingReset ? "Sending…" : "Forgot password?"}
              </button>
            )}
          </div>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete={mode === "signup" ? "new-password" : "current-password"}
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={inputClass}
            placeholder={mode === "signup" ? "At least 8 characters" : "Your password"}
          />
          {forgotSent && (
            <p className="favo-small text-porcelain/70">
              If that email is registered you&apos;ll receive a reset link shortly.
            </p>
          )}
        </div>

        {/* Confirm password — signup only */}
        {mode === "signup" && (
          <div className="flex flex-col gap-1.5">
            <label htmlFor="confirm" className="favo-label text-cool-steel">
              Confirm password
            </label>
            <input
              id="confirm"
              name="confirm"
              type="password"
              autoComplete="new-password"
              required
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              className={inputClass}
              placeholder="Repeat your password"
            />
          </div>
        )}

        {/* Error */}
        <div aria-live="assertive" className="min-h-[20px]">
          {error && (
            <p role="alert" className="favo-small text-[var(--color-error)]">
              {error}
            </p>
          )}
        </div>

        <button
          type="submit"
          disabled={submitting}
          className="flex h-12 items-center justify-center rounded-[var(--radius-btn)] bg-crimson-carrot font-sans text-[var(--text-small)] font-bold uppercase tracking-[var(--tracking-cta)] text-paper transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-porcelain disabled:opacity-50"
        >
          {submitting ? copy.submitting : copy.cta}
        </button>
      </form>

      <p className="favo-small mt-6 text-center text-porcelain/70">
        {copy.altText}{" "}
        <Link href={copy.altHref} className="text-crimson-carrot underline underline-offset-2">
          {copy.altLabel}
        </Link>
      </p>

      <div className="mt-8 text-center">
        <Link
          href="/"
          className="favo-cta"
          style={{ color: "var(--color-cool-steel)", textDecoration: "none" }}
        >
          ← Back to FAVO
        </Link>
      </div>
    </div>
  );
}
