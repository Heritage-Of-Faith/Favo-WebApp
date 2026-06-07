// Admin login — PIN entry (task A3, backend wired by Gian).
// Public (ungated) page: lives outside the (dashboard) gated layout and is
// excluded from the proxy redirect (see proxy.ts) so it is reachable when signed
// out. Staff authenticate with the same numeric PIN used at the POS; the Auth.js
// Credentials provider carries the role in the JWT, and proxy.ts enforces that
// only admin-capable roles (admin / owner / finance) may reach /admin/*.
//
// HOFMI SSO remains a future enhancement — until an OAuth provider is configured
// in auth.ts, PIN is the available admin sign-in mechanism.
// Docs: docs/DESIGN.md → Admin Rules · docs/API.md → loginWithPin

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { canAccessAdmin } from "@/server/auth/rbac";
import LoginForm from "@/components/pos/LoginForm";

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
      <LoginForm redirectTo="/admin" surface="admin" />
    </main>
  );
}
