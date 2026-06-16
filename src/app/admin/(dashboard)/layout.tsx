// Admin dashboard shell + auth gate — owner: Mia (task A2)
// Wraps every /admin/* dashboard page with the sidebar and a server-side auth gate.
// Route gating is also enforced authoritatively in proxy.ts; this gate is the
// in-surface defence-in-depth layer. Docs: docs/DESIGN.md → Admin Rules.

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { canAccessAdmin } from "@/server/auth/rbac";
import Sidebar from "@/components/admin/Sidebar";
import PendingApprovalsBanner from "@/components/admin/PendingApprovalsBanner";
import { Toaster } from "@/components/ui/sonner";

export const metadata: Metadata = {
  title: { default: "FAVO Admin", template: "%s — FAVO Admin" },
  robots: { index: false, follow: false },
};

export default async function AdminDashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();

  // Not signed in, or signed in without an admin-capable role → bounce to login.
  if (!session || !canAccessAdmin(session.role)) {
    redirect("/admin/login");
  }

  const canApprove = session.role === "admin" || session.role === "owner";

  return (
    <div data-admin-portal className="flex min-h-screen bg-surface text-text-strong">
      <Sidebar role={session.role} />
      <main className="flex-1 min-h-0 overflow-y-auto p-6 pt-14 lg:pt-6">
        {/* L10: emergency purchases awaiting approval surface on every admin page. */}
        <PendingApprovalsBanner canApprove={canApprove} />
        {children}
      </main>
      <Toaster />
    </div>
  );
}
