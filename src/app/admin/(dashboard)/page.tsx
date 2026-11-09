// Admin home — task A7 (COGS dashboard) over Mia's Phase 1 placeholder.
// admin/owner land on the live COGS dashboard; finance/manager (who cannot read
// COGS) get a section-card home instead. Docs: DESIGN.md, FAVO_PRD_v3.md §04 §09.

import Link from "next/link";
import type { Route } from "next";
import { getSession } from "@/lib/auth/session";
import { getCogsLive, getCogsHistory } from "@/server/actions/cogs";
import { todaySast } from "@/server/cogs/compute";
import CogsDashboard from "@/components/admin/CogsDashboard";
import DailyDigestCard from "@/components/admin/DailyDigestCard";
import DormancyBanner from "@/components/admin/DormancyBanner";
import { getAdminDigest } from "@/server/actions/admin-digest";

export const metadata = { title: "Dashboard" };

type Card = { href: Route; title: string; description: string };

const CARDS: Card[] = [
  { href: "/admin/reports/monthly" as Route, title: "Monthly P&L", description: "Review and sign monthly profit & loss reports." },
  { href: "/admin/inventory" as Route, title: "Inventory", description: "Stock levels, lots, and costs." },
  { href: "/admin/stock-takes" as Route, title: "Stock takes", description: "Count lots and review variance." },
  { href: "/admin/purchases" as Route, title: "Purchases", description: "Record purchases and approve emergencies." },
  { href: "/admin/expenses" as Route, title: "Expenses", description: "Log and review operating expenses." },
  { href: "/admin/audit", title: "Audit log", description: "Review every change made across the system." },
];

export default async function AdminDashboardPage() {
  const session = await getSession();

  // Try to load COGS. On success, render the dashboard.
  // DEC-23: the daily digest and job 7's dormancy banner are read here, when the
  // page renders. getAdminDigest authorises "admin"; any other role sees neither.
  const [liveRes, historyRes, digestRes] = await Promise.all([
    getCogsLive(),
    getCogsHistory({ days: 30 }),
    getAdminDigest(),
  ]);

  const alerts = digestRes.ok ? (
    <>
      <DormancyBanner items={digestRes.data.funds.dormancy} />
      <DailyDigestCard digest={digestRes.data.digest} />
    </>
  ) : null;

  if (liveRes.ok && historyRes.ok) {
    return (
      <>
        {alerts}
        <CogsDashboard
          initialToday={liveRes.data}
          initialHistory={historyRes.data.history}
          todayDate={todaySast()}
        />
      </>
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

      {alerts}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {CARDS.map((card) => (
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
