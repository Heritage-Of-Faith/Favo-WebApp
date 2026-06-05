"use client";

// Customer auth form (sign-up + sign-in) — owner: Nikao (task N6 / Phase 3 frontend)
// Magic-link UX: enter email (+ name on sign-up) → "check your email" state.
// Tailwind/token classes only (no inline styles — DESIGN.md rule).
//
// ⚠️ BACKEND HOOK (Gian / Phase 3): the magic-link send is NOT wired yet — there
// is no Auth.js Email provider or email transport in the app. When that lands,
// replace the marked `// TODO(backend)` block with a call to the server action
// (e.g. requestSignInLink({ email, name })) and gate the success state on its
// `{ ok }` result. The form, validation, states and a11y are all ready.

import { useState } from "react";
import Link from "next/link";
import type { Route } from "next";

type Mode = "signin" | "signup";

export type Props = {
  mode: Mode;
};

const COPY: Record<Mode, { heading: string; sub: string; cta: string; altText: string; altHref: Route; altLabel: string }> = {
  signin: {
    heading: "Welcome back",
    sub: "Enter your email and we'll send you a secure sign-in link — no password needed.",
    cta: "Send my sign-in link",
    altText: "New to FAVO?",
    altHref: "/signup",
    altLabel: "Create an account",
  },
  signup: {
    heading: "Join FAVO",
    sub: "Create your rewards account. We'll email you a secure link to finish — no password to remember.",
    cta: "Create my account",
    altText: "Already have an account?",
    altHref: "/login",
    altLabel: "Sign in",
  },
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function AuthForm({ mode }: Props) {
  const copy = COPY[mode];
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (mode === "signup" && name.trim().length < 2) {
      setError("Please enter your name.");
      return;
    }
    if (!EMAIL_RE.test(email.trim())) {
      setError("Please enter a valid email address.");
      return;
    }

    setSubmitting(true);
    try {
      // TODO(backend — Gian / Phase 3): wire the magic-link send here, e.g.
      //   const res = await requestSignInLink({ email: email.trim(), name: name.trim() || undefined });
      //   if (!res.ok) { setError(res.message); return; }
      // No-op for now: there is no email transport yet, so we move to the
      // confirmation state without claiming a mail was sent (see copy below).
      await new Promise((r) => setTimeout(r, 350));
      setSubmitted(true);
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (submitted) {
    return (
      <div className="w-full max-w-[400px] text-center" aria-live="polite">
        <p className="favo-hero text-crimson-carrot text-[clamp(2.5rem,9vw,4rem)] leading-none">FAVO</p>
        <h1 className="favo-h2 mt-6 text-porcelain">You&rsquo;re on the list</h1>
        <p className="favo-body mt-4 text-porcelain/80">
          Thanks{name.trim() ? `, ${name.trim().split(" ")[0]}` : ""}! Magic-link sign-in
          is being switched on. As soon as it&rsquo;s live, your secure link will arrive
          at <span className="text-porcelain">{email.trim()}</span>.
        </p>
        <Link
          href="/"
          className="favo-cta mt-8 inline-block text-crimson-carrot no-underline"
        >
          &larr; Back to FAVO
        </Link>
      </div>
    );
  }

  return (
    <div className="w-full max-w-[400px]">
      <div className="text-center">
        <span className="favo-hero text-porcelain text-[clamp(2.75rem,10vw,4.5rem)] leading-none">
          FAVO
        </span>
        <h1 className="favo-h2 mt-5 text-porcelain">{copy.heading}</h1>
        <p className="favo-body mt-3 text-porcelain/80">{copy.sub}</p>
      </div>

      <form onSubmit={handleSubmit} className="mt-8 flex flex-col gap-4" noValidate>
        {mode === "signup" && (
          <div className="flex flex-col gap-1.5">
            <label htmlFor="name" className="favo-label text-cool-steel">
              Your name
            </label>
            <input
              id="name"
              name="name"
              type="text"
              autoComplete="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="h-12 rounded-[var(--radius-btn)] border border-porcelain/20 bg-porcelain/10 px-4 text-porcelain placeholder:text-porcelain/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-crimson-carrot"
              placeholder="Thandeka"
            />
          </div>
        )}

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
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="h-12 rounded-[var(--radius-btn)] border border-porcelain/20 bg-porcelain/10 px-4 text-porcelain placeholder:text-porcelain/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-crimson-carrot"
            placeholder="you@example.com"
            aria-describedby={error ? "auth-error" : undefined}
            aria-invalid={error ? true : undefined}
          />
        </div>

        <div aria-live="assertive" className="min-h-[20px]">
          {error && (
            <p id="auth-error" role="alert" className="favo-small text-[var(--color-error)]">
              {error}
            </p>
          )}
        </div>

        <button
          type="submit"
          disabled={submitting}
          className="flex h-12 items-center justify-center rounded-[var(--radius-btn)] bg-crimson-carrot font-sans text-[var(--text-small)] font-bold uppercase tracking-[var(--tracking-cta)] text-paper transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-porcelain disabled:opacity-50"
        >
          {submitting ? "Sending…" : copy.cta}
        </button>
      </form>

      <p className="favo-small mt-6 text-center text-porcelain/70">
        {copy.altText}{" "}
        <Link href={copy.altHref} className="text-crimson-carrot underline underline-offset-2">
          {copy.altLabel}
        </Link>
      </p>
    </div>
  );
}
