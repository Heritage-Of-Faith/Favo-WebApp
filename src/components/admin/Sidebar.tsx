// Admin sidebar nav — owner: Mia (task A2), Phase 2 sections added by Gian.
// Collapsible below 1024px. `hideFor` mirrors server-side RBAC (advisory only).
// Docs: docs/DESIGN.md → Admin Rules.
"use client";

import { useState, useCallback } from "react";
import Link from "next/link";
import type { Route } from "next";
import { usePathname, useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import type { StaffRole } from "@/lib/types";
import { adminLayout } from "@/lib/admin-tokens";
import { cn } from "@/lib/utils";
import { signOut } from "@/server/actions/auth";

export type Props = { role: StaffRole };

type NavItem = {
  href: Route;
  label: string;
  // Roles for which this item is hidden (advisory; server enforces access).
  hideFor?: StaffRole[];
};

const NAV_ITEMS: NavItem[] = [
  { href: "/admin", label: "Dashboard" },
  { href: "/admin/inventory" as Route, label: "Inventory" },
  { href: "/admin/stock-takes" as Route, label: "Stock takes" },
  { href: "/admin/purchases" as Route, label: "Purchases" },
  { href: "/admin/expenses" as Route, label: "Expenses" },
  { href: "/admin/reports/monthly" as Route, label: "Monthly P&L" },
  { href: "/admin/reports" as Route, label: "Reports" },
  { href: "/admin/hours" as Route, label: "Hours" },
  { href: "/admin/menu", label: "Menu" },
  { href: "/admin/staff", label: "Staff" },
  { href: "/admin/customers" as Route, label: "Customers" },
  { href: "/admin/sync-conflicts" as Route, label: "Sync conflicts" },
  { href: "/admin/audit", label: "Audit log" },
];

export default function Sidebar({ role }: Props) {
  // Below 1024px the sidebar is hidden behind a toggle. `open` controls that
  // mobile drawer; on desktop the sidebar is always visible (lg: classes).
  const [open, setOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const pathname = usePathname();
  const router = useRouter();

  const handleSignOut = useCallback(async () => {
    setSigningOut(true);
    await signOut();
    router.push("/staff/login");
  }, [router]);

  const visibleItems = NAV_ITEMS.filter((item) => !item.hideFor?.includes(role));

  function isActive(href: string) {
    if (href === "/admin") return pathname === "/admin";
    return pathname.startsWith(href);
  }

  return (
    <>
      {/* Mobile toggle — shown only below 1024px */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={open ? "Close navigation" : "Open navigation"}
        aria-expanded={open}
        className="fixed left-4 top-4 z-50 flex h-10 w-10 items-center justify-center rounded-md border border-border-subtle bg-elevated text-text-strong lg:hidden"
      >
        <span aria-hidden className="text-xl leading-none">
          {open ? "×" : "☰"}
        </span>
      </button>

      {/* Backdrop for the mobile drawer */}
      {open && (
        <div
          className="fixed inset-0 z-30 bg-black/30 lg:hidden"
          onClick={() => setOpen(false)}
          aria-hidden
        />
      )}

      <nav
        aria-label="Admin"
        style={{ width: adminLayout.sidebarWidth }}
        className={cn(
          "fixed inset-y-0 left-0 z-40 flex flex-col border-r border-border-subtle bg-elevated p-4 transition-transform",
          "lg:static lg:translate-x-0",
          open ? "translate-x-0" : "-translate-x-full"
        )}
      >
        <div className="mb-6 px-2 pt-2">
          <span className="text-lg font-semibold text-text-strong">FAVO Admin</span>
        </div>

        <ul className="flex flex-1 flex-col gap-1">
          {visibleItems.map((item) => (
            <li key={item.href}>
              <Link
                href={item.href}
                onClick={() => setOpen(false)}
                aria-current={isActive(item.href) ? "page" : undefined}
                className={cn(
                  "flex min-h-10 items-center rounded-md px-3 text-sm font-medium transition-colors",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  isActive(item.href)
                    ? "bg-[color:var(--color-accent)]/10 text-[color:var(--color-accent)] font-semibold border-l-2 border-[color:var(--color-accent)]"
                    : "text-text-muted hover:bg-[color:var(--color-surface)] hover:text-text-strong"
                )}
              >
                {item.label}
              </Link>
            </li>
          ))}
        </ul>

        <div className="mt-auto flex items-center justify-between px-3 pt-4">
          <span className="text-xs text-text-muted capitalize">Signed in as {role}</span>
          <button
            type="button"
            onClick={handleSignOut}
            disabled={signingOut}
            aria-label="Sign out"
            className={cn(
              "flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-text-muted transition-colors",
              "hover:bg-[color:var(--color-surface)] hover:text-text-strong",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              "disabled:opacity-40 disabled:cursor-not-allowed"
            )}
          >
            <LogOut size={13} strokeWidth={2.25} />
            {signingOut ? "Signing out…" : "Sign out"}
          </button>
        </div>
      </nav>
    </>
  );
}
