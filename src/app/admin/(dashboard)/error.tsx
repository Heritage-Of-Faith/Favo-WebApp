"use client";

// Admin dashboard error boundary — surfaces unhandled page errors gracefully.
// Must be "use client" (Next.js requirement for error.tsx).

import { useEffect } from "react";

type Props = { error: Error & { digest?: string }; reset: () => void };

export default function AdminError({ error, reset }: Props) {
  useEffect(() => {
    console.error("[admin] page error:", error);
  }, [error]);

  return (
    <div className="flex min-h-[40vh] flex-col items-center justify-center gap-4 text-center">
      <p className="favo-label text-text-muted">Something went wrong</p>
      <p className="favo-h3 text-text-strong">This page failed to load</p>
      <p className="favo-small text-text-muted max-w-sm">
        {error.message || "An unexpected error occurred. Please try again."}
      </p>
      <button
        type="button"
        onClick={reset}
        className="mt-2 min-h-10 rounded-[var(--radius-btn)] px-4 favo-cta"
        style={{ background: "var(--color-accent)", color: "var(--color-text-inverse)" }}
      >
        Try again
      </button>
    </div>
  );
}
