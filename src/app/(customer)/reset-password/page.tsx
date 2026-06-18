// Password reset — handles the redirect from Supabase Auth email link.
// Supabase sets the session from the URL hash; this page lets the user set a new password.

"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

const inputClass =
  "h-12 w-full rounded-[var(--radius-btn)] border border-porcelain/20 bg-porcelain/10 px-4 text-porcelain placeholder:text-porcelain/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-crimson-carrot";

export default function ResetPasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    // Supabase sets the session from the URL hash on mount
    const supabase = createClient();
    supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") setReady(true);
    });
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password !== confirm) {
      setError("Passwords don't match.");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    setSubmitting(true);
    try {
      const supabase = createClient();
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) {
        setError(updateError.message);
        return;
      }
      setDone(true);
      setTimeout(() => router.push("/customer"), 2000);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="flex min-h-[100dvh] items-center justify-center bg-dark-teal px-[var(--spacing-m)] py-[var(--spacing-xl)]">
      <div className="w-full max-w-[400px]">
        <div className="text-center">
          <Link href="/" aria-label="Back to FAVO home" className="favo-hero inline-block text-[clamp(2.75rem,10vw,4.5rem)] leading-none" style={{ color: "var(--color-porcelain)", textDecoration: "none" }}>
            FAVO
          </Link>
          <h1 className="favo-h2 mt-5 text-porcelain">Set new password</h1>
          <p className="favo-body mt-3 text-porcelain/80">Choose a new password for your FAVO account.</p>
        </div>

        {done ? (
          <p className="mt-8 text-center favo-body text-porcelain/80">Password updated — redirecting…</p>
        ) : !ready ? (
          <p className="mt-8 text-center favo-body text-porcelain/60">Verifying reset link…</p>
        ) : (
          <form onSubmit={handleSubmit} className="mt-8 flex flex-col gap-4" noValidate>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="password" className="favo-label text-cool-steel">New password</label>
              <input id="password" name="password" type="password" autoComplete="new-password" required value={password} onChange={(e) => setPassword(e.target.value)} className={inputClass} placeholder="At least 8 characters" />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="confirm" className="favo-label text-cool-steel">Confirm password</label>
              <input id="confirm" name="confirm" type="password" autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} className={inputClass} placeholder="Repeat your password" />
            </div>
            <div aria-live="assertive" className="min-h-[20px]">
              {error && <p role="alert" className="favo-small text-[var(--color-error)]">{error}</p>}
            </div>
            <button type="submit" disabled={submitting} className="flex h-12 items-center justify-center rounded-[var(--radius-btn)] bg-crimson-carrot font-sans text-[var(--text-small)] font-bold uppercase tracking-[var(--tracking-cta)] text-paper transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-porcelain disabled:opacity-50">
              {submitting ? "Updating…" : "Update password"}
            </button>
          </form>
        )}
      </div>
    </main>
  );
}
