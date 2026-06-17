// Staff login — single PIN sign-in for all staff (barista + admin).
// Public (ungated) page: lives outside the gated /admin and /pos trees so it is
// reachable while signed out. After a successful PIN entry, LoginForm routes by
// role (admin → /admin, barista → /pos/queue). Already-signed-in staff are sent
// straight to their home here. Docs: docs/DESIGN.md → POS/Admin Rules.

import type { Metadata } from "next";
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
    <main className="flex min-h-screen items-center justify-center bg-porcelain px-[var(--spacing-m)]">
      <LoginForm />
    </main>
  );
}
