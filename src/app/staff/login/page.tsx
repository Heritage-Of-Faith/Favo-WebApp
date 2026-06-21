// Staff login — single PIN sign-in for all staff (barista + admin).
// Public (ungated) page: lives outside the gated /admin and /pos trees so it is
// reachable while signed out. After a successful PIN entry, LoginForm routes by
// role (admin → /admin, barista → /pos/queue). Already-signed-in staff are sent
// straight to their home here. Docs: docs/DESIGN.md → POS/Admin Rules.

import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { canAccessAdmin } from "@/server/auth/rbac";
import LoginForm from "@/components/pos/LoginForm";

export const metadata: Metadata = {
  title: "Staff Sign in — FAVO",
  robots: { index: false, follow: false },
};

export default async function StaffLoginPage() {
  const session = await getSession();

  // Already signed in — skip the keypad and route to the right home by role.
  if (session) {
    redirect(canAccessAdmin(session.role) ? "/admin" : "/pos/queue");
  }

  return (
    <main className="flex min-h-screen flex-col bg-porcelain px-[var(--spacing-m)]">
      {/* Back to home — customers who land here by mistake can escape */}
      <div className="flex items-center px-[var(--spacing-m)] pt-[var(--spacing-m)]">
        <Link
          href="/"
          className="favo-small flex items-center gap-1.5 text-text-muted hover:text-text-strong transition-colors duration-[var(--dur-fast)]"
          aria-label="Back to home page"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M10 12L6 8l4-4" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          Home
        </Link>
      </div>

      <div className="flex flex-1 items-center justify-center">
        <LoginForm />
      </div>
    </main>
  );
}
