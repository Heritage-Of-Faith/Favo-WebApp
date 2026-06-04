// Admin home — task A7 (COGS dashboard) over Mia's Phase 1 placeholder.
// admin/owner land on the live COGS dashboard; finance/manager (who cannot read
// COGS) get a section-card home instead. Docs: DESIGN.md, FAVO_PRD_v3.md §04 §09.

import Link from "next/link";
import type { Route } from "next";
import { getSession } from "@/lib/auth/session";
import { getCogsLive, getCogsHistory } from "@/server/actions/cogs";
import { todaySast } from "@/server/cogs/compute";
import CogsDashboard from "@/components/admin/CogsDashboard";

export const metadata = { title: "Dashboard" };

type Card = { href: Route; title: string; description: string; hideFor?: string[] };

// Finance/manager fallback cards (admin/owner get the COGS dashboard instead).
const CARDS: Card[] = [
  { href: "/admin/reports/monthly", title: "Monthly P&L", description: "Review and co-sign monthly profit & loss reports.", hideFor: ["manager"] },
  { href: "/admin/inventory", title: "Inventory", description: "Stock levels, lots, and costs." },
  { href: "/admin/stock-takes", title: "Stock takes", description: "Count lots and review variance." },
  { href: "/admin/purchases", title: "Purchases", description: "Record purchases and approve emergencies." },
  { href: "/admin/expenses", title: "Expenses", description: "Log and review operating expenses." },
  { href: "/admin/audit", title: "Audit log", description: "Review every change made across the system." },
];

export default async function AdminDashboardPage() {
  const session = await getSession();
  const role = session?.role;

  // Try to load COGS (admin/owner only). On success, render the dashboard.
  const [liveRes, historyRes] = await Promise.all([
    getCogsLive(),
    getCogsHistory({ days: 30 }),
  ]);

  if (liveRes.ok && historyRes.ok) {
    return (
      <CogsDashboard
        initialToday={liveRes.data}
        initialHistory={historyRes.data.history}
        todayDate={todaySast()}
      />
    );
  }

  // Finance / manager fallback — no COGS access; show section cards.
  return (
    <div className="mx-auto max-w-4xl">
      <header className="mb-8">
        <h1 className="admin-page-title" style={{ color: "var(--color-text-strong)" }}>
          Dashboard
        </h1>
        <p className="mt-1 favo-small" style={{ color: "var(--color-text-muted)" }}>
          Welcome{session ? `, ${session.name}` : ""}. Choose a section to manage.
        </p>
      </header>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {CARDS.filter((card) => !(role && card.hideFor?.includes(role))).map((card) => (
          <Link
            key={card.href}
            href={card.href}
            className="rounded-[var(--radius-card)] border border-border-subtle bg-elevated p-5 transition-colors hover:bg-porcelain-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <h2 className="favo-subhead" style={{ color: "var(--color-text-strong)" }}>
              {card.title}
            </h2>
            <p className="mt-1 favo-small" style={{ color: "var(--color-text-muted)" }}>
              {card.description}
            </p>
          </Link>
        ))}
      </div>
    </div>
  );
}
