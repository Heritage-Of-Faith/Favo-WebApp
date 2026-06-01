// Admin dashboard shell + auth gate — owner: Mia (task A2)
// Wraps every /admin/* dashboard page with the sidebar and a server-side auth gate.
// Route gating is also enforced authoritatively in proxy.ts; this gate is the
// in-surface defence-in-depth layer. Docs: docs/DESIGN.md → Admin Rules.

import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { canAccessAdmin } from "@/server/auth/rbac";
import Sidebar from "@/components/admin/Sidebar";
import { Toaster } from "@/components/ui/sonner";

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

  return (
    <div className="flex min-h-screen bg-surface text-text-strong">
      <Sidebar role={session.role} />
      <main className="flex-1 p-6">{children}</main>
      <Toaster />
    </div>
  );
}
