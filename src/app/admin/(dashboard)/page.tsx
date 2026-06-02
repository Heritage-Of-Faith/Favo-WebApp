// Admin dashboard home — owner: Mia (task A2)
// Landing page inside the gated admin shell. Links to the management sections.
// Docs: docs/DESIGN.md → Admin Rules.

import Link from "next/link";
import { getSession } from "@/lib/auth/session";

type Card = { href: string; title: string; description: string };

const CARDS: Card[] = [
  {
    href: "/admin/staff",
    title: "Staff",
    description: "Manage staff members, roles, and PINs.",
  },
  {
    href: "/admin/menu",
    title: "Menu",
    description: "Edit menu items and prices, with price history.",
  },
  {
    href: "/admin/audit",
    title: "Audit log",
    description: "Review every change made across the system.",
  },
];

export default async function AdminDashboardPage() {
  const session = await getSession();

  return (
    <div className="mx-auto max-w-4xl">
      <header className="mb-8">
        <h1 className="text-2xl font-semibold text-text-strong">Dashboard</h1>
        <p className="mt-1 text-sm text-text-muted">
          Welcome{session ? `, ${session.name}` : ""}. Choose a section to manage.
        </p>
      </header>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {CARDS.map((card) => (
          <Link
            key={card.href}
            href={card.href}
            className="rounded-lg border border-border-subtle bg-elevated p-5 transition-colors hover:bg-porcelain-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <h2 className="text-base font-semibold text-text-strong">{card.title}</h2>
            <p className="mt-1 text-sm text-text-muted">{card.description}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
