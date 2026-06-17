// Admin login — PIN entry (task A3).
// Public (ungated) page: lives outside the (dashboard) gated layout so it is
// reachable while signed out. Staff authenticate with a numeric PIN.
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
