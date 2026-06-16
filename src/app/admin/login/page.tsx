// Admin login — PIN entry + HOFMI SSO (task A3, backend wired by Gian).
// Public (ungated) page: lives outside the (dashboard) gated layout and is
// excluded from the proxy redirect (see proxy.ts) so it is reachable when signed
// out. Staff authenticate by PIN (POS/admin) or HOFMI SSO (admin/owner/finance).
// Docs: docs/DESIGN.md → Admin Rules · docs/API.md → loginWithPin

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { canAccessAdmin } from "@/server/auth/rbac";
import LoginForm from "@/components/pos/LoginForm";
import SsoSignInButton from "@/components/admin/SsoSignInButton";

export const metadata: Metadata = {
  title: "Sign in — FAVO Admin",
  robots: { index: false, follow: false },
};

export default async function AdminLoginPage() {
  const session = await getSession();

  // Already signed in with an admin-capable role — skip the login screen.
  if (session && canAccessAdmin(session.role)) {
    redirect("/admin");
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-porcelain px-[var(--spacing-m)]">
      <div className="flex flex-col items-center gap-6 w-full max-w-sm">
        <SsoSignInButton />

        <div className="flex items-center gap-3 w-full max-w-xs">
          <div className="flex-1 h-px bg-border-subtle" />
          <span
            className="favo-small"
            style={{ color: "var(--color-text-muted)" }}
          >
            or PIN
          </span>
          <div className="flex-1 h-px bg-border-subtle" />
        </div>

        <LoginForm redirectTo="/admin" surface="admin" />
      </div>
    </main>
  );
}
